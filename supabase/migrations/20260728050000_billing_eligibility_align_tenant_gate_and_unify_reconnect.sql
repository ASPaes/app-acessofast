-- =====================================================================
-- billing_eligibility — alinha à simultaneidade TENANT-WIDE e unifica reconexão.
-- =====================================================================
-- (#1) Antecipa o quota_exceeded do create_access_grant: o painel agora sabe do
--      teto tenant-wide já na etapa 1 (antes do modal free×crédito), em vez de só
--      levar 429 no clique final.
-- (#2) Reconexão passa a ser unificada por rustdesk_id (ignora técnico/origem),
--      mesma semântica de create_access_grant / meter_external_session.
-- Unidade de simultaneidade = sessão VIVA (connection_logs active) por device
-- distinto do tenant, exceto o próprio device. connect-device mapeia o novo
-- blocked_reason='quota_exceeded' -> HTTP 429.
-- =====================================================================
create or replace function public.billing_eligibility(p_device_id uuid, p_actor uuid)
returns table(
  mode text, billing_status text, is_reconnect boolean, free_remaining integer,
  credit_balance integer, active_sessions integer, needs_choice boolean,
  auto_source text, blocked_reason text
)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant uuid; v_rid text; v_role public.user_role;
  v_mode public.billing_mode; v_status public.billing_status;
  v_plan text; v_limit int;
  v_today date; v_used int; v_cap int; v_free int; v_bal int; v_live int; v_recon boolean;
begin
  select ab.tenant_id, ab.rustdesk_id into v_tenant, v_rid
    from public.address_book ab where ab.id = p_device_id;
  if v_tenant is null then
    blocked_reason := 'device_not_found'; return next; return;
  end if;

  select pr.role into v_role from public.profiles pr where pr.id = p_actor;

  select t.billing_mode, t.billing_status, t.max_concurrent_per_tech, t.plan_code
    into v_mode, v_status, v_limit, v_plan
    from public.tenants t where t.id = v_tenant;
  if v_limit is null and v_plan is not null then
    select pl.max_concurrent_per_tech into v_limit
      from public.plans pl where pl.code = v_plan;
  end if;

  select count(distinct cl.rustdesk_id)::int into v_live
    from public.connection_logs cl
   where cl.tenant_id = v_tenant
     and cl.status = 'active'::public.session_status
     and cl.rustdesk_id <> v_rid;

  select exists(
    select 1 from public.atendimentos a
     where a.rustdesk_id = v_rid
       and a.ended_at is null and a.window_expires_at > now()
  ) into v_recon;

  v_today := (now() at time zone 'America/Sao_Paulo')::date;
  select da.used, da.cap into v_used, v_cap
    from public.daily_access da
   where da.tenant_id = v_tenant and da.access_date = v_today;
  v_free := greatest(coalesce(v_cap, 5) - coalesce(v_used, 0), 0);

  select coalesce(sum(c.credits), 0)::int into v_bal
    from public.credit_ledger c where c.tenant_id = v_tenant;

  mode := v_mode::text; billing_status := v_status::text; is_reconnect := v_recon;
  free_remaining := v_free; credit_balance := v_bal; active_sessions := v_live;
  needs_choice := false; auto_source := null; blocked_reason := null;

  if v_role = 'super_admin'::public.user_role then
    auto_source := 'plan'; return next; return;
  end if;

  if v_status in ('blocked_trial'::public.billing_status, 'blocked_billing'::public.billing_status) then
    blocked_reason := 'billing_blocked'; return next; return;
  end if;

  if v_limit is not null and v_live >= v_limit then
    blocked_reason := 'quota_exceeded'; return next; return;
  end if;

  if v_recon then auto_source := 'reconnect'; return next; return; end if;
  if v_mode = 'plan'::public.billing_mode then auto_source := 'plan'; return next; return; end if;

  if v_live = 0 and v_free > 0 and v_bal > 0 then
    needs_choice := true;
  elsif v_live = 0 and v_free > 0 then
    auto_source := 'free';
  elsif v_bal > 0 then
    auto_source := 'credit';
  else
    blocked_reason := 'no_credits';
  end if;
  return next;
end;
$function$;
