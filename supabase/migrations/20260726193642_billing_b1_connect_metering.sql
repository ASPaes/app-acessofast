-- =====================================================================
-- AcessoFast — Billing B1: metering no choke point (BILLING-DESIGN.md §2/§8).
-- =====================================================================
-- Insere a DECISAO DE COBRANCA no unico ponto de emissao de credencial
-- (create_access_grant, chamado so pela edge connect-device). Depende da B0.
--
-- Entrega:
--   1. Backfill: tenants com plano -> billing_mode='plan' (senao ficariam 'free'
--      e passariam a ser metrados indevidamente).
--   2. billing_eligibility(device, actor) — READ-ONLY: informa ao painel se
--      precisa escolher free x credito, saldos, e a fonte automatica. Sem efeito.
--   3. create_access_grant(...) v2 — AUTORITATIVO sob advisory lock:
--        • mode-aware: plano = so gate de concorrencia (como hoje);
--          metrado (free+credito coexistem) = algoritmo §2.
--        • reconexao dentro da janela (2h free / 3h credito) NAO cobra.
--        • grava `atendimentos` e debita `credit_ledger`/`daily_access`
--          na MESMA transacao do grant.
--   4. revoke_access_grant(grant_id) — desfaz grant + atendimento + ESTORNA
--        o debito, atomicamente. Substitui o rollback "delete connection_logs"
--        da edge (que nao revertia cobranca — achado A da validacao).
--
-- Regra de concorrencia por modo: free = max 1 simultanea; credito = ilimitada;
-- plano = plans/tenants.max_concurrent_per_tech (inalterado).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Backfill do modo a partir da realidade (antes do gate entrar no ar).
-- ---------------------------------------------------------------------
update public.tenants
   set billing_mode = 'plan'::public.billing_mode
 where plan_code is not null
   and billing_mode = 'free'::public.billing_mode;
-- Contas sem plano permanecem 'free'. 'credits' passa a valer quando uma
-- compra e postada (B3); o algoritmo trata 'free' e 'credits' identicamente
-- (free diario + saldo de credito coexistem).

