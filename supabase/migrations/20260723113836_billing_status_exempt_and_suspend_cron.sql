-- FASE 6 (1/2) — Estado de cobranca do tenant + isencao + suspensao automatica

-- 1) Estado de cobranca. Separado de is_active de proposito:
--    is_active      = desativado por nos (decisao administrativa)
--    billing_status = situacao financeira (inadimplencia)
alter table public.tenants
  add column if not exists billing_status text not null default 'active'
    check (billing_status in ('active','past_due','suspended')),
  add column if not exists past_due_since timestamptz,
  add column if not exists billing_invoice_url text;

-- 2) Isencao de cobranca: ASP Softwares (interno) e parceiros em teste.
--    billing_exempt_until NULL = sem prazo definido.
alter table public.tenants
  add column if not exists billing_exempt boolean not null default false,
  add column if not exists billing_exempt_until timestamptz,
  add column if not exists billing_exempt_reason text;

comment on column public.tenants.billing_exempt is
  'Isento de cobranca/suspensao. Uso: tenant interno (ASP) e parceiros em teste pre-lancamento.';

-- So interessa varrer quem nao esta em dia e nao e isento.
create index if not exists idx_tenants_billing_status
  on public.tenants (billing_status)
  where billing_status <> 'active';

-- 3) Suspende quem estourou a carencia.
--    A contagem comeca no PAYMENT_OVERDUE (Asaas ja esgotou as 5 tentativas dele),
--    nao no vencimento — antes disso o dinheiro ainda pode entrar.
--    ISENTOS NUNCA SAO SUSPENSOS.
create or replace function public.suspend_overdue_tenants(p_grace_days int default 5)
returns integer
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_count integer;
begin
  if p_grace_days is null or p_grace_days < 0 then
    raise exception 'invalid_grace_days: %', p_grace_days using errcode='22023';
  end if;

  with alvo as (
    select id from public.tenants
     where billing_status = 'past_due'
       and past_due_since is not null
       and past_due_since < now() - make_interval(days => p_grace_days)
       and not (billing_exempt
                and (billing_exempt_until is null or billing_exempt_until > now()))
     for update
  )
  update public.tenants t
     set billing_status = 'suspended',
         updated_at     = now()
    from alvo
   where t.id = alvo.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

-- Least-privilege: ninguem do lado do cliente executa isso.
revoke all on function public.suspend_overdue_tenants(int) from public, anon, authenticated;
grant execute on function public.suspend_overdue_tenants(int) to service_role, postgres;
