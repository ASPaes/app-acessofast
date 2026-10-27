-- AcessoFast, 27/10/2026: comissao do revendedor em porcentagem.
--
-- Pedido do Ryan (27/10/2026): ao cadastrar o revendedor, a equipe escolhe se ele
-- ganha o valor fixo (R$ 50, o padrao) ou uma porcentagem da venda. O resto da
-- regra de 20261026150000_indicacoes nao muda: uma vez por empresa, no 1o
-- pagamento de plano, paga ate o dia 30.
--
-- Base da porcentagem: o valor contratado no site (signup_intents.amount_cents);
-- no plano anual, o valor do ano. O valor do pagamento do Asaas nao serve: no
-- cartao parcelado cada pagamento e uma parcela ("Parcela 1 de 3").
--
-- A indicacao guarda a porcentagem e a base da venda junto com o valor: mudar o
-- combinado do revendedor depois so vale para as vendas seguintes.
--
-- Cadastro pelo site (revendedor_cadastrar) continua nascendo com R$ 50; a equipe
-- muda em Editar, antes ou depois de aprovar.
--
-- Quatro funcoes mudam de argumentos ou de colunas, o que pede apagar a versao
-- antiga. O conector do Supabase recusa DROP, entao a antiga fica renomeada com
-- sufixo _v1 e sem permissao para ninguem.

-- ---------------------------------------------------------------------
-- 1. Colunas
-- ---------------------------------------------------------------------
-- comissao_cents segue sendo o valor fixo; com 'percentual' ele fica guardado,
-- sem uso, para o caso de a equipe voltar ao fixo.
alter table public.revendedores
  add column if not exists comissao_tipo       text not null default 'fixo',
  add column if not exists comissao_percentual numeric(5,2);

alter table public.revendedores
  add constraint ck_revendedores_comissao check (
    comissao_tipo in ('fixo', 'percentual')
    and (comissao_tipo = 'percentual') = (comissao_percentual is not null)
    and (comissao_percentual is null or (comissao_percentual > 0 and comissao_percentual <= 100))
  );

-- Na venda: a porcentagem aplicada (null = valor fixo) e o valor contratado.
alter table public.indicacoes
  add column if not exists comissao_percentual numeric(5,2),
  add column if not exists valor_venda_cents   integer;

-- ---------------------------------------------------------------------
-- 2. Calculo
-- ---------------------------------------------------------------------
-- Venda sem valor conhecido na porcentagem da 0, em vez de inventar um numero; a
-- ficha mostra a venda zerada e a equipe ve.
create or replace function private.comissao_da_venda(
  p_tipo        text,
  p_fixo_cents  integer,
  p_percentual  numeric,
  p_base_cents  integer
) returns integer
language sql
immutable
set search_path to ''
as $fn$
  select case when p_tipo = 'percentual'
              then coalesce(round(p_base_cents * p_percentual / 100)::integer, 0)
              else p_fixo_cents
         end
$fn$;

revoke all on function private.comissao_da_venda(text, integer, numeric, integer) from public;

-- ---------------------------------------------------------------------
-- 3. Venda (asaas-webhook-prod). Mesma assinatura: o webhook nao muda.
-- ---------------------------------------------------------------------
create or replace function public.registrar_venda_indicada(
  p_tenant_id        uuid,
  p_signup_intent_id uuid,
  p_payment_id       text
) returns boolean
language plpgsql
volatile
security definer
set search_path to ''
as $fn$
declare
  v_base integer;
