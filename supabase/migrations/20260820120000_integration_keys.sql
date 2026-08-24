-- Chaves de integracao emitidas PELO AcessoFast para parceiros guardarem.
--
-- POR QUE EXISTE
-- Ate aqui o AcessoFast nao tinha nenhuma superficie de entrada: toda edge
-- function exige sessao de usuario do painel. A integracao com o DoctorSaaS
-- inverte isso — quem chama passa a ser o parceiro, e ele precisa se identificar
-- sem login.
--
-- UMA CHAVE POR TENANT, E ISSO E O DESENHO
-- A chave nao e so credencial: ela E o vinculo entre o workspace do parceiro e a
-- empresa do AcessoFast. Quem chama com esta chave so alcanca ESTE tenant, e o
-- parceiro nao precisa nos dizer de quem e a conversa — a chave ja disse. Foi o
-- que dispensou mandar tenant dentro do identificador da conversa e o que fecha
-- o vazamento entre assinantes que o desenho anterior deixava aberto.
--
-- A CHAVE EM SI NUNCA E GRAVADA
-- Guardamos o SHA-256 e um prefixo para a tela reconhecer qual e qual. Perdeu, e
-- revogar e emitir outra — nao ha como devolver. Quem sorteia e o navegador de
-- quem gerou: o servidor nunca chega a ver o texto.

create table if not exists public.integration_keys (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  -- Nasce so com o DoctorSaaS, mas a coluna evita ter que criar outra tabela
  -- quando aparecer o segundo parceiro.
  provider    text not null default 'doctorsaas',
  -- Rotulo livre de quem emitiu ("workspace da matriz"). So para a tela.
  nome        text,
  -- Primeiros caracteres, para o admin saber qual linha e qual sem exibir nada
  -- sensivel. Nao serve para autenticar.
  key_prefix  text not null,
  key_hash    text not null,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  -- Serve para responder "essa integracao esta viva?" sem abrir log.
  last_used_at timestamptz,
  revoked_at  timestamptz,
  revoked_by  uuid references public.profiles(id) on delete set null,
  constraint ck_integration_key_hash check (key_hash ~ '^[0-9a-f]{64}$'),
  constraint ck_integration_key_prefix check (char_length(key_prefix) between 4 and 24),
  constraint ck_integration_key_provider check (provider in ('doctorsaas'))
);

comment on table public.integration_keys is
  'Chaves que o AcessoFast emite para um parceiro chamar a nossa API. Guarda so o hash: a chave e mostrada uma unica vez, na hora de gerar.';
comment on column public.integration_keys.key_hash is
  'SHA-256 hex da chave. Unico no banco inteiro — e por ele que a autenticacao encontra o tenant.';

-- O lookup da autenticacao. Unico porque duas chaves iguais em tenants
-- diferentes tornariam o dono da chamada ambiguo.
create unique index if not exists uq_integration_key_hash
  on public.integration_keys (key_hash);

create index if not exists ix_integration_key_tenant
  on public.integration_keys (tenant_id, provider);

alter table public.integration_keys enable row level security;

-- Quem enxerga e mantem: super admin, e o admin do proprio tenant. Tecnico nao —
-- emitir chave de integracao e decisao de administracao da conta, do mesmo nivel
-- de mexer em plano ou usuario.
drop policy if exists integration_keys_select on public.integration_keys;
create policy integration_keys_select on public.integration_keys
  for select to authenticated
  using (
    private.is_super_admin()
    or (tenant_id = private.current_tenant_id() and private.current_app_role()::text = 'admin')
  );

drop policy if exists integration_keys_insert on public.integration_keys;
create policy integration_keys_insert on public.integration_keys
  for insert to authenticated
  with check (
    private.is_super_admin()
    or (tenant_id = private.current_tenant_id() and private.current_app_role()::text = 'admin')
  );

-- Update existe para revogar. Nao ha por que reescrever hash ou tenant depois de
-- emitida, mas o corte fino disso fica na tela: aqui basta o recorte de tenant.
drop policy if exists integration_keys_update on public.integration_keys;
create policy integration_keys_update on public.integration_keys
  for update to authenticated
  using (
    private.is_super_admin()
    or (tenant_id = private.current_tenant_id() and private.current_app_role()::text = 'admin')
  )
  with check (
    private.is_super_admin()
    or (tenant_id = private.current_tenant_id() and private.current_app_role()::text = 'admin')
  );

-- Apagar nao: a linha revogada e o registro de que aquela chave existiu, e quem
-- a revogou. Sumir com ela apaga a trilha junto.
drop policy if exists integration_keys_delete on public.integration_keys;
create policy integration_keys_delete on public.integration_keys
  for delete to authenticated
  using (false);

grant select, insert, update on public.integration_keys to authenticated;
revoke delete, truncate, references, trigger on public.integration_keys from authenticated;
revoke all on public.integration_keys from anon;
