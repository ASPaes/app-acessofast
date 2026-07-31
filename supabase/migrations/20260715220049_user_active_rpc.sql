create or replace function public.set_user_active(p_user_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_role   public.user_role := private.current_app_role();
  v_tenant uuid             := private.current_tenant_id();
  v_super  boolean          := private.is_super_admin();
  v_alvo_role   public.user_role;
  v_alvo_tenant uuid;
begin
  if p_user_id = (select auth.uid()) then
    raise exception 'nao_pode_desativar_a_si_mesmo' using errcode = '42501';
  end if;

  select role, tenant_id into v_alvo_role, v_alvo_tenant
    from public.profiles where id = p_user_id;
  if not found then
    raise exception 'usuario_nao_encontrado' using errcode = 'P0002';
  end if;

  if v_alvo_role = 'super_admin'::public.user_role then
    raise exception 'nao_pode_desativar_super_admin' using errcode = '42501';
  end if;

  if not v_super then
    if v_role is distinct from 'admin'::public.user_role then
      raise exception 'forbidden: somente admin ou super_admin' using errcode = '42501';
    end if;
    if v_alvo_tenant is distinct from v_tenant then
      raise exception 'forbidden: usuario de outra empresa' using errcode = '42501';
    end if;
  end if;

  update public.profiles set is_active = p_active where id = p_user_id;
end; $$;

revoke all on function public.set_user_active(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_user_active(uuid, boolean) to authenticated;
