-- =====================================================================
-- Billing B6 fix — teto de SIMULTÂNEAS por tenant na sessão direta (.exe).
-- =====================================================================
-- Bug: meter_external_session só limitava o FREE (1/tenant). Em plano a
-- direta era "ilimitada" (sem técnico p/ gate) e em crédito não tinha teto
-- nenhum — então "acessos simultâneos excederam o limite" NUNCA virava
-- `blocked` e o agente nunca cortava. A sessão direta não carrega identidade
-- de técnico, então o gate por-técnico do painel (create_access_grant) não é
-- aplicável; a unidade medível aqui é o TENANT.
--
-- Fix: gate tenant-wide antes de decidir a fonte. Limite efetivo =
-- tenants.max_concurrent_per_tech (fallback: plans.max_concurrent_per_tech
-- do plan_code). Conta atendimentos ABERTOS do tenant (ended_at null e janela
-- viva); se count >= limite -> blocked('quota_exceeded'). NULL = ilimitado.
-- Vale p/ plano E crédito. A reconexão unificada continua vindo ANTES (não
-- conta, não cobra). O session-ingest já propaga qualquer `blocked` como
-- hard_cap_at = agora -> o agente (checkHardCap) derruba a sessão.
--
-- Base = 20260727150000 (meter_external_session). create_access_grant não muda.
-- =====================================================================

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
  -- Device precisa estar ADOTADO (address_book). Sessao em device nao-adotado
  -- nao e medivel aqui (auto-adocao e fase seguinte do B6).
  select ab.id, ab.tenant_id into v_device, v_tenant
    from public.address_book ab
   where ab.rustdesk_id = p_rustdesk_id and ab.is_active is distinct from false
   limit 1;
  if v_tenant is null then
    blocked := true; reason := 'device_not_registered'; return next; return;
  end if;

  -- Serializa por tenant (concorrencia do free E do gate de simultaneas:
  -- decisao/contagem/insert atomicos — sem corrida entre dois .exe do tenant).
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text, 42));

  select t.billing_mode, t.billing_status, t.max_concurrent_per_tech, t.plan_code
    into v_mode, v_status, v_limit, v_plan
    from public.tenants t where t.id = v_tenant;
  if v_limit is null and v_plan is not null then
    select pl.max_concurrent_per_tech into v_limit
      from public.plans pl where pl.code = v_plan;
  end if;

  begin v_peer := nullif(p_peer_ip, '')::inet; exception when others then v_peer := null; end;

  -- Reconexao UNIFICADA: atendimento aberto p/ este rustdesk na janela -> nao cobra
  -- e NAO passa pelo gate (mesma sessao logica). Vem ANTES da contagem de simultaneas.
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

  -- Simultaneas ABERTAS do tenant (atendimento vivo). Base do gate e tambem do
  -- caso "free = individual" (v_active = 0). Conta painel + direta (unificado).
  select count(*)::int into v_active
    from public.atendimentos a
   where a.tenant_id = v_tenant and a.ended_at is null and a.window_expires_at > now();

  -- GATE de simultaneas POR TENANT (B6): sessao direta nao tem tecnico p/ o gate
  -- por-tecnico do painel; a unidade medivel e o tenant. Excedeu o teto do
  -- plano/tenant -> corta. NULL = ilimitado (nao aplica). Vale p/ plano e credito.
  if v_limit is not null and v_active >= v_limit then
    blocked := true; reason := 'quota_exceeded'; return next; return;
  end if;

  if v_mode = 'plan'::public.billing_mode then
    -- Plano dentro do teto (ja checado): permite, nao cobra.
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

    -- free = individual (max 1 simultaneo POR TENANT). Direta nao tem tecnico p/ contar.
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
