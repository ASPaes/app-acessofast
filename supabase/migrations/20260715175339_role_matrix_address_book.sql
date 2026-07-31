-- 1. soft delete
alter table public.address_book
  add column is_active boolean not null default true,
  add column deactivated_at timestamptz,
  add column deactivated_by uuid references public.profiles(id) on delete set null;

-- 2. authenticated so edita metadado inocuo (mata o vetor do rustdesk_id)
revoke update on public.address_book from authenticated;
grant update (alias, device_group, os) on public.address_book to authenticated;

-- 3. hard delete: so super_admin
drop policy if exists address_book_delete on public.address_book;
create policy address_book_delete on public.address_book
  for delete to authenticated
  using (private.is_super_admin());

-- 4. soft delete: admin + super_admin, via RPC (RLS nao e por coluna)
create or replace function public.set_device_active(p_device_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_role   public.user_role := private.current_app_role();
  v_tenant uuid             := private.current_tenant_id();
  v_super  boolean          := private.is_super_admin();
begin
  if not v_super and v_role is distinct from 'admin'::public.user_role then
    raise exception 'forbidden: somente admin ou super_admin' using errcode = '42501';
  end if;

  update public.address_book ab
     set is_active      = p_active,
         deactivated_at = case when p_active then null else now() end,
         deactivated_by = case when p_active then null else (select auth.uid()) end
   where ab.id = p_device_id
     and (v_super or ab.tenant_id = v_tenant);

  if not found then
    raise exception 'device_nao_encontrado' using errcode = 'P0002';
  end if;
end; $$;

revoke all on function public.set_device_active(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_device_active(uuid, boolean) to authenticated;

-- 5. head bloqueado
alter table public.profiles
  add constraint profiles_role_head_bloqueado check (role <> 'head'::user_role);
