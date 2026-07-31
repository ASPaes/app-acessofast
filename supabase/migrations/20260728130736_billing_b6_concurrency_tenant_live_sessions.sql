-- =====================================================================
-- Billing B6 fix — simultaneidade medida em SESSÕES VIVAS do tenant.
-- =====================================================================
-- Bug (reportado): conta `individual` (max_concurrent_per_tech=1) conseguiu
-- 2 conexões ao mesmo tempo — 1 direta (.exe) + 1 painel — em devices distintos.
--
-- Causa raiz: cada trilha era cega para a outra.
--  • create_access_grant (painel) contava connection_logs POR TÉCNICO
--    (technician_id = ator). A sessão direta tem technician_id NULL -> invisível.
--  • meter_external_session (direta) contava ATENDIMENTOS (janela lógica de 2h);
--    a direta ainda unificava com um atendimento free aberto e pulava o gate.
--  • o teto era `por técnico`, não do tenant.
--
-- Fix: a unidade de "conexões simultâneas" passa a ser SESSÃO VIVA
-- (connection_logs.status='active'), contada por DEVICE distinto no TENANT
-- inteiro (ignora técnico e origem), EXCLUINDO o próprio device (reconexão /
-- múltiplos controladores do mesmo device = 1 acesso). O gate roda ANTES da
-- unificação de reconexão e vale para as DUAS trilhas. Um advisory lock por
-- tenant (mesma chave nas duas funções) serializa painel×direta e fecha a
-- corrida sub-segundo entre grants concorrentes. NULL = ilimitado. super_admin
-- isento. Reconexão ao MESMO device (outro device não vivo) continua livre.
--
-- Rollback: reaplicar 20260727150000 (create_access_grant) e 20260727170000
-- (meter_external_session).
-- =====================================================================

