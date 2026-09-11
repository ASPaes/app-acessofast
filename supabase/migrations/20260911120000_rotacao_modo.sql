-- Aposentar a senha rotativa — Passo 1: o modo de rotacao passa a ser ESTADO DO BANCO.
--
-- Plano: https://claude.ai/code/artifact/224acd19-9f78-4c3b-b52a-8afd330c021c
-- Linha de base: SENHA-ROTATIVA-BASELINE.md
--
-- O QUE MUDA. A senha efemera gira em quatro situacoes: fim de sessao autenticada,
-- boot do agente, restart do servico do cliente e corte do hard_cap. As duas
-- primeiras sao ROTINA; as outras duas sao recuperacao e corte. O Passo 1 aposenta a
-- rotina — e esta migration e o interruptor.
--
-- POR QUE ESTADO DO BANCO, e nao uma flag no binario: e o mesmo padrao do auto-update
-- (agent_target_version), ja provado em campo. Cascata device -> tenant -> global,
-- resolvida na session-ingest e entregue no 'presence'. Da canario por maquina e
-- rollback por UPDATE, sem rollout de binario.
--
--   modo          fim de sessao   boot    restart do cliente   hard_cap
--   session       gira            gira    gira                 gira     <- padrao, o de sempre
--   shadow        gira            gira    gira                 gira     <- + loga o que install_only faria
--   install_only  NAO             NAO     gira                 gira
--   off           NAO             NAO     NAO                  gira
--
-- NULL em todos os niveis = session. Aplicar esta migration nao muda o comportamento
-- de maquina nenhuma: so quem tiver a propria linha trocada muda, e so depois de
-- receber o binario que entende o campo. Agente antigo ignora o campo novo na
-- resposta (o json.Unmarshal do Go descarta chave desconhecida).

alter table public.address_book
  add column if not exists rotacao_modo         text,
  add column if not exists rotacao_modo_efetivo text;

alter table public.tenant_settings     add column if not exists rotacao_modo text;
alter table public.agent_update_policy add column if not exists rotacao_modo text;

comment on column public.address_book.rotacao_modo is
  'Modo de rotacao DESEJADO para esta maquina (sobrepoe tenant e global). NULL = herda. '
  'Valores: session | shadow | install_only | off. So super_admin ou o backend alteram.';

comment on column public.address_book.rotacao_modo_efetivo is
  'Modo que o AGENTE diz estar aplicando, reportado a cada sinal. E o par de '
  'rotacao_modo como agent_version e de agent_target_version: e o que prova, no '
  'canario, que a maquina recebeu e esta obedecendo. NULL = agente anterior ao Passo 1.';

comment on column public.tenant_settings.rotacao_modo is
  'Modo de rotacao da empresa inteira. NULL = herda o global. So super_admin altera.';

comment on column public.agent_update_policy.rotacao_modo is
  'Modo de rotacao global da frota. NULL = session (o comportamento anterior ao Passo 1).';

-- ---------------------------------------------------------------------------
-- 1. So os quatro valores. Um erro de digitacao aqui nao pode virar um modo que o
--    agente nao conhece — ele cairia em session, mas o painel mostraria o valor
--    errado como se valesse.
-- ---------------------------------------------------------------------------
alter table public.address_book drop constraint if exists address_book_rotacao_modo_ck;
alter table public.address_book add constraint address_book_rotacao_modo_ck
  check (rotacao_modo is null or rotacao_modo in ('session', 'shadow', 'install_only', 'off'));

alter table public.address_book drop constraint if exists address_book_rotacao_modo_efetivo_ck;
alter table public.address_book add constraint address_book_rotacao_modo_efetivo_ck
  check (rotacao_modo_efetivo is null or rotacao_modo_efetivo in ('session', 'shadow', 'install_only', 'off'));

alter table public.tenant_settings drop constraint if exists tenant_settings_rotacao_modo_ck;
alter table public.tenant_settings add constraint tenant_settings_rotacao_modo_ck
  check (rotacao_modo is null or rotacao_modo in ('session', 'shadow', 'install_only', 'off'));

alter table public.agent_update_policy drop constraint if exists agent_update_policy_rotacao_modo_ck;
alter table public.agent_update_policy add constraint agent_update_policy_rotacao_modo_ck
  check (rotacao_modo is null or rotacao_modo in ('session', 'shadow', 'install_only', 'off'));