-- ---------------------------------------------------------------------
-- 2. billing_eligibility — leitura pro painel (modal de escolha). Sem efeito.
-- ---------------------------------------------------------------------
create or replace function public.billing_eligibility(
  p_device_id uuid,
  p_actor     uuid
)
returns table (
  mode            text,
  billing_status  text,
  is_reconnect    boolean,
  free_remaining  integer,
  credit_balance  integer,
  active_sessions integer,
  needs_choice    boolean,
  auto_source     text,     -- 'free' | 'credit' | 'plan' | 'reconnect' | null
  blocked_reason  text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid; v_rid text;
  v_mode public.billing_mode; v_status public.billing_status;
  v_today date; v_used int; v_cap int; v_free int; v_bal int; v_count int; v_recon boolean;
begin
  select ab.tenant_id, ab.rustdesk_id into v_tenant, v_rid
    from public.address_book ab where ab.id = p_device_id;
  if v_tenant is null then
    blocked_reason := 'device_not_found'; return next; return;
  end if;

  select t.billing_mode, t.billing_status into v_mode, v_status
    from public.tenants t where t.id = v_tenant;

  select count(*)::int into v_count
    from public.connection_logs cl
   where cl.technician_id = p_actor
     and cl.status = 'active'::public.session_status;

  select exists(
    select 1 from public.atendimentos a
     where a.technician_id = p_actor and a.rustdesk_id = v_rid
       and a.ended_at is null and a.window_expires_at > now()
  ) into v_recon;

  v_today := (now() at time zone 'America/Sao_Paulo')::date;
  select da.used, da.cap into v_used, v_cap
    from public.daily_access da
   where da.tenant_id = v_tenant and da.access_date = v_today;
  v_free := greatest(coalesce(v_cap, 5) - coalesce(v_used, 0), 0);

  select coalesce(sum(c.credits), 0)::int into v_bal
    from public.credit_ledger c where c.tenant_id = v_tenant;

  mode := v_mode::text; billing_status := v_status::text; is_reconnect := v_recon;
  free_remaining := v_free; credit_balance := v_bal; active_sessions := v_count;
  needs_choice := false; auto_source := null; blocked_reason := null;

  if v_status in ('blocked_trial'::public.billing_status, 'blocked_billing'::public.billing_status) then
    blocked_reason := 'billing_blocked'; return next; return;
  end if;
  if v_recon then auto_source := 'reconnect'; return next; return; end if;
  if v_mode = 'plan'::public.billing_mode then auto_source := 'plan'; return next; return; end if;

  -- metrado (free + credito coexistem)
  if v_count = 0 and v_free > 0 and v_bal > 0 then
    needs_choice := true;                      -- individual + tem free E credito -> escolher
  elsif v_count = 0 and v_free > 0 then
    auto_source := 'free';                     -- individual + so free
  elsif v_bal > 0 then
    auto_source := 'credit';                   -- simultaneo, ou free esgotado -> credito
  else
    blocked_reason := 'no_credits';            -- sem free e sem credito -> bloqueia
  end if;
  return next;
end;
$$;

comment on function public.billing_eligibility(uuid, uuid) is
  'READ-ONLY: informa ao painel se precisa escolher free x credito (needs_choice), saldos e a fonte automatica. Sem efeito colateral. So service_role executa.';

revoke all on function public.billing_eligibility(uuid, uuid) from public, anon, authenticated;
grant execute on function public.billing_eligibility(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------
-- 3. create_access_grant v2 — autoritativo (troca a assinatura -> DROP+CREATE)
-- ---------------------------------------------------------------------
drop function if exists public.create_access_grant(uuid, uuid, text, text);

create or replace function public.create_access_grant(
  p_device_id        uuid,
  p_actor            uuid,
  p_technician_email text default null,
  p_technician_ip    text default null,
  p_source           text default null   -- 'free' | 'credit' | null (auto/plano/reconexao)
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

  -- Serializa chamadas concorrentes do MESMO tecnico (count/decisao/insert atomicos).
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

  -- Sessoes ativas do tecnico (todas as tenants), ANTES da nova.
  select count(*)::int into v_count
    from public.connection_logs cl
   where cl.technician_id = p_actor
     and cl.status = 'active'::public.session_status;

  begin v_ip := nullif(p_technician_ip, '')::inet; exception when others then v_ip := null; end;

  -- ---- RECONEXAO dentro da janela? (mesmo tecnico -> mesmo rustdesk, atendimento aberto)
  select * into v_atend
    from public.atendimentos a
   where a.technician_id = p_actor and a.rustdesk_id = v_rid
     and a.ended_at is null and a.window_expires_at > now()
   order by a.started_at desc limit 1;
  if found then
    -- Mesmo atendimento logico: NAO cobra e NAO re-aplica o gate.
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
  if v_mode = 'plan'::public.billing_mode then
    -- Plano = comportamento de hoje: so gate de concorrencia, sem metering.
    if v_role is distinct from 'super_admin'::public.user_role
       and v_limit is not null and v_count >= v_limit then
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

    -- Resolve a fonte: honra p_source valido; senao decide (revalidando sob lock).
    if p_source = 'free' then
      if not v_is_individual then raise exception 'free_requires_individual' using errcode = 'P0001'; end if;
      if v_free_remaining <= 0 then raise exception 'free_exhausted' using errcode = 'P0001'; end if;
      v_source := 'free'::public.atendimento_source;
    elsif p_source = 'credit' then
      if v_balance <= 0 then raise exception 'no_credits' using errcode = 'P0001'; end if;
      v_source := 'credit'::public.atendimento_source;
    else
      -- auto
      if v_is_individual and v_free_remaining > 0 and v_balance > 0 then
        raise exception 'choice_required' using errcode = 'P0001';   -- painel deve escolher
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
    else  -- credito
      v_window := interval '3 hours'; v_hardcap := null; v_charged := true;
    end if;
  end if;

  -- Grant (connection_logs ativo).
  insert into public.connection_logs
    (tenant_id, address_book_id, rustdesk_id, technician_id, technician_email, technician_ip, status, session_start)
  values
    (v_tenant, p_device_id, v_rid, p_actor, p_technician_email, v_ip, 'active'::public.session_status, now())
  returning id into grant_id;

  -- Atendimento (unidade de cobranca) — connection_log_id = ESTE grant (marca "criador").
  insert into public.atendimentos
    (tenant_id, technician_id, address_book_id, rustdesk_id, source, connection_log_id,
     started_at, window_expires_at, hard_cap_at, charged)
  values
    (v_tenant, p_actor, p_device_id, v_rid, v_source, grant_id,
     now(), now() + v_window, v_hardcap, v_charged)
  returning id into v_new_atend;

  -- Debita credito depois de ter o atendimento (ledger referencia-o).
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

comment on function public.create_access_grant(uuid, uuid, text, text, text) is
  'Emissao-com-cobranca do connect: mode-aware. Plano = gate de concorrencia (como antes). Metrado = algoritmo free x credito (BILLING-DESIGN §2), grava atendimentos e debita credit_ledger/daily_access atomico com o grant. Reconexao dentro da janela nao cobra. p_source: free|credit|null(auto). So service_role executa.';

revoke all on function public.create_access_grant(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.create_access_grant(uuid, uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------
-- 4. revoke_access_grant — desfaz grant + atendimento + ESTORNA o debito.
-- ---------------------------------------------------------------------
create or replace function public.revoke_access_grant(p_grant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_atend public.atendimentos%rowtype;
begin
  if p_grant_id is null then return; end if;

  -- Atendimento CRIADO por este grant? (reconexao aponta pro grant ORIGINAL, nao este.)
  select * into v_atend
    from public.atendimentos a where a.connection_log_id = p_grant_id;

  if found then
    if v_atend.charged then
      if v_atend.source = 'credit'::public.atendimento_source then
        insert into public.credit_ledger (tenant_id, entry_type, credits, atendimento_id, note)
          values (v_atend.tenant_id, 'refund'::public.credit_entry_type, 1, v_atend.id, 'estorno: grant revogado');
      elsif v_atend.source = 'free'::public.atendimento_source then
        update public.daily_access
           set used = greatest(used - 1, 0), updated_at = now()
         where tenant_id = v_atend.tenant_id
           and access_date = (v_atend.started_at at time zone 'America/Sao_Paulo')::date;
      end if;
    end if;
    delete from public.atendimentos where id = v_atend.id;
  end if;

  -- Sempre remove o grant (connection_logs) — libera a quota.
  delete from public.connection_logs where id = p_grant_id;
end;
$$;

comment on function public.revoke_access_grant(uuid) is
  'Desfaz um grant emitido pelo connect quando a emissao falha depois (cripto/segredo): remove atendimento criado por este grant, estorna credito (refund) ou devolve o acesso free (daily_access-1), e deleta a linha de connection_logs. Reconexoes nao geram estorno. So service_role executa.';

-- NOTA: o revoke/grant de revoke_access_grant NAO entra aqui de proposito.
-- Esta migration foi aplicada em producao sem eles; quem fecha essas permissoes
-- e a 20260726193701_billing_b1_fix_revoke_grant_perms, 19 segundos depois.
-- Manter o arquivo fiel ao que rodou preserva a historia real do banco.

commit;
