-- Compra de créditos pelo Asaas.
--
-- O "Comprar" do /financeiro chama a edge create-credit-checkout, que cria uma
-- linha aqui (pending) e um checkout avulso no Asaas com externalReference =
-- credit_purchases.id. Quando o Asaas confirma o pagamento, a asaas-webhook-prod
-- chama grant_credit_purchase, que lança o 'purchase' no credit_ledger.
--
-- Fica fora de signup_intents de propósito: o webhook trata toda intenção com
-- tenant_id como troca de plano (apply_paid_plan). Tabela própria = nenhum
-- risco de uma compra de crédito virar plano, ou o contrário.
--
-- Idempotência: CHECKOUT_PAID, PAYMENT_CONFIRMED e PAYMENT_RECEIVED chegam
-- para a mesma compra. A RPC trava a linha e só credita uma vez; o índice
-- único em credit_ledger(purchase) garante isso até contra corrida.

begin;

create table if not exists public.credit_purchases (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  package_code      text not null references public.credit_packages(code),
  -- Congelados no momento da compra: repreçar o catálogo não muda o que foi pago.
  credits           integer not null check (credits > 0),
  amount_cents      integer not null check (amount_cents > 0),
  status            text not null default 'pending'
                    check (status in ('pending','paid','failed')),
  environment       text not null default 'production',
  asaas_checkout_id text unique,
  asaas_payment_id  text,
  credit_ledger_id  uuid references public.credit_ledger(id),
  failure_reason    text,
  created_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  paid_at           timestamptz,
  updated_at        timestamptz not null default now()
);
create index if not exists idx_credit_purchases_tenant
  on public.credit_purchases(tenant_id, created_at desc);
comment on table public.credit_purchases is
  'Compra de pacote de créditos pelo Asaas. pending -> paid pela grant_credit_purchase (webhook). Escrita só pelo backend.';

drop trigger if exists set_updated_at on public.credit_purchases;
create trigger set_updated_at before update on public.credit_purchases
  for each row execute function private.set_updated_at();

alter table public.credit_purchases enable row level security;
revoke all on public.credit_purchases from anon, authenticated;
grant select on public.credit_purchases to authenticated;

drop policy if exists credit_purchases_select on public.credit_purchases;
create policy credit_purchases_select on public.credit_purchases
  for select to authenticated
  using ( private.is_super_admin() or tenant_id = private.current_tenant_id() );

-- Liga o lançamento à compra: no máximo um crédito por compra.
alter table public.credit_ledger
  add column if not exists credit_purchase_id uuid references public.credit_purchases(id);
create unique index if not exists uq_credit_ledger_purchase
  on public.credit_ledger(credit_purchase_id) where credit_purchase_id is not null;

-- Chamada só pela asaas-webhook-prod (service_role).
create or replace function public.grant_credit_purchase(
  p_purchase_id uuid,
  p_payment_id  text,
  p_event_id    uuid
) returns table (ledger_id uuid, tenant_id uuid, credits integer, already_granted boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.credit_purchases%rowtype;
  v_ledger uuid;
begin
  select * into v_p from public.credit_purchases cp
   where cp.id = p_purchase_id
   for update;
  if not found then
    raise exception 'unknown_purchase: %', p_purchase_id using errcode = 'P0001';
  end if;

  if v_p.credit_ledger_id is not null then
    return query select v_p.credit_ledger_id, v_p.tenant_id, v_p.credits, true;
    return;
  end if;

  insert into public.credit_ledger
    (tenant_id, entry_type, credits, package_code, asaas_event_id, note, created_by, credit_purchase_id)
  values
    (v_p.tenant_id, 'purchase', v_p.credits, v_p.package_code, p_event_id,
     'compra de ' || v_p.credits || ' créditos', v_p.created_by, v_p.id)
  returning id into v_ledger;

  update public.credit_purchases cp
     set status = 'paid',
         paid_at = now(),
         asaas_payment_id = coalesce(p_payment_id, cp.asaas_payment_id),
         credit_ledger_id = v_ledger,
         failure_reason = null
   where cp.id = v_p.id;

  return query select v_ledger, v_p.tenant_id, v_p.credits, false;
end;
$$;

revoke all on function public.grant_credit_purchase(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.grant_credit_purchase(uuid, text, uuid) to service_role;

commit;
