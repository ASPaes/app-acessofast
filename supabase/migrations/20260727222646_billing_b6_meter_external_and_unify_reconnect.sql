-- =====================================================================
-- Billing B6 — medição de acesso direto (.exe) + reconexão unificada.
-- =====================================================================
-- (1) create_access_grant: reconexão passa a casar por rustdesk_id+janela
--     (UNIFICADA, ignora técnico/origem) — decisão B6 nº3. Base = versão
--     20260727130000 (com bypass super_admin), só muda o WHERE da reconexão.
-- (2) meter_external_session(rustdesk_id, connection_log_id, peer_ip):
--     chamada pelo session-ingest na sessão externa. Auto free→crédito
--     (decisão nº1), sem técnico (technician_id null, origin 'direct'),
--     reconexão unificada, e devolve `blocked` quando sem saldo (decisão
--     nº2 — o session-ingest manda o agente cortar). Requer o schema B6
--     (20260727140000: technician_id nullable + origin + peer_ip).
-- =====================================================================

-- ---------------------------------------------------------------------
-- (1) create_access_grant — reconexão unificada por rustdesk_id.
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

  select count(*)::int into v_count
    from public.connection_logs cl
   where cl.technician_id = p_actor
     and cl.status = 'active'::public.session_status;

  begin v_ip := nullif(p_technician_ip, '')::inet; exception when others then v_ip := null; end;

  -- ---- RECONEXAO dentro da janela — B6: UNIFICADA por rustdesk_id (ignora
  --      tecnico/origem). Painel apos direto (ou vice-versa) ao mesmo device na
  --      janela = mesmo atendimento logico -> NAO cobra e NAO re-aplica o gate.
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
    -- Super admin = ACESSO GERAL: sem gate, sem medicao, sem cobranca.
    v_source := 'plan'::public.atendimento_source;
    v_window := interval '3 hours'; v_hardcap := null; v_charged := false;
  elsif v_mode = 'plan'::public.billing_mode then
    if v_limit is not null and v_count >= v_limit then
      raise exception 'quota_exceeded'
        using errcode = 'P0001',
              detail  = format('limite de %s sessoes simultaneas por tecnico atingido', v_limit);
    end if;
    v_source := 'plan'::public.atendimento_source;
    v_window := interval '3 hours'; v_hardcap := null; v_charged := false;
  else
    -- Metrado: free (teto 5/dia, GMT-3) + credito coexistem.
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
$$;

revoke all on function public.create_access_grant(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.create_access_grant(uuid, uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------
-- (2) meter_external_session — medição da sessão direta (.exe).
--     Chamada pelo session-ingest (service_role) quando detecta sessão externa.
--     Auto free→crédito, sem técnico, reconexão unificada, corte se sem saldo.
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
  v_atend public.atendimentos%rowtype;
  v_today date; v_free_used int; v_free_cap int; v_free_remaining int;
  v_balance int; v_active int; v_source public.atendimento_source;
  v_window interval; v_hardcap timestamptz; v_charged boolean := false;
  v_peer inet; v_new uuid;
begin
  -- Device precisa estar ADOTADO (address_book). Sessao em device nao-adotado
  -- nao e medivel aqui (auto-adocao e fase seguinte do B6).
  select ab.id, ab.tenant_id into v_device, v_tenant
    from public.address_book ab
   where ab.rustdesk_id = p_rustdesk_id and ab.is_active is distinct from false
   limit 1;
  if v_tenant is null then
    blocked := true; reason := 'device_not_registered'; return next; return;
  end if;

  -- Serializa por tenant (concorrencia do free: decisao/insert atomicos).
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text, 42));

  select t.billing_mode, t.billing_status into v_mode, v_status
    from public.tenants t where t.id = v_tenant;

  begin v_peer := nullif(p_peer_ip, '')::inet; exception when others then v_peer := null; end;

  -- Reconexao UNIFICADA: atendimento aberto p/ este rustdesk na janela -> nao cobra.
  select * into v_atend
    from public.atendimentos a
   where a.rustdesk_id = p_rustdesk_id and a.ended_at is null and a.window_expires_at > now()
   order by a.started_at desc limit 1;
  if found then
    atendimento_id := v_atend.id; source := v_atend.source::text;
    hard_cap_at := v_atend.hard_cap_at; blocked := false; reason := null;
    return next; return;
  end if;

  -- Estado bloqueado (trial/dunning): sessao direta nao tem super -> corta.
  if v_status in ('blocked_trial'::public.billing_status, 'blocked_billing'::public.billing_status) then
    blocked := true; reason := 'billing_blocked'; return next; return;
  end if;

  if v_mode = 'plan'::public.billing_mode then
    -- Plano = ilimitado; direta nao tem tecnico p/ gate -> permite, nao cobra.
    v_source := 'plan'::public.atendimento_source;
    v_window := interval '3 hours'; v_hardcap := null; v_charged := false;
  else
    -- Metrado: auto free->credito (sem modal).
    v_today := (now() at time zone 'America/Sao_Paulo')::date;
    select da.used, da.cap into v_free_used, v_free_cap
      from public.daily_access da where da.tenant_id = v_tenant and da.access_date = v_today;
    v_free_remaining := greatest(coalesce(v_free_cap, 5) - coalesce(v_free_used, 0), 0);

    select coalesce(sum(c.credits), 0)::int into v_balance
      from public.credit_ledger c where c.tenant_id = v_tenant;

    -- free = max 1 simultaneo POR TENANT (direta nao tem tecnico p/ contar).
    select count(*)::int into v_active
      from public.atendimentos a
     where a.tenant_id = v_tenant and a.ended_at is null and a.window_expires_at > now();

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
