-- provision_from_intent v2: seta plan_expires_at conforme o ciclo.
-- ANTES: conta nova anual nascia sem vencimento -> acesso eterno de graca no mes 13.
-- AGORA: anual = now() + 12 meses; mensal = null (assinatura recorrente controla).
create or replace function public.provision_from_intent(p_intent_id uuid, p_admin_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_intent    public.signup_intents%rowtype;
  v_tenant_id uuid;
  v_expires   timestamptz;
begin
  if auth.uid() is not null and not private.is_super_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;

  select * into v_intent from public.signup_intents where id = p_intent_id for update;
  if not found then
    raise exception 'intent_not_found: %', p_intent_id using errcode='P0001';
  end if;

  if v_intent.status = 'provisioned' and v_intent.tenant_id is not null then
    return v_intent.tenant_id;
  end if;

  if not exists (select 1 from public.profiles where id = p_admin_user_id) then
    raise exception 'admin profile missing: %', p_admin_user_id using errcode='23503';
  end if;
  if exists (select 1 from public.profiles where id = p_admin_user_id and role = 'super_admin'::public.user_role) then
    raise exception 'cannot convert super_admin' using errcode='42501';
  end if;
  if exists (select 1 from public.profiles where id = p_admin_user_id and tenant_id is not null) then
    raise exception 'user already in a tenant: %', p_admin_user_id using errcode='42501';
  end if;

  -- Anual (compra parcelada 12x): vence em 12 meses, renovacao manual.
  -- Mensal (assinatura recorrente): sem expiracao, billing_status cuida.
  v_expires := case when v_intent.billing_cycle = 'annual'
                    then now() + interval '12 months' else null end;

  insert into public.tenants (name, seat_limit, billing_email, cnpj, asaas_customer_id, asaas_subscription_id, plan_expires_at)
  values (trim(v_intent.company_name), 1, v_intent.admin_email,
          nullif(v_intent.cnpj,''), v_intent.asaas_customer_id, v_intent.asaas_subscription_id, v_expires)
  returning id into v_tenant_id;

  insert into public.tenant_settings (tenant_id) values (v_tenant_id);

  insert into public.tenant_features (tenant_id, feature_key, enabled)
  select v_tenant_id, f.key, true from public.features f where f.is_default;

  update public.profiles
     set tenant_id = v_tenant_id, role = 'admin'::public.user_role, updated_at = now()
   where id = p_admin_user_id;

  perform public.assign_plan(v_tenant_id, v_intent.plan_code);

  update public.signup_intents
     set status='provisioned', tenant_id=v_tenant_id, provisioned_at=now(), updated_at=now()
   where id = p_intent_id;

  return v_tenant_id;
end;
$function$;