-- ---------------------------------------------------------------------
-- (1) create_access_grant — gate tenant-wide por sessão viva (trilha painel).
-- ---------------------------------------------------------------------
create or replace function public.create_access_grant(
  p_device_id        uuid,
  p_actor            uuid,
  p_technician_email text default null,
  p_technician_ip    text default null,
  p_source           text default null
)
returns table (
  grant_id        uuid,
  tenant_id       uuid,
  rustdesk_id     text,
  effective_limit integer,
  active_before   integer,
  source          text,
  atendimento_id  uuid,
  charged         boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tenant uuid; v_rid text; v_active boolean; v_role public.user_role;
  v_plan text; v_limit integer; v_count integer; v_ip inet;
  v_mode public.billing_mode; v_status public.billing_status;
  v_today date; v_free_used int; v_free_cap int; v_free_remaining int;
  v_balance int; v_atend public.atendimentos%rowtype;
  v_source public.atendimento_source; v_window interval; v_hardcap timestamptz;
  v_new_atend uuid; v_charged boolean := false; v_is_individual boolean;
begin
  if p_actor is null then raise exception 'actor_obrigatorio'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_actor::text, 0));

  select ab.tenant_id, ab.rustdesk_id, ab.is_active
    into v_tenant, v_rid, v_active
    from public.address_book ab where ab.id = p_device_id;
  if v_tenant is null then raise exception 'device_not_found'; end if;
  if v_active is false then raise exception 'device_inativo'; end if;

  -- Serializa por TENANT (mesma chave da meter_external_session) -> painel e direta
  -- do mesmo tenant não decidem a simultaneidade em paralelo.
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text, 42));

  select pr.role into v_role from public.profiles pr where pr.id = p_actor;

  select t.max_concurrent_per_tech, t.plan_code, t.billing_mode, t.billing_status
    into v_limit, v_plan, v_mode, v_status
    from public.tenants t where t.id = v_tenant;
  if v_limit is null and v_plan is not null then
    select pl.max_concurrent_per_tech into v_limit
      from public.plans pl where pl.code = v_plan;
  end if;

  -- Gate de estado (trial/dunning). super_admin isento.
  if v_role is distinct from 'super_admin'::public.user_role
     and v_status in ('blocked_trial'::public.billing_status, 'blocked_billing'::public.billing_status) then
    raise exception 'billing_blocked'
      using errcode = 'P0001', detail = format('conta bloqueada (%s)', v_status);
  end if;

  -- SIMULTANEIDADE TENANT-WIDE por DEVICE vivo (não por técnico): a direta tem
  -- technician_id null e era invisível ao gate por-técnico -> individual conseguia
  -- 1 direta + 1 painel. Conta devices distintos com sessão VIVA no tenant, exceto
  -- o próprio device (reconexão / múltiplos controladores do mesmo device = 1 acesso).
  select count(distinct cl.rustdesk_id)::int into v_count
    from public.connection_logs cl
   where cl.tenant_id = v_tenant
     and cl.status = 'active'::public.session_status
     and cl.rustdesk_id <> v_rid;

  begin v_ip := nullif(p_technician_ip, '')::inet; exception when others then v_ip := null; end;

  -- GATE de simultaneidade — ANTES da unificação (senão o reconnect ao device A
  -- fura o teto enquanto o device B está vivo). super_admin isento; NULL = ilimitado.
  if v_role is distinct from 'super_admin'::public.user_role
     and v_limit is not null and v_count >= v_limit then
    raise exception 'quota_exceeded'
      using errcode = 'P0001',
            detail  = format('limite de %s sessao(oes) simultanea(s) do tenant atingido', v_limit);
  end if;

  -- ---- RECONEXAO dentro da janela — UNIFICADA por rustdesk_id (ignora tecnico/
  --      origem). Mesmo device na janela = mesmo atendimento -> NAO cobra.
  select * into v_atend
    from public.atendimentos a
   where a.rustdesk_id = v_rid
     and a.ended_at is null and a.window_expires_at > now()
   order by a.started_at desc limit 1;
  if found then
    insert into public.connection_logs
      (tenant_id, address_book_id, rustdesk_id, technician_id, technician_email, technician_ip, status, session_start)
    values
      (v_tenant, p_device_id, v_rid, p_actor, p_technician_email, v_ip, 'active'::public.session_status, now())
    returning id into grant_id;
    tenant_id := v_tenant; rustdesk_id := v_rid; effective_limit := v_limit;
    active_before := v_count; source := v_atend.source::text;
    atendimento_id := v_atend.id; charged := false;
    return next; return;
  end if;

  -- ---- NOVO atendimento -----------------------------------------------
  if v_role = 'super_admin'::public.user_role then
    v_source := 'plan'::public.atendimento_source;
    v_window := interval '3 hours'; v_hardcap := null; v_charged := false;
  elsif v_mode = 'plan'::public.billing_mode then
    -- teto já checado no gate tenant-wide acima.
    v_source := 'plan'::public.atendimento_source;
    v_window := interval '3 hours'; v_hardcap := null; v_charged := false;
  else
    v_today := (now() at time zone 'America/Sao_Paulo')::date;
    select da.used, da.cap into v_free_used, v_free_cap
      from public.daily_access da
     where da.tenant_id = v_tenant and da.access_date = v_today;
    v_free_remaining := greatest(coalesce(v_free_cap, 5) - coalesce(v_free_used, 0), 0);

    select coalesce(sum(c.credits), 0)::int into v_balance
      from public.credit_ledger c where c.tenant_id = v_tenant;

    -- individual = nenhuma OUTRA sessão viva no tenant.
    v_is_individual := (v_count = 0);

    if p_source = 'free' then
      if not v_is_individual then raise exception 'free_requires_individual' using errcode = 'P0001'; end if;
      if v_free_remaining <= 0 then raise exception 'free_exhausted' using errcode = 'P0001'; end if;
      v_source := 'free'::public.atendimento_source;
    elsif p_source = 'credit' then
      if v_balance <= 0 then raise exception 'no_credits' using errcode = 'P0001'; end if;
      v_source := 'credit'::public.atendimento_source;
    else
      if v_is_individual and v_free_remaining > 0 and v_balance > 0 then
        raise exception 'choice_required' using errcode = 'P0001';
      elsif v_is_individual and v_free_remaining > 0 then
        v_source := 'free'::public.atendimento_source;
      elsif v_balance > 0 then
        v_source := 'credit'::public.atendimento_source;
      else
        raise exception 'no_credits' using errcode = 'P0001';
      end if;
    end if;

    if v_source = 'free'::public.atendimento_source then
      v_window := interval '2 hours'; v_hardcap := now() + interval '2 hours';
      insert into public.daily_access (tenant_id, access_date, used, cap)
        values (v_tenant, v_today, 1, coalesce(v_free_cap, 5))
        on conflict (tenant_id, access_date)
        do update set used = daily_access.used + 1, updated_at = now();
      v_charged := true;
    else
      v_window := interval '3 hours'; v_hardcap := null; v_charged := true;
    end if;
  end if;

  insert into public.connection_logs
    (tenant_id, address_book_id, rustdesk_id, technician_id, technician_email, technician_ip, status, session_start)
  values
    (v_tenant, p_device_id, v_rid, p_actor, p_technician_email, v_ip, 'active'::public.session_status, now())
  returning id into grant_id;

  insert into public.atendimentos
    (tenant_id, technician_id, address_book_id, rustdesk_id, source, connection_log_id,
     started_at, window_expires_at, hard_cap_at, charged)
  values
    (v_tenant, p_actor, p_device_id, v_rid, v_source, grant_id,
     now(), now() + v_window, v_hardcap, v_charged)
  returning id into v_new_atend;

  if v_source = 'credit'::public.atendimento_source then
    insert into public.credit_ledger (tenant_id, entry_type, credits, atendimento_id, note)
      values (v_tenant, 'consume'::public.credit_entry_type, -1, v_new_atend, 'consumo de atendimento');
  end if;

  tenant_id := v_tenant; rustdesk_id := v_rid; effective_limit := v_limit;
  active_before := v_count; source := v_source::text;
  atendimento_id := v_new_atend; charged := v_charged;
  return next;
