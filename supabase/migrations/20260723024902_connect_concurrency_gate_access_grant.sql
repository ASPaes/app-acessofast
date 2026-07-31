-- =====================================================================
-- AcessoFast — Gate de concorrencia por tecnico na EMISSAO da credencial.
-- =====================================================================
-- Contexto: no modelo de senha efemera, a unica forma de obter uma senha
-- valida e passar pela Edge Function connect-device. Entao a contagem de
-- sessoes simultaneas deve acontecer AQUI, na emissao — nao onde o tecnico
-- clica "conectar". Iniciar pelo app em vez do painel deixa de ser bypass.
--
-- create_access_grant: na MESMA transacao (1) resolve o limite do plano,
-- (2) conta as sessoes ativas do tecnico e (3) cria o grant (linha ativa em
-- connection_logs). Atomico via advisory lock por ator -> sem TOCTOU entre
-- o count e o insert (dois cliques simultaneos nao furam o limite).
--
-- Limite efetivo = coalesce(tenants.max_concurrent_per_tech,
--                           plans.max_concurrent_per_tech via plan_code).
--   NULL  => SEM limite (planos custom/enterprise sem teto configurado).
--   super_admin (equipe interna) => isento da quota do plano do cliente.
--
-- Authz: NAO e feita aqui. A Edge Function ja valida o usuario (getUser) e a
-- visibilidade do dispositivo pela RLS do address_book antes de chamar. Esta
-- funcao roda como service_role e so por ele e executavel.
-- =====================================================================

create or replace function public.create_access_grant(
  p_device_id        uuid,
  p_actor            uuid,
  p_technician_email text default null,
  p_technician_ip    text default null
)
returns table (
  grant_id        uuid,
  tenant_id       uuid,
  rustdesk_id     text,
  effective_limit integer,
  active_before   integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_rid    text;
  v_active boolean;
  v_role   public.user_role;
  v_plan   text;
  v_limit  integer;
  v_count  integer;
  v_ip     inet;
begin
  if p_actor is null then
    raise exception 'actor_obrigatorio';
  end if;

  -- Serializa chamadas concorrentes do MESMO tecnico: count + insert viram
  -- atomicos entre si. Escopo = transacao (liberado no commit/rollback).
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text, 0));

  -- Dispositivo: tenant, rustdesk_id e is_active. Dispositivo inativo nao conecta.
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

  -- Papel do ator: super_admin (equipe interna) nao entra na quota do cliente.
  select pr.role into v_role from public.profiles pr where pr.id = p_actor;

  -- Limite efetivo: override do tenant tem precedencia; senao o do plano.
  select t.max_concurrent_per_tech, t.plan_code
    into v_limit, v_plan
    from public.tenants t
   where t.id = v_tenant;
  if v_limit is null and v_plan is not null then
    select pl.max_concurrent_per_tech into v_limit
      from public.plans pl where pl.code = v_plan;
  end if;

  -- Conta as sessoes ativas do tecnico (todas as tenants) ANTES de criar a nova.
  select count(*)::int into v_count
    from public.connection_logs cl
   where cl.technician_id = p_actor
     and cl.status = 'active'::public.session_status;

  -- Gate: so barra quando ha limite definido e o ator nao e super_admin.
  if v_role is distinct from 'super_admin'::public.user_role
     and v_limit is not null
     and v_count >= v_limit then
    raise exception 'quota_exceeded'
      using errcode = 'P0001',
            detail  = format('limite de %s sessoes simultaneas por tecnico atingido', v_limit);
  end if;

  -- IP e opcional e best-effort: nunca falhar a emissao por IP malformado.
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
$$;

comment on function public.create_access_grant(uuid, uuid, text, text) is
  'Emissao-com-quota do connect: checa o limite de sessoes simultaneas do tecnico e cria o grant (connection_logs ativo) atomicamente. Limite = tenants.max_concurrent_per_tech ?? plans.max_concurrent_per_tech; NULL = sem limite; super_admin isento. So service_role executa.';

-- So a Edge Function (service_role) chama. Nada de anon/authenticated.
revoke all on function public.create_access_grant(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_access_grant(uuid, uuid, text, text) to service_role;
