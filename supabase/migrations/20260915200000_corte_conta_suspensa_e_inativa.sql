-- AcessoFast, 15/09/2026: o corte por limite passa a valer para conta SUSPENSA e para
-- empresa INATIVADA — nos dois caminhos (painel e acesso direto).
--
-- O ERRO (achado no teste de 15/09, simulado no banco e desfeito):
--   tenants.billing_status e TEXTO com CHECK ('active','past_due','suspended') — e o que
--   os crons suspend_overdue_tenants (03:30) e suspend_expired_plans (03:35) gravam.
--   As tres funcoes do corte liam a coluna para uma variavel do ENUM public.billing_status
--   (active, trialing, dunning, blocked_trial, blocked_billing) e bloqueavam por
--   blocked_trial/blocked_billing — valores que a coluna nunca pode ter. Resultado:
--     * active     funcionava por coincidencia (existe nos dois);
--     * past_due / suspended  o cast estourava "invalid input value for enum":
--         - painel: billing_eligibility falhava -> connect-device 500 eligibility_failed;
--         - ACESSO DIRETO: meter_external_session falhava -> a session-ingest faz
--           fail-open -> sessao liberada SEM medir e SEM corte.
--     * billing_blocked nunca disparava.
--
-- A REGRA (a mesma que os crons ja implementam):
--   past_due   carencia de 5 dias -> CONTINUA conectando (o banner avisa)
--   suspended  bloqueado -> painel recusa (billing_blocked), acesso direto e cortado
--
-- EMPRESA INATIVADA (tenants.is_active = false): o create_access_grant ja recusava
-- (conta_inativa), mas a billing_eligibility nao sabia disso (o painel descobria so no
-- grant, com erro generico) e a meter_external_session nem olhava — o acesso direto
-- liberava como free. Agora as tres recusam.
--
-- ORDEM NO ACESSO DIRETO: conta inativa e suspensa passam a ser checadas ANTES da
-- reconexao. Antes, uma reconexao dentro da janela do atendimento passava mesmo com a
-- conta bloqueada; o painel ja checava antes (create_access_grant), agora os dois iguais.
--
-- O que NAO muda: super_admin segue isento no painel; sessao ja em curso quando a conta
-- e suspensa nao e derrubada no meio (o corte e avaliado na abertura da sessao).

-- ============================================================================
-- 1) billing_eligibility (painel, etapa 1 — so leitura)
-- ============================================================================
create or replace function public.billing_eligibility(p_device_id uuid, p_actor uuid)
returns table(mode text, billing_status text, is_reconnect boolean, free_remaining integer, credit_balance integer, active_sessions integer, needs_choice boolean, auto_source text, blocked_reason text)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant uuid; v_rid text; v_role public.user_role;
  v_mode public.billing_mode; v_status text; v_tenant_ativa boolean;
  v_plan text; v_limit int;
  v_today date; v_used int; v_cap int; v_free int; v_bal int; v_live int; v_recon boolean;
begin
  select ab.tenant_id, ab.rustdesk_id into v_tenant, v_rid
    from public.address_book ab where ab.id = p_device_id;
  if v_tenant is null then
    blocked_reason := 'device_not_found'; return next; return;
  end if;

  select pr.role into v_role from public.profiles pr where pr.id = p_actor;

  -- billing_status e TEXTO na tabela (ver cabecalho) — nunca ler para o enum.
  select t.billing_mode, t.billing_status, t.max_concurrent_per_tech, t.plan_code, t.is_active
    into v_mode, v_status, v_limit, v_plan, v_tenant_ativa
    from public.tenants t where t.id = v_tenant;
  if v_limit is null and v_plan is not null then
    select pl.max_concurrent_per_tech into v_limit
      from public.plans pl where pl.code = v_plan;
  end if;

  -- Simultaneidade TENANT-WIDE por device vivo (mesma unidade do gate real),
  -- excluindo o proprio device (reconexao/multi-viewer do mesmo device = 1 acesso).
  select count(distinct cl.rustdesk_id)::int into v_live
    from public.connection_logs cl
   where cl.tenant_id = v_tenant
     and cl.status = 'active'::public.session_status
     and cl.rustdesk_id <> v_rid;

  -- Reconexao UNIFICADA por rustdesk_id (ignora tecnico/origem).
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

  mode := v_mode::text; billing_status := v_status; is_reconnect := v_recon;
  free_remaining := v_free; credit_balance := v_bal; active_sessions := v_live;
  needs_choice := false; auto_source := null; blocked_reason := null;

  -- Super admin = ACESSO GERAL: sem escolha, sem bloqueio.
  if v_role = 'super_admin'::public.user_role then
    auto_source := 'plan'; return next; return;
  end if;

  if v_tenant_ativa is false then
    blocked_reason := 'conta_inativa'; return next; return;
  end if;

  if v_status = 'suspended' then
    blocked_reason := 'billing_blocked'; return next; return;
  end if;

  -- Gate de simultaneidade TENANT-WIDE (antecipa o quota_exceeded do create_access_grant).
  -- NULL = ilimitado. Vem ANTES da reconexao (mesma ordem do gate real).
  if v_limit is not null and v_live >= v_limit then
    blocked_reason := 'quota_exceeded'; return next; return;
  end if;

  if v_recon then auto_source := 'reconnect'; return next; return; end if;
  if v_mode = 'plan'::public.billing_mode then auto_source := 'plan'; return next; return; end if;

  -- metrado (free + credito coexistem). "individual" = nenhuma OUTRA sessao viva.
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