begin
  if p_tenant_id is null then
    return false;
  end if;

  -- Contratou direto no checkout: a empresa acabou de nascer e a indicacao so
  -- conhecia a intencao.
  if p_signup_intent_id is not null then
    update public.indicacoes i
       set tenant_id = p_tenant_id
     where i.signup_intent_id = p_signup_intent_id
       and i.tenant_id is null
       and not exists (select 1 from public.indicacoes x where x.tenant_id = p_tenant_id);
  end if;

  -- Valor contratado. Sem intencao (os dois caminhos do webhook mandam a dela), o
  -- valor do pagamento, que no parcelado e so a parcela.
  select si.amount_cents into v_base
    from public.signup_intents si
   where si.id = p_signup_intent_id;
  if v_base is null and p_payment_id is not null then
    select round((e.payload -> 'payment' ->> 'value')::numeric * 100)::integer into v_base
      from public.asaas_events e
     where e.payment_id = p_payment_id
       and e.payload -> 'payment' ->> 'value' is not null
     order by e.received_at
     limit 1;
  end if;

  update public.indicacoes i
     set venda_em            = now(),
         asaas_payment_id    = p_payment_id,
         comissao_cents      = private.comissao_da_venda(r.comissao_tipo, r.comissao_cents,
                                                         r.comissao_percentual, v_base),
         comissao_percentual = r.comissao_percentual,
         valor_venda_cents   = v_base,
         competencia         = date_trunc('month', now() at time zone 'America/Sao_Paulo')::date
    from public.revendedores r
   where r.id = i.revendedor_id
     and i.tenant_id = p_tenant_id
     and i.venda_em is null;
  return found;
end;
$fn$;

