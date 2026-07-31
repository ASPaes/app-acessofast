-- FASE 2 — Provisionamento automático dirigido por pagamento

-- 1) CNPJ opcional (coletado pelo Asaas no checkout / pós-login)
alter table public.signup_intents alter column cnpj drop not null;

-- 2) Marcador de ambiente (isola teste de produção; leve, uma coluna)
alter table public.signup_intents
  add column if not exists environment text not null default 'sandbox'
    check (environment in ('sandbox','prod'));

-- 3) Orquestradora automática — chamada SÓ pelo webhook (service_role)
create or replace function public.provision_from_intent(
  p_intent_id uuid,
  p_admin_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_intent    public.signup_intents%rowtype;
  v_tenant_id uuid;
begin
  -- guard: usuário logado não-super é barrado; service_role (sem auth.uid) passa
  if auth.uid() is not null and not private.is_super_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;

  -- trava a linha (evita corrida em reenvios do webhook)
  select * into v_intent from public.signup_intents where id = p_intent_id for update;
  if not found then
    raise exception 'intent_not_found: %', p_intent_id using errcode='P0001';
  end if;

  -- idempotência: já provisionado → devolve o tenant existente, no-op
  if v_intent.status = 'provisioned' and v_intent.tenant_id is not null then
    return v_intent.tenant_id;
  end if;

  -- valida o perfil recém-criado pelo trigger handle_new_user
  if not exists (select 1 from public.profiles where id = p_admin_user_id) then
    raise exception 'admin profile missing: %', p_admin_user_id using errcode='23503';
  end if;
  if exists (select 1 from public.profiles where id = p_admin_user_id and role = 'super_admin'::public.user_role) then
    raise exception 'cannot convert super_admin' using errcode='42501';
  end if;
  if exists (select 1 from public.profiles where id = p_admin_user_id and tenant_id is not null) then
    raise exception 'user already in a tenant: %', p_admin_user_id using errcode='42501';
  end if;

  -- cria o tenant (seat_limit=1 placeholder; assign_plan sobrescreve com o plano real)
  insert into public.tenants (name, seat_limit, billing_email, cnpj, asaas_customer_id, asaas_subscription_id)
  values (trim(v_intent.company_name), 1, v_intent.admin_email,
          nullif(v_intent.cnpj,''), v_intent.asaas_customer_id, v_intent.asaas_subscription_id)
  returning id into v_tenant_id;

  insert into public.tenant_settings (tenant_id) values (v_tenant_id);

  insert into public.tenant_features (tenant_id, feature_key, enabled)
  select v_tenant_id, f.key, true from public.features f where f.is_default;

  -- vira o usuário em admin do tenant
  update public.profiles
     set tenant_id = v_tenant_id, role = 'admin'::public.user_role, updated_at = now()
   where id = p_admin_user_id;

  -- aplica o plano contratado (define seat_limit + concorrência do catálogo)
  perform public.assign_plan(v_tenant_id, v_intent.plan_code);

  -- fecha o intent
  update public.signup_intents
     set status='provisioned', tenant_id=v_tenant_id, provisioned_at=now(), updated_at=now()
   where id = p_intent_id;

  return v_tenant_id;
end;
$fn$;

-- least-privilege: só o webhook (service_role) executa
revoke all on function public.provision_from_intent(uuid, uuid) from public, anon, authenticated;
grant execute on function public.provision_from_intent(uuid, uuid) to service_role;
