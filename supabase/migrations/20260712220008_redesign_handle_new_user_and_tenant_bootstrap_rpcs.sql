-- 1) handle_new_user: bind tenant_id + role from app_metadata (server-set ONLY; NOT client-settable).
--    Absent tenant -> NULL (orphan until assigned). Never mint super_admin from metadata.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_tenant_id uuid;
  v_role public.user_role;
begin
  begin
    v_tenant_id := nullif(new.raw_app_meta_data ->> 'tenant_id', '')::uuid;
  exception when others then
    v_tenant_id := null;
  end;

  begin
    v_role := (nullif(new.raw_app_meta_data ->> 'role', ''))::public.user_role;
  exception when others then
    v_role := 'tech'::public.user_role;
  end;

  if v_role is null or v_role = 'super_admin'::public.user_role then
    v_role := 'tech'::public.user_role;
  end if;

  insert into public.profiles (id, email, full_name, tenant_id, role)
  values (
    new.id,
    new.email,
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), ''),
    v_tenant_id,
    v_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- 2) provision_tenant: super_admin stands up a fully-usable tenant and binds an UNASSIGNED user as its admin.
create or replace function public.provision_tenant(
  p_name text,
  p_admin_user_id uuid,
  p_seat_limit integer default 1
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_tenant_id uuid;
begin
  if not private.is_super_admin() then
    raise exception 'only super_admin can provision tenants' using errcode = '42501';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'tenant name is required' using errcode = '22023';
  end if;

  if p_seat_limit is null or p_seat_limit < 1 then
    raise exception 'seat_limit must be >= 1' using errcode = '22023';
  end if;

  if not exists (select 1 from public.profiles where id = p_admin_user_id) then
    raise exception 'admin user % has no profile (must sign up first)', p_admin_user_id using errcode = '23503';
  end if;

  if exists (select 1 from public.profiles where id = p_admin_user_id and tenant_id is not null) then
    raise exception 'admin user % already belongs to a tenant; use assign_member to move', p_admin_user_id using errcode = '42501';
  end if;

  insert into public.tenants (name, seat_limit)
  values (trim(p_name), p_seat_limit)
  returning id into v_tenant_id;

  insert into public.tenant_settings (tenant_id)
  values (v_tenant_id);

  insert into public.tenant_features (tenant_id, feature_key, enabled)
  select v_tenant_id, f.key, true
  from public.features f
  where f.is_default;

  update public.profiles
     set tenant_id  = v_tenant_id,
         role       = 'admin'::public.user_role,
         updated_at = now()
   where id = p_admin_user_id;

  return v_tenant_id;
end;
$$;

-- 3) assign_member: super_admin (any tenant) or a tenant admin (own tenant) sets a user's tenant + role.
--    A tenant admin can only touch users already in their tenant or currently unassigned. Never grants super_admin.
create or replace function public.assign_member(
  p_user_id uuid,
  p_tenant_id uuid,
  p_role public.user_role
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_role = 'super_admin'::public.user_role then
    raise exception 'cannot assign super_admin via assign_member' using errcode = '42501';
  end if;

  if not (
    private.is_super_admin()
    or exists (
      select 1 from public.profiles me
      where me.id = (select auth.uid())
        and me.tenant_id = p_tenant_id
        and me.role = 'admin'::public.user_role
    )
  ) then
    raise exception 'not authorized to manage this tenant' using errcode = '42501';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'target user has no profile' using errcode = '23503';
  end if;

  if not private.is_super_admin() then
    if not exists (
      select 1 from public.profiles t
      where t.id = p_user_id and (t.tenant_id = p_tenant_id or t.tenant_id is null)
    ) then
      raise exception 'cannot reassign a user that belongs to another tenant' using errcode = '42501';
    end if;
  end if;

  update public.profiles
     set tenant_id  = p_tenant_id,
         role       = p_role,
         updated_at = now()
   where id = p_user_id;
end;
$$;

-- Lock execution: strip default PUBLIC grant, allow only authenticated. Internal checks gate real authz.
revoke all on function public.provision_tenant(text, uuid, integer) from public;
revoke all on function public.assign_member(uuid, uuid, public.user_role) from public;
grant execute on function public.provision_tenant(text, uuid, integer) to authenticated;
grant execute on function public.assign_member(uuid, uuid, public.user_role) to authenticated;