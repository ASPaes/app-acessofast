create or replace function public.assign_plan(
  p_tenant         uuid,
  p_code           text,
  p_seat_override  integer default null,
  p_conc_override  integer default null
)
returns table(plan_code text, seat_limit integer, max_concurrent_per_tech integer, current_users integer, over_limit boolean)
language plpgsql security definer set search_path = '' as $fn$
declare
  v_max_users integer;
  v_max_conc  integer;
  v_is_active boolean;
  v_seat      integer;
  v_conc      integer;
  v_current   integer;
begin
  -- guard: usuário logado precisa ser super_admin; service_role (sem auth.uid) passa (webhook billing futuro)
  if auth.uid() is not null and not private.is_super_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;

  -- valida plano
  select p.max_users, p.max_concurrent_per_tech, p.is_active
    into v_max_users, v_max_conc, v_is_active
    from public.plans p where p.code = p_code;
  if not found then
    raise exception 'unknown_plan: %', p_code using errcode='P0001';
  end if;
  if not v_is_active then
    raise exception 'plan_inactive: %', p_code using errcode='P0001';
  end if;

  -- valores efetivos (override > catálogo)
  v_seat := coalesce(p_seat_override, v_max_users);
  v_conc := coalesce(p_conc_override, v_max_conc);
  if v_seat is null then
    raise exception 'seat_count_required'
      using errcode='P0001', hint='plano sob medida exige p_seat_override explicito';
  end if;
  if v_seat < 1 then
    raise exception 'seat_count_invalid: %', v_seat using errcode='P0001';
  end if;
  if v_conc is not null and v_conc < 1 then
    raise exception 'conc_invalid: %', v_conc using errcode='P0001';
  end if;

  -- aplica no tenant
  update public.tenants t
     set plan_code = p_code,
         seat_limit = v_seat,
         max_concurrent_per_tech = v_conc,
         updated_at = now()
   where t.id = p_tenant;
  if not found then
    raise exception 'unknown_tenant: %', p_tenant using errcode='P0001';
  end if;

  -- estado resultante (informativo; não bloqueia downgrade abaixo do uso atual)
  select count(*)::int into v_current
    from public.profiles where tenant_id = p_tenant and is_active = true;

  return query select p_code, v_seat, v_conc, v_current, (v_current > v_seat);
end; $fn$;

revoke all on function public.assign_plan(uuid, text, integer, integer) from public, anon;
grant execute on function public.assign_plan(uuid, text, integer, integer) to authenticated, service_role;