end;
$$;

revoke all on function public.create_access_grant(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.create_access_grant(uuid, uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------
-- (2) meter_external_session — mesmo gate (trilha direta / .exe).
-- ---------------------------------------------------------------------
create or replace function public.meter_external_session(
  p_rustdesk_id       text,
  p_connection_log_id uuid,
  p_peer_ip           text default null
)
returns table (
  atendimento_id uuid,
  source         text,
  hard_cap_at    timestamptz,
  blocked        boolean,
  reason         text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_device uuid; v_tenant uuid;
  v_mode public.billing_mode; v_status public.billing_status;
  v_plan text; v_limit int;
  v_atend public.atendimentos%rowtype;
  v_today date; v_free_used int; v_free_cap int; v_free_remaining int;
  v_balance int; v_active int; v_source public.atendimento_source;
  v_window interval; v_hardcap timestamptz; v_charged boolean := false;
  v_peer inet; v_new uuid;
begin
  select ab.id, ab.tenant_id into v_device, v_tenant
    from public.address_book ab
   where ab.rustdesk_id = p_rustdesk_id and ab.is_active is distinct from false
   limit 1;
  if v_tenant is null then
    blocked := true; reason := 'device_not_registered'; return next; return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text, 42));

  select t.billing_mode, t.billing_status, t.max_concurrent_per_tech, t.plan_code
    into v_mode, v_status, v_limit, v_plan
    from public.tenants t where t.id = v_tenant;
  if v_limit is null and v_plan is not null then
    select pl.max_concurrent_per_tech into v_limit
      from public.plans pl where pl.code = v_plan;
  end if;

  begin v_peer := nullif(p_peer_ip, '')::inet; exception when others then v_peer := null; end;

  -- SIMULTANEIDADE TENANT-WIDE por DEVICE vivo (connection_logs). Exclui o próprio
  -- device (a session-ingest já inseriu o log desta sessão antes de chamar aqui).
  select count(distinct cl.rustdesk_id)::int into v_active
    from public.connection_logs cl
   where cl.tenant_id = v_tenant
     and cl.status = 'active'::public.session_status
     and cl.rustdesk_id <> p_rustdesk_id;

  -- GATE — ANTES da unificação. Excedeu o teto do tenant -> corta. NULL = ilimitado.
  if v_limit is not null and v_active >= v_limit then
    blocked := true; reason := 'quota_exceeded'; return next; return;
  end if;

  -- Reconexao UNIFICADA (mesmo device, janela viva): nao cobra.
  select * into v_atend
    from public.atendimentos a
   where a.rustdesk_id = p_rustdesk_id and a.ended_at is null and a.window_expires_at > now()
   order by a.started_at desc limit 1;
  if found then
    atendimento_id := v_atend.id; source := v_atend.source::text;
    hard_cap_at := v_atend.hard_cap_at; blocked := false; reason := null;
    return next; return;
  end if;

  if v_status in ('blocked_trial'::public.billing_status, 'blocked_billing'::public.billing_status) then
    blocked := true; reason := 'billing_blocked'; return next; return;
  end if;

  if v_mode = 'plan'::public.billing_mode then
    v_source := 'plan'::public.atendimento_source;
    v_window := interval '3 hours'; v_hardcap := null; v_charged := false;
  else
    v_today := (now() at time zone 'America/Sao_Paulo')::date;
    select da.used, da.cap into v_free_used, v_free_cap
      from public.daily_access da where da.tenant_id = v_tenant and da.access_date = v_today;
    v_free_remaining := greatest(coalesce(v_free_cap, 5) - coalesce(v_free_used, 0), 0);

    select coalesce(sum(c.credits), 0)::int into v_balance
      from public.credit_ledger c where c.tenant_id = v_tenant;

    -- individual = nenhuma OUTRA sessão viva (v_active = 0).
    if v_active = 0 and v_free_remaining > 0 then
      v_source := 'free'::public.atendimento_source;
      v_window := interval '2 hours'; v_hardcap := now() + interval '2 hours';
      insert into public.daily_access (tenant_id, access_date, used, cap)
        values (v_tenant, v_today, 1, coalesce(v_free_cap, 5))
        on conflict (tenant_id, access_date)
        do update set used = daily_access.used + 1, updated_at = now();
      v_charged := true;
    elsif v_balance > 0 then
      v_source := 'credit'::public.atendimento_source;
      v_window := interval '3 hours'; v_hardcap := null; v_charged := true;
    else
      blocked := true; reason := 'no_credits'; return next; return;
    end if;
  end if;

  insert into public.atendimentos
    (tenant_id, technician_id, address_book_id, rustdesk_id, source, connection_log_id,
     origin, peer_ip, started_at, window_expires_at, hard_cap_at, charged)
  values
    (v_tenant, null, v_device, p_rustdesk_id, v_source, p_connection_log_id,
     'direct', v_peer, now(), now() + v_window, v_hardcap, v_charged)
  returning id into v_new;

  if v_source = 'credit'::public.atendimento_source then
    insert into public.credit_ledger (tenant_id, entry_type, credits, atendimento_id, note)
      values (v_tenant, 'consume'::public.credit_entry_type, -1, v_new, 'consumo de atendimento (acesso direto)');
  end if;

  atendimento_id := v_new; source := v_source::text; hard_cap_at := v_hardcap;
  blocked := false; reason := null; return next;
end;
$$;

revoke all on function public.meter_external_session(text, uuid, text) from public, anon, authenticated;
grant execute on function public.meter_external_session(text, uuid, text) to service_role;