-- ---------------------------------------------------------------------------
-- 2. GUARDA — a coluna nova nasce protegida, porque as tabelas nao protegem.
--
-- Conferido antes de escrever (11/09/2026): a politica address_book_update exige so
-- tenant_id = current_tenant_id(), SEM checar papel, e authenticated tem UPDATE em
-- todas as colunas. Ou seja: qualquer usuario de uma empresa altera qualquer coluna
-- das maquinas dela pela API. Na tenant_settings, o admin da empresa altera.
--
-- Sem esta guarda, um usuario comum poria as maquinas da propria empresa em 'off' —
-- e senha que nao gira e senha que se compartilha fora do painel. O modo de rotacao
-- e controle da PLATAFORMA, nao preferencia da empresa.
--
-- rotacao_modo_efetivo entra na guarda tambem: e a evidencia do canario. Se qualquer
-- um pudesse escrever nela, a prova de que a maquina obedece poderia ser forjada.
--
-- Mesmo criterio da private.guard_profile_privileges: passa o backend (service_role),
-- o super_admin, e SQL direto sem JWT (migration, SQL editor, cron).
--
-- NAO toca nas colunas que ja existiam — o mesmo buraco vale para agent_token_hash,
-- agent_target_version e ignorar_presenca, e esta registrado como achado a parte. O
-- painel pode depender de gravar algumas delas; fechar isso e decisao separada.
-- ---------------------------------------------------------------------------
create or replace function private.guard_rotacao_modo()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  claims jsonb := auth.jwt();
  -- to_jsonb para servir as duas tabelas com uma funcao so: tenant_settings nao tem
  -- rotacao_modo_efetivo, e o campo ausente vira NULL dos dois lados (sem mudanca).
  v_new  jsonb := to_jsonb(new);
  v_old  jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
begin
  if (v_new ->> 'rotacao_modo')         is distinct from (v_old ->> 'rotacao_modo')
     or (v_new ->> 'rotacao_modo_efetivo') is distinct from (v_old ->> 'rotacao_modo_efetivo') then
    if claims is not null
       and coalesce(claims ->> 'role', '') <> 'service_role'
       and not private.is_super_admin() then
      raise exception
        'Somente super_admin ou o backend (service_role) podem alterar o modo de rotacao'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$fn$;

-- Trigger function nao precisa de EXECUTE de quem dispara: o Postgres so confere o
-- privilegio no CREATE TRIGGER. Fechar aqui impede so a chamada avulsa.
revoke all on function private.guard_rotacao_modo() from public, anon, authenticated;

-- UPDATE OF de proposito: a session-ingest atualiza address_book a cada sinal da
-- frota (last_online), e o gatilho so precisa acordar quando alguem MIRA estas
-- colunas. Sem o OF, seriam dezenas de milhares de execucoes por dia para nada.
drop trigger if exists trg_address_book_guard_rotacao on public.address_book;
create trigger trg_address_book_guard_rotacao
  before insert or update of rotacao_modo, rotacao_modo_efetivo on public.address_book
  for each row execute function private.guard_rotacao_modo();

drop trigger if exists trg_tenant_settings_guard_rotacao on public.tenant_settings;
create trigger trg_tenant_settings_guard_rotacao
  before insert or update of rotacao_modo on public.tenant_settings
  for each row execute function private.guard_rotacao_modo();

-- agent_update_policy dispensa guarda: o RLS dela so tem politica de SELECT, entao
-- UPDATE ja e negado para anon e authenticated.

-- ---------------------------------------------------------------------------
-- 3. Resolucao em cascata. Em PUBLIC, e nao em private: a session-ingest chama por
--    db.rpc(), que e um POST ao PostgREST, e o PostgREST so enxerga schema exposto.
--    Foi exatamente o que deixou o aviso de frota mudo em 08/09
--    (20260908160000_aviso_rpc_em_public.sql).
--
-- O global sai por subconsulta escalar, e nao por cross join como no
-- resolve_agent_update: com a tabela de politica vazia, o cross join devolveria zero
-- linhas e o device ficaria sem modo. Aqui ele cai em 'session'.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_rotacao_modo(p_device_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
           ab.rotacao_modo,
           ts.rotacao_modo,
           (select pol.rotacao_modo from public.agent_update_policy pol where pol.id),
           'session')
    from public.address_book ab
    left join public.tenant_settings ts on ts.tenant_id = ab.tenant_id
   where ab.id = p_device_id;
$fn$;

revoke all on function public.resolve_rotacao_modo(uuid) from public, anon, authenticated;
grant execute on function public.resolve_rotacao_modo(uuid) to service_role;
