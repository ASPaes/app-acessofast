-- =====================================================================
-- Billing B1 — HOTFIX: create_access_grant falhava no caminho FREE.
-- =====================================================================
-- Sintoma (pego no smoke test): connect de conta `free` retornava
--   ERROR 42702: column reference "tenant_id" is ambiguous
-- no upsert de daily_access:
--   insert into public.daily_access (tenant_id, ...)
--     on conflict (tenant_id, access_date) do update ...
-- Causa: a funcao tem um OUT param `tenant_id` (returns table). No
-- `on conflict (tenant_id, access_date)` o Postgres nao sabe se `tenant_id`
-- e a coluna ou a variavel. (O INSERT normal nao sofre: nomes na lista de
-- colunas sao sempre colunas. O caminho `plan` nao passa por esse upsert,
-- por isso so o free quebrava.)
-- Fix: pragma `#variable_conflict use_column` -> identificadores ambiguos em
-- SQL resolvem para a COLUNA (correto no ON CONFLICT). As atribuicoes finais
-- `tenant_id := v_tenant` (LHS) continuam sendo a variavel de saida.
-- Sem mudar assinatura nem colunas de retorno.
-- =====================================================================

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

revoke all on function public.create_access_grant(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.create_access_grant(uuid, uuid, text, text, text) to service_role;
