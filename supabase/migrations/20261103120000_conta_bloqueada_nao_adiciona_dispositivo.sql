-- AcessoFast, 03/11/2026: conta suspensa ou inativa nao adiciona computador novo.
--
-- O FURO: o bloqueio so olhava CONECTAR (billing_eligibility, create_access_grant e
-- meter_external_session). Nenhum dos caminhos que CRIAM dispositivo olhava a conta:
--   * adopt-device -> redeem_claim   (botao do painel, /conectar, app desktop e celular)
--   * register-device                (insert direto na edge)
--   * session-ingest -> auto_adopt_direct (tecnico digita o ID de maquina nao adotada)
-- O terceiro e o menos obvio: a sessao era cortada, mas a maquina ja tinha entrado no
-- cadastro da conta suspensa. Foi assim que o SERVIDOR entrou na Feax em 03/11/2026, com
-- created_by nulo: instalado as 11:06, acesso direto as 11:07, sessao cortada.
--
-- A REGRA E A MESMA DO CONECTAR:
--   suspended        bloqueia (billing_blocked)
--   is_active false  bloqueia (conta_inativa)
--   past_due         NAO bloqueia: e a carencia de 5 dias, o banner so avisa
--   super_admin      fora da regra (acesso geral)
--
-- POR QUE GATILHO: uma regra so, no unico lugar por onde todo dispositivo passa, em vez de
-- uma copia em cada caminho (e em qualquer caminho que venha depois).
--
-- O QUE NAO MUDA:
--   * maquina ja cadastrada segue na lista, com presenca, e continua sem conectar;
--   * reinstalacao de maquina ja cadastrada (redeem_claim atualiza, nao insere) passa;
--   * re-matricula por upsert de maquina ja cadastrada (redeem_enrollment) passa. O
--     gatilho BEFORE INSERT dispara mesmo quando o ON CONFLICT vai virar update, por isso
--     a checagem explicita de "ja existe" abaixo;
--   * o pedido de adocao da maquina continua 'waiting': pagou, adota normalmente.
--
-- ORDEM DE PUBLICACAO (IMPORTA): a session-ingest ANTES desta migracao. Sem a edge nova, o
-- motivo novo que a auto_adopt_direct devolve cairia no 404 device_not_registered, que nao
-- corta: a sessao direta na maquina nao adotada ficaria aberta. A edge nova sem esta
-- migracao nao muda nada, porque o motivo novo ainda nao existe. adopt-device e
-- register-device podem vir depois: sem elas o bloqueio vale igual, so com erro generico.
--
-- A auto_adopt_direct muda por patch na definicao PUBLICADA, como em 20261023130000: se o
-- ponto de insercao nao aparecer exatamente uma vez, aborta e nada muda. Rodar de novo nao
-- duplica.

create or replace function private.motivo_conta_bloqueada(p_tenant uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $fn$
  select case
           when t.is_active is false then 'conta_inativa'
           when t.billing_status::text = 'suspended' then 'billing_blocked'
         end
    from public.tenants t
   where t.id = p_tenant
$fn$;

revoke all on function private.motivo_conta_bloqueada(uuid) from public, anon, authenticated;

create or replace function private.barra_dispositivo_em_conta_bloqueada()
returns trigger
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_motivo text;
begin
  v_motivo := private.motivo_conta_bloqueada(new.tenant_id);
  if v_motivo is null then
    return new;
  end if;

  -- created_by e quem adotou. Na auto-adocao vem nulo, e ai a regra vale.
  if exists (
    select 1 from public.profiles p
     where p.id = new.created_by
       and p.role = 'super_admin'::public.user_role
  ) then
    return new;
  end if;

  -- Upsert de maquina que ja esta no cadastro nao e dispositivo novo (ver cabecalho).
  if exists (
    select 1 from public.address_book ab
     where ab.tenant_id = new.tenant_id
       and ab.rustdesk_id = new.rustdesk_id
  ) then
    return new;
  end if;

  raise exception '%', v_motivo
    using errcode = 'P0001',
          detail = 'conta bloqueada nao adiciona dispositivo novo';
end;
$fn$;

revoke all on function private.barra_dispositivo_em_conta_bloqueada() from public, anon, authenticated;

create or replace trigger trg_address_book_conta_bloqueada
  before insert on public.address_book
  for each row execute function private.barra_dispositivo_em_conta_bloqueada();

-- Auto-adocao: responde com o motivo em vez de deixar o gatilho estourar. Se estourasse, a
-- session-ingest devolveria 500 sem hard_cap_at e a sessao NAO seria cortada.
do $do$
declare
  v_ancora constant text := 'perform pg_advisory_xact_lock(hashtextextended(v_tenant::text, 42));';
  v_bloco  constant text :=
       E'\n\n  -- Conta do tecnico suspensa ou inativa: a maquina nao entra no cadastro e a\n'
    || E'  -- session-ingest corta a sessao. O pedido segue waiting. Ver 20261103120000.\n'
    || E'  reason := private.motivo_conta_bloqueada(v_tenant);\n'
    || E'  if reason is not null then\n'
    || E'    adopted := false; return next; return;\n'
    || E'  end if;';
  v_def text;
begin
  v_def := pg_get_functiondef('public.auto_adopt_direct(text,text,text)'::regprocedure);

  if position('motivo_conta_bloqueada' in v_def) > 0 then
    raise notice 'auto_adopt_direct ja tem a checagem; pulando';
    return;
  end if;

  if (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora) <> 1 then
    raise exception 'ponto de insercao nao encontrado (ou repetido) em auto_adopt_direct';
  end if;

  execute replace(v_def, v_ancora, v_ancora || v_bloco);
end
$do$;

-- Conferencia.
select p.proname, position('motivo_conta_bloqueada' in p.prosrc) > 0 as tem_checagem
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'auto_adopt_direct';
