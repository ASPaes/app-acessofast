-- Fase 1c — redenção atômica de matrícula (usada só pela Edge Function enroll-device)
-- Constraint (tenant_id, rustdesk_id) já existe: address_book_tenant_id_rustdesk_id_key.
-- Invariante: re-matrícula rotaciona agent_token_hash mas NÃO altera enrollment_status
--             (status só muda por approve/reject). Device novo entra 'pending'.
-- Hash do segredo chega pré-calculado da Edge Function: hex(sha256(plaintext)).

create or replace function public.redeem_enrollment(
  p_secret_hash      text,
  p_rustdesk_id      text,
  p_agent_token_hash text,
  p_os               text default null,
  p_alias            text default null
)
returns table(r_device_id uuid, r_tenant_id uuid, r_status public.enrollment_status)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant    uuid;
  v_secret_id uuid;
  v_dev       uuid;
  v_status    public.enrollment_status;
begin
  -- 1) valida segredo ativo
  select s.tenant_id, s.id
    into v_tenant, v_secret_id
  from private.tenant_enrollment_secrets s
  where s.secret_hash = p_secret_hash and s.status = 'active'
  limit 1;

  if v_tenant is null then
    raise exception 'invalid_or_revoked_secret' using errcode = '28000';
  end if;

  -- 2) upsert por (tenant, rustdesk_id): novo => 'pending'; existente => mantém status, só rotaciona token
  insert into public.address_book as ab
    (tenant_id, rustdesk_id, agent_token_hash, os, alias, enrollment_status, enrolled_via_secret_id, last_online)
  values (v_tenant, p_rustdesk_id, p_agent_token_hash, p_os, p_alias, 'pending', v_secret_id, now())
  on conflict (tenant_id, rustdesk_id) do update
    set agent_token_hash       = excluded.agent_token_hash,
        os                     = coalesce(excluded.os, ab.os),
        enrolled_via_secret_id = excluded.enrolled_via_secret_id,
        last_online            = now(),
        updated_at             = now()
  returning ab.id, ab.enrollment_status into v_dev, v_status;

  -- 3) marca uso do segredo
  update private.tenant_enrollment_secrets set last_used_at = now() where id = v_secret_id;

  r_device_id := v_dev;
  r_tenant_id := v_tenant;
  r_status    := v_status;
  return next;
end;
$$;

-- service_role only: revoga de todos e concede só a service_role (a Edge Function chama com essa role).
revoke all on function public.redeem_enrollment(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.redeem_enrollment(text, text, text, text, text) to service_role;
