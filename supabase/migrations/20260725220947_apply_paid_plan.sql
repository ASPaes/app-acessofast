-- Aplica um plano PAGO a um tenant que JA EXISTE.
-- Cobre: trial -> pagante, renovacao anual, troca de plano e reativacao.
-- Diferente de provision_from_intent: nao cria tenant nem usuario, so aplica o plano.
-- A intencao e reconhecida por ter tenant_id preenchido desde a criacao.
create or replace function public.apply_paid_plan(p_intent_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_intent public.signup_intents%rowtype;
begin
  if auth.uid() is not null and not private.is_super_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;

  select * into v_intent from public.signup_intents where id = p_intent_id for update;
  if not found then
    raise exception 'intent_not_found: %', p_intent_id using errcode='P0001';
  end if;
  if v_intent.tenant_id is null then
    raise exception 'intent_sem_tenant' using errcode='P0001';
  end if;
  if v_intent.status = 'provisioned' then
    return v_intent.tenant_id;   -- idempotente
  end if;

  perform public.assign_plan(v_intent.tenant_id, v_intent.plan_code);

  update public.tenants
     set billing_status  = 'active',
         is_trial        = false,
         past_due_since  = null,
         billing_invoice_url = null,
         -- ESTE e o ponto critico: mensal nao expira; anual ganha 12 meses novos.
         -- Sem isso, o cron cortaria um cliente que acabou de pagar.
         plan_expires_at = case when v_intent.billing_cycle = 'annual'
                                then now() + interval '12 months'
                                else null end,
         asaas_customer_id     = coalesce(v_intent.asaas_customer_id, public.tenants.asaas_customer_id),
         asaas_subscription_id = coalesce(v_intent.asaas_subscription_id, public.tenants.asaas_subscription_id),
         updated_at = now()
   where id = v_intent.tenant_id;

  update public.signup_intents
     set status = 'provisioned', provisioned_at = now(), updated_at = now()
   where id = p_intent_id;

  return v_intent.tenant_id;
end;
$fn$;

revoke all on function public.apply_paid_plan(uuid) from public, anon, authenticated;
grant execute on function public.apply_paid_plan(uuid) to service_role;
