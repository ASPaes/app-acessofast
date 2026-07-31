-- ===== IDENTIDADE DE BILLING NO TENANT =====
alter table public.tenants
  add column cnpj                  text unique,          -- dedup backstop (nullable p/ tenants atuais)
  add column billing_email         text,
  add column asaas_customer_id     text,
  add column asaas_subscription_id text unique;

-- ===== SIGNUP INTENTS (correlação pré-checkout) =====
create table public.signup_intents (
  id                    uuid primary key default gen_random_uuid(),  -- = externalReference no Asaas
  status                text not null default 'pending'
                          check (status in ('pending','provisioned','failed','expired')),
  company_name          text not null,
  cnpj                  text not null,
  admin_email           text not null,
  phone                 text,
  consent               boolean not null default false,
  plan_code             text not null references public.plans(code),
  billing_cycle         text not null check (billing_cycle in ('monthly','annual')),
  amount_cents          integer not null,
  asaas_customer_id     text,
  asaas_checkout_id     text,
  asaas_subscription_id text,
  asaas_payment_id      text,
  tenant_id             uuid references public.tenants(id),
  provisioned_at        timestamptz,
  failure_reason        text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index idx_signup_intents_status on public.signup_intents(status);
create index idx_signup_intents_cnpj   on public.signup_intents(cnpj);
create trigger trg_signup_intents_updated_at
  before update on public.signup_intents
  for each row execute function private.set_updated_at();

alter table public.signup_intents enable row level security;
create policy signup_intents_superadmin on public.signup_intents
  for all to authenticated
  using (private.is_super_admin()) with check (private.is_super_admin());

-- ===== ASAAS EVENTS (idempotência + auditoria de webhook) =====
create table public.asaas_events (
  id                 uuid primary key default gen_random_uuid(),
  event_id           text not null unique,                           -- evt_... (dedup exato)
  event_type         text not null,
  payment_id         text,
  subscription_id    text,
  external_reference text,                                           -- signup_intent.id
  payload            jsonb not null,
  processed          boolean not null default false,
  processing_result  text,
  received_at        timestamptz not null default now(),
  processed_at       timestamptz
);
create index idx_asaas_events_external_ref on public.asaas_events(external_reference);

alter table public.asaas_events enable row level security;
create policy asaas_events_superadmin on public.asaas_events
  for all to authenticated
  using (private.is_super_admin()) with check (private.is_super_admin());
