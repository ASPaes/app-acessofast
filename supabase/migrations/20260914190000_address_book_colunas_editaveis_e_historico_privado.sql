-- AcessoFast, 14/09/2026: fecha o buraco de escrita do address_book e guarda o
-- historico completo do dispositivo privado.
--
-- ============================================================================
-- PARTE 1 — O BURACO (aberto desde que a tabela nasceu, achado em 11/09)
-- ============================================================================
-- O papel `authenticated` tinha UPDATE na tabela INTEIRA, e a politica
-- address_book_update so confere o tenant. Qualquer usuario logado — tecnico
-- incluido — alterava pela API qualquer coluna das maquinas da propria empresa:
-- agent_token_hash (se passar pelo agente e impor senha conhecida),
-- agent_target_version (instalar outra versao), ignorar_presenca, rustdesk_id,
-- is_active, enrollment_status... Tinha tambem INSERT em rustdesk_id/tenant_id, o
-- que deixava cadastrar o ID de uma maquina alheia antes da adocao.
--
-- QUEM ESCREVE DE VERDADE (mapeado em 14/09):
--   * telas do painel (usuario logado): alias, client_id, device_group, os
--     (dispositivos.tsx e conectar.tsx) e privado (guardado por gatilho);
--   * edge functions: sempre com service_role — nao sao afetadas;
--   * funcoes do banco que gravam no address_book (set_device_active,
--     approve_device, reject_device, redeem_enrollment, redeem_claim,
--     auto_adopt_direct, aplicar_presenca, reavaliar_ignorar_presenca): todas
--     SECURITY DEFINER — rodam como o dono e tambem nao sao afetadas.
--   * ninguem insere como usuario logado (register-device usa service_role).
--
-- O CONSERTO e por privilegio de coluna, nao por gatilho: o usuario logado so
-- consegue escrever as cinco colunas que as telas usam. Qualquer outra coluna
-- responde "permission denied" antes de chegar em RLS ou gatilho. Revogar o
-- privilegio da tabela revoga junto os privilegios por coluna que existiam.
--
-- ATENCAO PARA O FUTURO: coluna nova do address_book que o painel precise
-- gravar pela API tem de entrar num GRANT UPDATE (coluna) explicito. Sem isso a
-- tela recebe "permission denied" — e esse e o comportamento certo.

revoke insert, update on public.address_book from authenticated, anon;

grant update (alias, client_id, device_group, os, privado)
  on public.address_book to authenticated;

-- ============================================================================
-- PARTE 2 — HISTORICO COMPLETO DO DISPOSITIVO PRIVADO
-- ============================================================================
-- address_book.privado_por/privado_em guardam so a ULTIMA mudanca: quem marcou
-- some quando alguem desmarca. Esta tabela guarda todas, uma linha por mudanca,
-- escrita por gatilho — nenhum usuario grava nela.

create table public.dispositivo_privado_historico (
  id                  bigint generated always as identity primary key,
  device_id           uuid not null references public.address_book(id) on delete cascade,
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  privado             boolean not null,          -- o estado DEPOIS da mudanca
  alterado_por        uuid references auth.users(id) on delete set null,
  -- Copias no momento da mudanca: se o usuario for apagado ou mudar de papel, o
  -- registro continua dizendo quem era e com que papel agiu.
  alterado_por_email  text,
  alterado_por_papel  text,
  alterado_em         timestamptz not null default now(),
  origem              text not null check (origem in ('painel', 'backend', 'sql')),
  observacao          text
);

comment on table public.dispositivo_privado_historico is
  'Toda mudanca de address_book.privado, escrita pelo gatilho trg_address_book_privado_historico. Leitura: super_admin e admin da empresa. Ninguem escreve pela API.';

create index dispositivo_privado_historico_device_idx
  on public.dispositivo_privado_historico (device_id, alterado_em desc);

alter table public.dispositivo_privado_historico enable row level security;
revoke all on public.dispositivo_privado_historico from public, anon, authenticated;
grant select on public.dispositivo_privado_historico to authenticated;

create policy dispositivo_privado_historico_select
  on public.dispositivo_privado_historico
  for select to authenticated
  using (
    private.is_super_admin()
    or (tenant_id = private.current_tenant_id()
        and private.current_app_role() = 'admin'::public.user_role)
  );

-- AFTER: so registra o que de fato foi gravado. Se a guarda (BEFORE) recusar, a
-- linha nao muda e nada entra aqui.
create or replace function private.registrar_privado_historico()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  claims   jsonb := auth.jwt();
  v_origem text;
  v_email  text;
  v_papel  text;
begin
  if tg_op = 'UPDATE' and new.privado is not distinct from old.privado then
    return null;
  end if;
  if tg_op = 'INSERT' and new.privado is not true then
    return null;
  end if;

  if claims is null then
    v_origem := 'sql';
  elsif coalesce(claims ->> 'role', '') = 'service_role' then
    v_origem := 'backend';
  else
    v_origem := 'painel';
  end if;

  if new.privado_por is not null then
    select u.email into v_email from auth.users u where u.id = new.privado_por;
    select p.role::text into v_papel from public.profiles p where p.id = new.privado_por;
  end if;

  insert into public.dispositivo_privado_historico
    (device_id, tenant_id, privado, alterado_por, alterado_por_email, alterado_por_papel, alterado_em, origem)
  values
    (new.id, new.tenant_id, new.privado, new.privado_por, v_email, v_papel,
     coalesce(new.privado_em, now()), v_origem);

  return null;
end;
$fn$;

revoke all on function private.registrar_privado_historico() from public, anon, authenticated;

create trigger trg_address_book_privado_historico
  after insert or update of privado
  on public.address_book
  for each row execute function private.registrar_privado_historico();

-- ---------- o que aconteceu antes desta tabela existir ----------
-- Um unico dispositivo mudou de privado antes desta migration: o 307871329, no
-- teste de 14/09. Os dois eventos entram com a procedencia dita na observacao.
--
-- 1) A marcacao. O address_book ja nao guarda quem marcou (foi sobrescrito pelo
--    desmarque). O horario sai dos logs da API: o unico PATCH vindo do navegador
--    nesse dispositivo antes da conexao do tecnico (17:38) foi as 17:36:16. O
--    autor fica em branco porque o log nao o registra — melhor vazio do que um
--    nome presumido.
insert into public.dispositivo_privado_historico
  (device_id, tenant_id, privado, alterado_em, origem, observacao)
select ab.id, ab.tenant_id, true, timestamptz '2026-09-14 17:36:16.37+00', 'painel',
       'Recuperado dos logs da API: marcacao feita antes do historico existir. O autor nao foi registrado.'
  from public.address_book ab
 where ab.rustdesk_id = '307871329';

-- 2) O desmarque, que ainda esta nas colunas de auditoria da propria linha.
insert into public.dispositivo_privado_historico
  (device_id, tenant_id, privado, alterado_por, alterado_por_email, alterado_por_papel, alterado_em, origem, observacao)
select ab.id, ab.tenant_id, false, ab.privado_por, u.email, p.role::text, ab.privado_em, 'painel',
       'Recuperado de address_book.privado_por/privado_em ao criar o historico.'
  from public.address_book ab
  left join auth.users u on u.id = ab.privado_por
  left join public.profiles p on p.id = ab.privado_por
 where ab.rustdesk_id = '307871329'
   and ab.privado = false
   and ab.privado_em is not null;
