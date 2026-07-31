-- Fase 1b — RPCs de gestão de matrícula (chamadas pelo painel, authz interna por role)
-- Contrato de hash (compartilhado com enroll-device): secret_hash = hex( sha256( utf8(plaintext) ) )

create or replace function public.create_enrollment_secret(p_tenant_id uuid, p_label text default null)
returns table(secret_id uuid, plaintext text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plain text;
  v_hash  text;
  v_id    uuid;
begin
  if not (
    private.is_super_admin()
    or (private.current_app_role() in ('admin','head') and p_tenant_id = private.current_tenant_id())
  ) then
    raise exception 'insufficient_privilege: apenas super_admin ou admin/head do mesmo tenant';
  end if;

  if not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'tenant_not_found';
  end if;

  -- segredo url-safe (~32 chars base64url, 192 bits de entropia)
  v_plain := replace(replace(replace(encode(extensions.gen_random_bytes(24), 'base64'), '+', '-'), '/', '_'), '=', '');
  v_hash  := encode(extensions.digest(v_plain, 'sha256'), 'hex');

  insert into private.tenant_enrollment_secrets (tenant_id, secret_hash, label, created_by)
  values (p_tenant_id, v_hash, p_label, auth.uid())
  returning id into v_id;

  secret_id := v_id;
  plaintext := v_plain;
  return next;
end;
$$;

create or replace function public.revoke_enrollment_secret(p_secret_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from private.tenant_enrollment_secrets where id = p_secret_id;
  if v_tenant is null then
    raise exception 'secret_not_found';
  end if;

  if not (
    private.is_super_admin()
    or (private.current_app_role() in ('admin','head') and v_tenant = private.current_tenant_id())
  ) then
    raise exception 'insufficient_privilege';
  end if;

  update private.tenant_enrollment_secrets
     set status = 'revoked', revoked_by = auth.uid(), revoked_at = now()
   where id = p_secret_id and status <> 'revoked';
end;
$$;

create or replace function public.approve_device(p_device_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.address_book where id = p_device_id;
  if v_tenant is null then
    raise exception 'device_not_found';
  end if;

  if not (
    private.is_super_admin()
    or (private.current_app_role() in ('admin','head') and v_tenant = private.current_tenant_id())
  ) then
    raise exception 'insufficient_privilege';
  end if;

  update public.address_book
     set enrollment_status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_device_id;
end;
$$;

create or replace function public.reject_device(p_device_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.address_book where id = p_device_id;
  if v_tenant is null then
    raise exception 'device_not_found';
  end if;

  if not (
    private.is_super_admin()
    or (private.current_app_role() in ('admin','head') and v_tenant = private.current_tenant_id())
  ) then
    raise exception 'insufficient_privilege';
  end if;

  update public.address_book
     set enrollment_status = 'rejected', approved_by = auth.uid(), approved_at = now()
   where id = p_device_id;
end;
$$;

-- REVOKE dance: Supabase auto-concede EXECUTE a anon/authenticated via ALTER DEFAULT PRIVILEGES.
-- Re-revogo de todos e concedo só a authenticated (painel logado). Nunca anon.
revoke all on function public.create_enrollment_secret(uuid, text) from public, anon, authenticated;
revoke all on function public.revoke_enrollment_secret(uuid)      from public, anon, authenticated;
revoke all on function public.approve_device(uuid)                from public, anon, authenticated;
revoke all on function public.reject_device(uuid)                 from public, anon, authenticated;

grant execute on function public.create_enrollment_secret(uuid, text) to authenticated;
grant execute on function public.revoke_enrollment_secret(uuid)       to authenticated;
grant execute on function public.approve_device(uuid)                 to authenticated;
grant execute on function public.reject_device(uuid)                  to authenticated;