revoke all on function public.registrar_venda_indicada(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.registrar_venda_indicada(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- 4. Painel: salvar revendedor com a comissao
-- ---------------------------------------------------------------------
-- p_comissao_tipo null mantem o que esta (ou o padrao, R$ 50, na criacao).
-- 'fixo' usa p_comissao_cents (null mantem o valor); 'percentual' exige
-- p_comissao_percentual, de 0,01 a 100.
alter function public.salvar_revendedor(text, text, text, text, boolean, uuid)
  rename to salvar_revendedor_v1;
revoke all on function public.salvar_revendedor_v1(text, text, text, text, boolean, uuid)
  from public, anon, authenticated;

create or replace function public.salvar_revendedor(
  p_nome                text,
  p_codigo              text default null,
  p_telefone            text default null,
  p_pix                 text default null,
  p_ativo               boolean default null,
  p_id                  uuid default null,
  p_comissao_tipo       text default null,
  p_comissao_cents      integer default null,
  p_comissao_percentual numeric default null
) returns uuid
language plpgsql
volatile
security definer
set search_path to ''
as $fn$
declare
  v_id  uuid;
  v_tel text := private.revendedor_telefone(p_telefone);
begin
  if not private.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_tel is null and btrim(coalesce(p_telefone, '')) <> '' then
    raise exception 'telefone_invalido' using errcode = 'P0001';
  end if;
  if p_comissao_tipo is not null and (
       p_comissao_tipo not in ('fixo', 'percentual')
       or (p_comissao_tipo = 'fixo' and p_comissao_cents < 0)
       or (p_comissao_tipo = 'percentual'
           and (p_comissao_percentual is null
                or p_comissao_percentual <= 0
                or p_comissao_percentual > 100))
     ) then
    raise exception 'comissao_invalida' using errcode = 'P0001';
  end if;

  if p_id is null then
    -- Cadastrado pela equipe ja nasce aprovado.
    insert into public.revendedores (
      codigo, nome, telefone, pix, ativo, origem, aprovado_em, created_by,
      comissao_tipo, comissao_cents, comissao_percentual
    )
    values (
      lower(btrim(p_codigo)),
      btrim(p_nome),
      v_tel,
      nullif(btrim(coalesce(p_pix, '')), ''),
      coalesce(p_ativo, true),
      'painel',
      now(),
      (select auth.uid()),
      coalesce(p_comissao_tipo, 'fixo'),
      coalesce(case when p_comissao_tipo = 'fixo' then p_comissao_cents end, 5000),
      case when p_comissao_tipo = 'percentual' then p_comissao_percentual end
    )
    returning id into v_id;
  else
    -- Ativar/desativar so vale para quem ja foi aprovado; pendente e recusado mudam
    -- por revendedor_decidir.
    update public.revendedores r
       set nome                = btrim(p_nome),
           telefone            = v_tel,
           pix                 = nullif(btrim(coalesce(p_pix, '')), ''),
           ativo               = case when r.aprovado_em is not null and r.recusado_em is null
                                      then coalesce(p_ativo, r.ativo) else r.ativo end,
           comissao_tipo       = coalesce(p_comissao_tipo, r.comissao_tipo),
           comissao_cents      = case when p_comissao_tipo = 'fixo'
                                      then coalesce(p_comissao_cents, r.comissao_cents)
                                      else r.comissao_cents end,
           comissao_percentual = case when p_comissao_tipo is null then r.comissao_percentual
                                      when p_comissao_tipo = 'percentual' then p_comissao_percentual
                                 end,
           updated_at          = now()
     where r.id = p_id
    returning r.id into v_id;
    if v_id is null then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$fn$;

revoke all on function public.salvar_revendedor(text, text, text, text, boolean, uuid, text, integer, numeric) from public, anon;
grant execute on function public.salvar_revendedor(text, text, text, text, boolean, uuid, text, integer, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Painel: vincular empresa a mao
-- ---------------------------------------------------------------------
-- p_valor_cents = valor que a empresa pagou, para a porcentagem de quem "ja
-- pagou". Sem ele, vale o da 1a contratacao da empresa no site; venda fechada
-- fora do site precisa informar.
alter function public.vincular_indicacao(uuid, uuid, boolean)
  rename to vincular_indicacao_v1;
revoke all on function public.vincular_indicacao_v1(uuid, uuid, boolean)
  from public, anon, authenticated;

create or replace function public.vincular_indicacao(
  p_revendedor_id uuid,
  p_tenant_id     uuid,
  p_ja_pagou      boolean default false,
  p_valor_cents   integer default null
) returns uuid
language plpgsql
volatile
security definer
set search_path to ''
as $fn$
declare
  v_id   uuid;
  v_tipo text;
  v_base integer := p_valor_cents;
begin
  if not private.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if exists (select 1 from public.indicacoes i where i.tenant_id = p_tenant_id) then
    raise exception 'empresa_ja_indicada' using errcode = 'P0001';
  end if;
  if p_valor_cents is not null and p_valor_cents <= 0 then
    raise exception 'valor_invalido' using errcode = 'P0001';
  end if;

  select r.comissao_tipo into v_tipo
    from public.revendedores r
   where r.id = p_revendedor_id;
  if v_tipo is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_base is null then
    select si.amount_cents into v_base
      from public.signup_intents si
     where si.tenant_id = p_tenant_id
       and si.status = 'provisioned'
     order by si.provisioned_at nulls last, si.created_at
     limit 1;
  end if;
  if p_ja_pagou and v_tipo = 'percentual' and v_base is null then
    raise exception 'valor_da_venda_obrigatorio' using errcode = 'P0001';
  end if;

  insert into public.indicacoes (
    revendedor_id, tenant_id, origem, venda_em, comissao_cents, comissao_percentual,
    valor_venda_cents, competencia
  )
  select r.id, p_tenant_id, 'manual',
         case when p_ja_pagou then now() end,
         case when p_ja_pagou
              then private.comissao_da_venda(r.comissao_tipo, r.comissao_cents,
                                             r.comissao_percentual, v_base) end,
         case when p_ja_pagou then r.comissao_percentual end,
         case when p_ja_pagou then v_base end,
         case when p_ja_pagou
              then date_trunc('month', now() at time zone 'America/Sao_Paulo')::date end
    from public.revendedores r
   where r.id = p_revendedor_id
  returning id into v_id;
  return v_id;
end;
$fn$;

revoke all on function public.vincular_indicacao(uuid, uuid, boolean, integer) from public, anon;
grant execute on function public.vincular_indicacao(uuid, uuid, boolean, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Painel: leituras com a comissao combinada e a da venda
-- ---------------------------------------------------------------------
alter function public.indicacoes_resumo(date, date)
  rename to indicacoes_resumo_v1;
revoke all on function public.indicacoes_resumo_v1(date, date)
  from public, anon, authenticated;

create or replace function public.indicacoes_resumo(
  p_inicio date default null,
  p_fim    date default null
) returns table(
  id                  uuid,
  codigo              text,
  nome                text,
  telefone            text,
  pix                 text,
  ativo               boolean,
  origem              text,
  tem_senha           boolean,
  situacao            text,
  chave_painel        uuid,
  created_at          timestamptz,
  comissao_tipo       text,
  comissao_cents      integer,
  comissao_percentual numeric,
  cliques             bigint,
  cadastros           bigint,
  vendas              bigint,
  a_pagar_cents       bigint,
  pago_cents          bigint
)
language sql
stable
security definer
set search_path to ''
as $fn$
  select r.id, r.codigo, r.nome, r.telefone, r.pix, r.ativo, r.origem,
         r.senha_hash is not null,
         private.revendedor_situacao(r.ativo, r.aprovado_em, r.recusado_em),
         r.chave_painel, r.created_at,
         r.comissao_tipo, r.comissao_cents, r.comissao_percentual,
         (select count(*) from public.revendedor_cliques c
           where c.revendedor_id = r.id
             and (p_inicio is null or c.dia >= p_inicio)
             and (p_fim is null or c.dia < p_fim)),
         (select count(*) from public.indicacoes i
           where i.revendedor_id = r.id
             and i.removida_em is null
             and (i.tenant_id is not null or i.venda_em is not null)
             and (p_inicio is null or (i.created_at at time zone 'America/Sao_Paulo')::date >= p_inicio)
             and (p_fim is null or (i.created_at at time zone 'America/Sao_Paulo')::date < p_fim)),
         (select count(*) from public.indicacoes i
           where i.revendedor_id = r.id
             and i.removida_em is null
             and i.venda_em is not null
             and (p_inicio is null or i.competencia >= p_inicio)
             and (p_fim is null or i.competencia < p_fim)),
         (select coalesce(sum(i.comissao_cents), 0) from public.indicacoes i
           where i.revendedor_id = r.id and i.removida_em is null
             and i.venda_em is not null and i.comissao_paga_em is null),
         (select coalesce(sum(i.comissao_cents), 0) from public.indicacoes i
           where i.revendedor_id = r.id and i.removida_em is null
             and i.comissao_paga_em is not null)
    from public.revendedores r
   where private.is_super_admin()
   -- Quem espera aprovacao primeiro: e o que pede acao.
   order by case private.revendedor_situacao(r.ativo, r.aprovado_em, r.recusado_em)
              when 'pendente' then 0 when 'ativo' then 1 when 'inativo' then 2 else 3 end,
            r.nome
$fn$;

revoke all on function public.indicacoes_resumo(date, date) from public, anon;
grant execute on function public.indicacoes_resumo(date, date) to authenticated;

alter function public.indicacoes_do_revendedor(uuid)
  rename to indicacoes_do_revendedor_v1;
revoke all on function public.indicacoes_do_revendedor_v1(uuid)
  from public, anon, authenticated;

create or replace function public.indicacoes_do_revendedor(p_revendedor_id uuid)
returns table(
  id                   uuid,
  origem               text,
  created_at           timestamptz,
  empresa              text,
  tenant_id            uuid,
  em_teste             boolean,
  gratis               boolean,
  aguardando_pagamento boolean,
  venda_em             timestamptz,
  competencia          date,
  comissao_cents       integer,
  comissao_percentual  numeric,
  valor_venda_cents    integer,
  comissao_paga_em     timestamptz
)
language sql
stable
security definer
set search_path to ''
as $fn$
  select i.id, i.origem, i.created_at,
         coalesce(t.name, si.company_name, 'Empresa removida'),
         i.tenant_id,
         coalesce(t.is_trial, false),
         coalesce(t.billing_mode = 'free', false),
         -- Abriu o checkout no site e nao pagou: ainda nao existe empresa.
         i.tenant_id is null and si.id is not null and i.venda_em is null,
         i.venda_em, i.competencia, i.comissao_cents, i.comissao_percentual,
         i.valor_venda_cents, i.comissao_paga_em
    from public.indicacoes i
    left join public.tenants t on t.id = i.tenant_id
    left join public.signup_intents si on si.id = i.signup_intent_id
   where i.revendedor_id = p_revendedor_id
     and i.removida_em is null
     and private.is_super_admin()
   order by i.created_at desc
$fn$;

revoke all on function public.indicacoes_do_revendedor(uuid) from public, anon;
grant execute on function public.indicacoes_do_revendedor(uuid) to authenticated;

notify pgrst, 'reload schema';
