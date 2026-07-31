-- FASE 7 — Plano individual, trial de 7 dias e expiracao de plano

-- 1) Plano Individual (1 tecnico, 1 acesso simultaneo)
insert into public.plans (code, name, price_month_cents, price_year_cents,
                          max_users, max_concurrent_per_tech, is_custom, is_active, sort_order)
values ('individual', 'AcessoFast Individual', 8900, 82800, 1, 1, false, true, 0)
on conflict (code) do update
   set name = excluded.name,
       price_month_cents = excluded.price_month_cents,
       price_year_cents  = excluded.price_year_cents,
       max_users         = excluded.max_users,
       max_concurrent_per_tech = excluded.max_concurrent_per_tech,
       sort_order        = excluded.sort_order;

-- 2) Expiracao de plano.
--    NULL           = sem expiracao (assinatura mensal recorrente)
--    data no futuro = trial (7 dias) ou plano anual (12 meses)
alter table public.tenants
  add column if not exists plan_expires_at timestamptz,
  add column if not exists is_trial boolean not null default false;

comment on column public.tenants.plan_expires_at is
  'Data em que o acesso expira. NULL para assinatura mensal recorrente (controlada por billing_status).';

create index if not exists idx_tenants_plan_expires
  on public.tenants (plan_expires_at)
  where plan_expires_at is not null;

-- 3) Controle de trial por documento.
--    Guarda SOMENTE o HMAC-SHA256 do CPF/CNPJ. O numero nunca e gravado.
--    A chave do HMAC vive nos secrets do Supabase, fora do banco: quem roubar
--    o banco leva hashes inuteis, sem poder testar CPFs por forca bruta.
--    ON DELETE SET NULL de proposito: o registro SOBREVIVE a exclusao do tenant,
--    senao apagar a conta liberaria um trial novo.
create table if not exists private.trial_documents (
  id         uuid primary key default gen_random_uuid(),
  doc_hash   text not null unique,
  doc_type   text not null check (doc_type in ('cpf','cnpj')),
  tenant_id  uuid references public.tenants(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table private.trial_documents enable row level security;

-- 4) Reivindica o trial para um documento. Retorna false se ja foi usado.
--    Atomico: o UNIQUE resolve corrida entre duas tentativas simultaneas.
create or replace function public.claim_trial_document(
  p_doc_hash text, p_doc_type text, p_tenant_id uuid default null)
returns boolean
language plpgsql
security definer
set search_path to ''
as $fn$
begin
  if auth.uid() is not null and not private.is_super_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_doc_hash is null or length(p_doc_hash) < 32 then
    raise exception 'invalid_doc_hash' using errcode='22023';
  end if;
  if p_doc_type not in ('cpf','cnpj') then
    raise exception 'invalid_doc_type' using errcode='22023';
  end if;

  insert into private.trial_documents (doc_hash, doc_type, tenant_id)
  values (p_doc_hash, p_doc_type, p_tenant_id);
  return true;
exception when unique_violation then
  return false;
end;
$fn$;

revoke all on function public.claim_trial_document(text, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_trial_document(text, text, uuid) to service_role;

-- 5) Corta acesso de quem passou da data. SEM carencia: venceu ontem, bloqueia hoje.
--    Isentos nunca sao suspensos.
create or replace function public.suspend_expired_plans()
returns integer
language plpgsql
security definer
set search_path to ''
as $fn$
declare v_count integer;
begin
  with alvo as (
    select id from public.tenants
     where plan_expires_at is not null
       and plan_expires_at < now()
       and billing_status <> 'suspended'
       and not (billing_exempt
                and (billing_exempt_until is null or billing_exempt_until > now()))
     for update
  )
  update public.tenants t
     set billing_status = 'suspended', updated_at = now()
    from alvo
   where t.id = alvo.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

revoke all on function public.suspend_expired_plans() from public, anon, authenticated;
grant execute on function public.suspend_expired_plans() to service_role, postgres;
