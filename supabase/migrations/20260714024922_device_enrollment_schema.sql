-- Fase 1 — Schema de matrícula (segredo por-tenant + gate de aprovação)

-- 1) Enum do gate de aprovação
create type public.enrollment_status as enum ('pending', 'approved', 'rejected');

-- 2) Segredos de matrícula por-tenant (revogável/rotacionável). Guarda só o HASH;
--    o texto puro vive no instalador. Isolamento igual a private.device_secrets:
--    RLS ligada, ZERO policies => só service_role toca.
create table private.tenant_enrollment_secrets (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  secret_hash   text not null unique,
  label         text,
  status        text not null default 'active' check (status in ('active', 'revoked')),
  created_by    uuid,
  created_at    timestamptz not null default now(),
  revoked_by    uuid,
  revoked_at    timestamptz,
  last_used_at  timestamptz
);
alter table private.tenant_enrollment_secrets enable row level security;
create index idx_tenant_enroll_secrets_active
  on private.tenant_enrollment_secrets (tenant_id) where status = 'active';

-- 3) Colunas do gate no address_book. Default 'approved' => dispositivos existentes e os
--    criados por ator autenticado (register-device) seguem válidos. Só o enroll-device
--    (self-service, não confiável) grava 'pending' explicitamente.
alter table public.address_book
  add column enrollment_status      public.enrollment_status not null default 'approved',
  add column enrolled_via_secret_id uuid references private.tenant_enrollment_secrets(id) on delete set null,
  add column approved_by            uuid,
  add column approved_at            timestamptz;
