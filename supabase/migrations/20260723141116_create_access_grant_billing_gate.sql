-- FASE 6 (2/2) — Portao de cobranca na emissao de acesso
-- Preserva integralmente a logica de quota do Luiz; adiciona apenas o gate de billing.

create or replace function public.create_access_grant(
  p_device_id uuid, p_actor uuid,
  p_technician_email text default null, p_technician_ip text default null)
returns table(grant_id uuid, tenant_id uuid, rustdesk_id text,
              effective_limit integer, active_before integer)
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_tenant uuid;  v_rid text;  v_active boolean;  v_role public.user_role;
  v_plan text;    v_limit integer;  v_count integer;  v_ip inet;
  v_billing text; v_exempt boolean; v_exempt_until timestamptz;
begin
  if p_actor is null then
    raise exception 'actor_obrigatorio';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_actor::text, 0));

  select ab.tenant_id, ab.rustdesk_id, ab.is_active
    into v_tenant, v_rid, v_active
    from public.address_book ab
   where ab.id = p_device_id;
  if v_tenant is null then
    raise exception 'device_not_found';
  end if;
  if v_active is false then
    raise exception 'device_inativo';
  end if;

  select pr.role into v_role from public.profiles pr where pr.id = p_actor;

  select t.max_concurrent_per_tech, t.plan_code,
         t.billing_status, t.billing_exempt, t.billing_exempt_until
    into v_limit, v_plan, v_billing, v_exempt, v_exempt_until
    from public.tenants t
   where t.id = v_tenant;

  -- GATE DE COBRANCA: bloqueia apenas NOVAS conexoes de tenant suspenso.
  -- Sessoes ativas terminam naturalmente (decisao de produto: nao cortar atendimento em curso).
  -- past_due ainda conecta — a carencia e o periodo em que ele pode regularizar.
  -- Isentos (ASP Softwares, parceiros em teste) e super_admin nunca sao bloqueados.
  if v_billing = 'suspended'
     and not (coalesce(v_exempt, false)
              and (v_exempt_until is null or v_exempt_until > now()))
     and v_role is distinct from 'super_admin'::public.user_role then
    raise exception 'billing_suspended'
      using errcode = 'P0001',
            detail  = 'assinatura suspensa por inadimplencia; regularize o pagamento para reativar';
  end if;

  if v_limit is null and v_plan is not null then
    select pl.max_concurrent_per_tech into v_limit
      from public.plans pl where pl.code = v_plan;
  end if;

  select count(*)::int into v_count
    from public.connection_logs cl
   where cl.technician_id = p_actor
     and cl.status = 'active'::public.session_status;

  if v_role is distinct from 'super_admin'::public.user_role
     and v_limit is not null
     and v_count >= v_limit then
    raise exception 'quota_exceeded'
      using errcode = 'P0001',
            detail  = format('limite de %s sessoes simultaneas por tecnico atingido', v_limit);
  end if;

  begin
    v_ip := nullif(p_technician_ip, '')::inet;
  exception when others then
    v_ip := null;
  end;

  insert into public.connection_logs
    (tenant_id, address_book_id, rustdesk_id, technician_id,
     technician_email, technician_ip, status, session_start)
  values
    (v_tenant, p_device_id, v_rid, p_actor,
     p_technician_email, v_ip, 'active'::public.session_status, now())
  returning id into grant_id;

  tenant_id       := v_tenant;
  rustdesk_id     := v_rid;
  effective_limit := v_limit;
  active_before   := v_count;
  return next;
end;
$fn$;
