-- Provisiona um tenant em regime de TRIAL.
-- Envolve provision_from_intent (ja testada) e marca a expiracao na MESMA transacao:
-- em dois passos, uma falha no meio criaria conta sem expiracao = gratis para sempre.
create or replace function public.provision_trial_from_intent(
  p_intent_id uuid, p_admin_user_id uuid, p_trial_days int default 7)
returns uuid
language plpgsql
security definer
set search_path to ''
as $fn$
declare v_tenant uuid;
begin
  if auth.uid() is not null and not private.is_super_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_trial_days is null or p_trial_days < 1 or p_trial_days > 60 then
    raise exception 'invalid_trial_days: %', p_trial_days using errcode='22023';
  end if;

  v_tenant := public.provision_from_intent(p_intent_id, p_admin_user_id);

  -- plan_expires_at is null: impede que uma chamada repetida estenda o trial
  update public.tenants
     set is_trial = true,
         plan_expires_at = now() + make_interval(days => p_trial_days),
         updated_at = now()
   where id = v_tenant and plan_expires_at is null;

  return v_tenant;
end;
$fn$;

revoke all on function public.provision_trial_from_intent(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.provision_trial_from_intent(uuid, uuid, int) to service_role;
