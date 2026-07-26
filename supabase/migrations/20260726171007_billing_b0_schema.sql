-- =====================================================================
-- AcessoFast — Billing B0: fundacao de schema (BILLING-DESIGN.md §7).
-- =====================================================================
-- Cria as tabelas do modelo de cobranca (free/creditos/planos, trial,
-- dunning, vouchers) + estado de billing na `tenants`. NAO implementa
-- regra de negocio: o debito/decisao vive no choke point create_access_grant
-- (isso e a Fase B1). Aqui e so estrutura, RLS, indices e grants.
--
-- Decisoes de modelagem (defaults recomendados, reversiveis):
--   D1 — "conta" = `tenant_id`. Nao ha entidade "account" no schema; o plano
--        individual (free) e um tenant. daily_access/credit_ledger sao por tenant.
--   D2 — `atendimentos` e tabela NOVA (semantica de cobranca != connection_logs,
--        que e log de conexao). Referencia connection_logs por FK quando util.
--
-- Modelo de acesso (segue o padrao das tabelas de negocio do repo):
--   • authenticated: SOMENTE SELECT, escopado por tenant via
--     private.current_tenant_id() / private.is_super_admin().
--   • Escritas: apenas backend — RPCs SECURITY DEFINER (como create_access_grant)
--     ou service_role. Nao ha grant de INSERT/UPDATE/DELETE a authenticated.
--   • credit_packages e catalogo GLOBAL (nao escopado por tenant).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------
do $$ begin
  create type public.billing_mode as enum ('free','credits','plan');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.billing_status as enum
    ('active','trialing','dunning','blocked_trial','blocked_billing');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.atendimento_source as enum ('free','credit','plan');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.credit_entry_type as enum
    ('purchase','consume','adjust','refund','expire');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.trial_state as enum
    ('trialing','converted','expired','blocked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.voucher_state as enum ('issued','applied','void');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.voucher_request_status as enum
    ('pending','approved','rejected');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. Estado de billing na conta (tenants) — o "account_plan" do §7
-- ---------------------------------------------------------------------
alter table public.tenants
  add column if not exists billing_mode   public.billing_mode   not null default 'free',
  add column if not exists billing_status public.billing_status not null default 'active';

comment on column public.tenants.billing_mode is
  'Modo de cobranca da conta: free | credits | plan. Um plano em trial usa mode=plan + status=trialing.';
comment on column public.tenants.billing_status is
  'Estado do ciclo: active | trialing | dunning | blocked_trial | blocked_billing. Gate de emissao no create_access_grant (B1).';

-- ---------------------------------------------------------------------
-- 3. credit_packages — catalogo GLOBAL de pacotes de credito
-- ---------------------------------------------------------------------
create table if not exists public.credit_packages (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  credits      integer not null check (credits > 0),
  price_cents  integer not null check (price_cents >= 0),   -- valor TBD (§11): 0 = ainda nao precificado
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.credit_packages is
  'Catalogo global de pacotes de credito (20/50/200/1000). Precos TBD (BILLING-DESIGN §11). Legivel por qualquer authenticated.';

-- ---------------------------------------------------------------------
-- 4. credit_ledger — razao append-only de creditos (saldo = soma)
-- ---------------------------------------------------------------------
create table if not exists public.credit_ledger (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  entry_type     public.credit_entry_type not null,
  -- Assinado: +compra/ajuste/estorno, -consumo/expiracao. Saldo = sum(credits).
  credits        integer not null,
  atendimento_id uuid,        -- FK adicionada apos criar a tabela atendimentos (abaixo)
  package_code   text references public.credit_packages(code),
  asaas_event_id uuid references public.asaas_events(id),
  note           text,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now()
);
create index if not exists idx_credit_ledger_tenant
  on public.credit_ledger(tenant_id, created_at desc);
comment on table public.credit_ledger is
  'Razao append-only de creditos por tenant. Saldo = sum(credits) where tenant. +compra/-consumo. Escrita so pelo backend.';

-- ---------------------------------------------------------------------
-- 5. daily_access — contador de acessos FREE por conta+dia (reset GMT-3)
-- ---------------------------------------------------------------------
create table if not exists public.daily_access (
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  access_date  date not null,                 -- dia em America/Sao_Paulo (GMT-3)
  used         integer not null default 0 check (used >= 0),
  cap          integer not null default 5 check (cap >= 0),
  updated_at   timestamptz not null default now(),
  primary key (tenant_id, access_date)
);
comment on table public.daily_access is
  'Contador de acessos free por conta e dia (America/Sao_Paulo). Teto default 5. Reset logico por access_date; sem linha = 0 usados.';

-- ---------------------------------------------------------------------
-- 6. atendimentos — 1 linha por atendimento (unidade de cobranca)
--    Implementa a janela de tolerancia (2h free / 3h credito) e evita
--    cobrar 2x em reconexao ao mesmo rustdesk_id.
-- ---------------------------------------------------------------------
create table if not exists public.atendimentos (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  technician_id      uuid not null references public.profiles(id),
  address_book_id    uuid references public.address_book(id) on delete set null,
  rustdesk_id        text not null,
  source             public.atendimento_source not null,
  connection_log_id  uuid references public.connection_logs(id) on delete set null,
  started_at         timestamptz not null default now(),
  window_expires_at  timestamptz not null,   -- started_at + 2h (free) | 3h (credito)
  hard_cap_at        timestamptz,            -- free: started_at + 2h (corte rigido B2); null p/ credito/plano
  ended_at           timestamptz,
  charged            boolean not null default false,
  created_at         timestamptz not null default now()
);
-- Lookup de reconexao dentro da janela: par tecnico->device ainda aberto.
create index if not exists idx_atendimentos_reconnect
  on public.atendimentos(technician_id, rustdesk_id)
  where ended_at is null;
create index if not exists idx_atendimentos_tenant
  on public.atendimentos(tenant_id, started_at desc);
-- Suporte ao corte temporal (B2): varrer free abertos com cap vencido.
create index if not exists idx_atendimentos_hardcap
  on public.atendimentos(hard_cap_at)
  where ended_at is null and hard_cap_at is not null;
comment on table public.atendimentos is
  'Unidade de cobranca: agrupa conexoes ao mesmo rustdesk_id dentro da janela (2h free / 3h credito). window_expires_at = fim da tolerancia; hard_cap_at = corte rigido de 2h do free (B2).';

-- FK tardia: credit_ledger.atendimento_id -> atendimentos.id (consumo de credito).
do $$ begin
  alter table public.credit_ledger
    add constraint credit_ledger_atendimento_fk
    foreign key (atendimento_id) references public.atendimentos(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 7. trials — 7d para Team/Business; 1 por CNPJ (anti-farming)
-- ---------------------------------------------------------------------
create table if not exists public.trials (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  cnpj         text not null,               -- denormalizado p/ impor 1 trial/CNPJ
  plan_code    text not null references public.plans(code),
  starts_at    timestamptz not null default now(),
  ends_at      timestamptz not null,
  state        public.trial_state not null default 'trialing',
  has_card     boolean not null default false,
  converted_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- 1 trial por CNPJ: aplica a qualquer trial nao anulado.
create unique index if not exists uq_trials_cnpj
  on public.trials(cnpj);
create index if not exists idx_trials_tenant on public.trials(tenant_id);
comment on table public.trials is
  'Trial de 7d (Team/Business). 1 por CNPJ (uq_trials_cnpj). cnpj denormalizado da tenant no momento do signup.';

-- ---------------------------------------------------------------------
-- 8. vouchers — dias de cortesia; 1 por CNPJ; nao empilha
-- ---------------------------------------------------------------------
create table if not exists public.vouchers (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique,
  cnpj               text not null,
  days               integer not null check (days > 0),
  state              public.voucher_state not null default 'issued',
  applied_to_tenant  uuid references public.tenants(id) on delete set null,
  applied_at         timestamptz,
  applied_by         uuid references public.profiles(id),   -- comercial
  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now()
);
-- 1 voucher ATIVO por CNPJ (void nao conta).
create unique index if not exists uq_vouchers_cnpj_active
  on public.vouchers(cnpj) where state <> 'void';
comment on table public.vouchers is
  'Voucher de dias de cortesia definidos pelo comercial. 1 ativo por CNPJ; nao empilha. Aplicado estende trial.';

-- ---------------------------------------------------------------------
-- 9. voucher_requests — pedidos de mais dias (§7 do spec)
-- ---------------------------------------------------------------------
create table if not exists public.voucher_requests (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  plan_code    text references public.plans(code),
  company      text not null,
  reason       text not null,
  phone        text,
  status       public.voucher_request_status not null default 'pending',
  decided_by   uuid references public.profiles(id),
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_voucher_requests_tenant
  on public.voucher_requests(tenant_id, created_at desc);
comment on table public.voucher_requests is
  'Solicitacao de mais dias de trial (empresa/motivo/telefone). Comercial analisa; aprovar gera voucher. Envio nao garante extensao.';

-- ---------------------------------------------------------------------
-- 10. updated_at triggers (reusa private.set_updated_at do repo)
-- ---------------------------------------------------------------------
drop trigger if exists set_updated_at on public.credit_packages;
create trigger set_updated_at before update on public.credit_packages
  for each row execute function private.set_updated_at();

drop trigger if exists set_updated_at on public.daily_access;
create trigger set_updated_at before update on public.daily_access
  for each row execute function private.set_updated_at();

drop trigger if exists set_updated_at on public.trials;
create trigger set_updated_at before update on public.trials
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- 11. RLS — habilita em todas; SELECT escopado por tenant (exceto catalogo)
-- ---------------------------------------------------------------------
alter table public.credit_packages   enable row level security;
alter table public.credit_ledger     enable row level security;
alter table public.daily_access      enable row level security;
alter table public.atendimentos      enable row level security;
alter table public.trials            enable row level security;
alter table public.vouchers          enable row level security;
alter table public.voucher_requests  enable row level security;

-- credit_packages: catalogo global, legivel por qualquer authenticated.
drop policy if exists credit_packages_select on public.credit_packages;
create policy credit_packages_select on public.credit_packages
  for select to authenticated using ( true );

-- credit_ledger: dono do tenant (ou super_admin).
drop policy if exists credit_ledger_select on public.credit_ledger;
create policy credit_ledger_select on public.credit_ledger
  for select to authenticated
  using ( private.is_super_admin() or tenant_id = private.current_tenant_id() );

-- daily_access: dono do tenant (ou super_admin).
drop policy if exists daily_access_select on public.daily_access;
create policy daily_access_select on public.daily_access
  for select to authenticated
  using ( private.is_super_admin() or tenant_id = private.current_tenant_id() );

-- atendimentos: dono do tenant, super_admin, ou o proprio tecnico.
drop policy if exists atendimentos_select on public.atendimentos;
create policy atendimentos_select on public.atendimentos
  for select to authenticated
  using (
    private.is_super_admin()
    or tenant_id = private.current_tenant_id()
    or technician_id = (select auth.uid())
  );

-- trials: dono do tenant (ou super_admin).
drop policy if exists trials_select on public.trials;
create policy trials_select on public.trials
  for select to authenticated
  using ( private.is_super_admin() or tenant_id = private.current_tenant_id() );

-- vouchers: super_admin (comercial) ve tudo; tenant so o que lhe foi aplicado.
drop policy if exists vouchers_select on public.vouchers;
create policy vouchers_select on public.vouchers
  for select to authenticated
  using ( private.is_super_admin() or applied_to_tenant = private.current_tenant_id() );

-- voucher_requests: dono do tenant (ou super_admin).
drop policy if exists voucher_requests_select on public.voucher_requests;
create policy voucher_requests_select on public.voucher_requests
  for select to authenticated
  using ( private.is_super_admin() or tenant_id = private.current_tenant_id() );

-- ---------------------------------------------------------------------
-- 12. Grants — authenticated so LE (Data API). Escritas via backend.
--     service_role mantem os privilegios default do Supabase (escrita).
-- ---------------------------------------------------------------------
grant select on public.credit_packages  to authenticated;
grant select on public.credit_ledger     to authenticated;
grant select on public.daily_access      to authenticated;
grant select on public.atendimentos      to authenticated;
grant select on public.trials            to authenticated;
grant select on public.vouchers          to authenticated;
grant select on public.voucher_requests  to authenticated;

-- Defesa em profundidade: garante que authenticated NAO escreve direto.
revoke insert, update, delete, truncate, references, trigger
  on public.credit_packages, public.credit_ledger, public.daily_access,
     public.atendimentos, public.trials, public.vouchers, public.voucher_requests
  from authenticated;

commit;