-- ============================================================================
-- 2) create_access_grant (painel, etapa 2 — gate + emissao atomicos)
--    Unica mudanca: v_status vira texto e o bloqueio e por 'suspended'.
-- ============================================================================
create or replace function public.create_access_grant(p_device_id uuid, p_actor uuid, p_technician_email text default null::text, p_technician_ip text default null::text, p_source text default null::text)
returns table(grant_id uuid, tenant_id uuid, rustdesk_id text, effective_limit integer, active_before integer, source text, atendimento_id uuid, charged boolean)
language plpgsql
security definer
set search_path to ''
as $function$
#variable_conflict use_column
declare
  v_tenant uuid; v_rid text; v_active boolean; v_role public.user_role;
  v_plan text; v_limit integer; v_count integer; v_ip inet;
  v_mode public.billing_mode; v_status text;
  v_today date; v_free_used int; v_free_cap int; v_free_remaining int;
  v_balance int; v_atend public.atendimentos%rowtype;
  v_source public.atendimento_source; v_window interval; v_hardcap timestamptz;
  v_new_atend uuid; v_charged boolean := false; v_is_individual boolean;
  v_tenant_ativa boolean;
begin
  if p_actor is null then raise exception 'actor_obrigatorio'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_actor::text, 0));

  select ab.tenant_id, ab.rustdesk_id, ab.is_active
    into v_tenant, v_rid, v_active
    from public.address_book ab where ab.id = p_device_id;
  if v_tenant is null then raise exception 'device_not_found'; end if;
  if v_active is false then raise exception 'device_inativo'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text, 42));

  select pr.role into v_role from public.profiles pr where pr.id = p_actor;

  select t.max_concurrent_per_tech, t.plan_code, t.billing_mode, t.billing_status, t.is_active
    into v_limit, v_plan, v_mode, v_status, v_tenant_ativa
    from public.tenants t where t.id = v_tenant;
  if v_limit is null and v_plan is not null then
    select pl.max_concurrent_per_tech into v_limit
      from public.plans pl where pl.code = v_plan;
  end if;

  if v_role is distinct from 'super_admin'::public.user_role
     and v_tenant_ativa is false then
    raise exception 'conta_inativa'
      using errcode = 'P0001', detail = 'a empresa esta inativa';
  end if;

  if v_role is distinct from 'super_admin'::public.user_role
     and v_status = 'suspended' then
    raise exception 'billing_blocked'
      using errcode = 'P0001', detail = format('conta bloqueada (%s)', v_status);
  end if;

  select count(distinct cl.rustdesk_id)::int into v_count
    from public.connection_logs cl
   where cl.tenant_id = v_tenant
     and cl.status = 'active'::public.session_status
     and cl.rustdesk_id <> v_rid;

  begin v_ip := nullif(p_technician_ip, '')::inet; exception when others then v_ip := null; end;

  if v_role is distinct from 'super_admin'::public.user_role
     and v_limit is not null and v_count >= v_limit then
    raise exception 'quota_exceeded'
      using errcode = 'P0001',
            detail  = format('limite de %s sessao(oes) simultanea(s) do tenant atingido', v_limit);
  end if;

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

  if v_role = 'super_admin'::public.user_role then
    v_source := 'plan'::public.atendimento_source;
    v_window := interval '3 hours'; v_hardcap := null; v_charged := false;
  elsif v_mode = 'plan'::public.billing_mode then
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
$function$;

-- ============================================================================
-- 3) meter_external_session (acesso direto — chamada pela session-ingest)
--    blocked=true -> a session-ingest devolve hard_cap_at = agora e o agente corta.
-- ============================================================================
create or replace function public.meter_external_session(p_rustdesk_id text, p_connection_log_id uuid, p_peer_ip text default null::text)
returns table(atendimento_id uuid, source text, hard_cap_at timestamp with time zone, blocked boolean, reason text)
language plpgsql
security definer
set search_path to ''
as $function$
#variable_conflict use_column
declare
  v_device uuid; v_tenant uuid;
  v_mode public.billing_mode; v_status text; v_tenant_ativa boolean;
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

  select t.billing_mode, t.billing_status, t.max_concurrent_per_tech, t.plan_code, t.is_active
    into v_mode, v_status, v_limit, v_plan, v_tenant_ativa
    from public.tenants t where t.id = v_tenant;
  if v_limit is null and v_plan is not null then
    select pl.max_concurrent_per_tech into v_limit
      from public.plans pl where pl.code = v_plan;
  end if;

  -- Conta inativa/suspensa ANTES da reconexao: mesma ordem do painel.
  if v_tenant_ativa is false then
    blocked := true; reason := 'conta_inativa'; return next; return;
  end if;

  if v_status = 'suspended' then
    blocked := true; reason := 'billing_blocked'; return next; return;
  end if;

  begin v_peer := nullif(p_peer_ip, '')::inet; exception when others then v_peer := null; end;

  select count(distinct cl.rustdesk_id)::int into v_active
    from public.connection_logs cl
   where cl.tenant_id = v_tenant
     and cl.status = 'active'::public.session_status
     and cl.rustdesk_id <> p_rustdesk_id;

  if v_limit is not null and v_active >= v_limit then
    blocked := true; reason := 'quota_exceeded'; return next; return;
  end if;

  select * into v_atend
    from public.atendimentos a
   where a.rustdesk_id = p_rustdesk_id and a.ended_at is null and a.window_expires_at > now()
   order by a.started_at desc limit 1;
  if found then
    atendimento_id := v_atend.id; source := v_atend.source::text;
    hard_cap_at := v_atend.hard_cap_at; blocked := false; reason := null;
    return next; return;
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
$function$;
