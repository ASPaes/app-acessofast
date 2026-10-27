-- AcessoFast, 27/10/2026: clique repetido no Conectar nao vira "falhou".
--
-- O que acontecia: cada clique em Conectar grava uma ficha em connection_logs. Se o
-- tecnico clica de novo antes da conexao chegar (ou o pedido sai duas vezes: em 24/10
-- duas fichas nasceram a 7 ms uma da outra), o segundo clique cai no ramo de
-- reconexao da create_access_grant e grava OUTRA ficha. O agente alimenta so a mais
-- recente (session-ingest, latestActive), e as anteriores ficam sem sinal: 5 min
-- depois a close_stale_sessions marca "falhou". Na Auditoria, 11 das 24 falhas da
-- semana eram isso, com o mesmo tecnico dentro da mesma maquina segundos depois.
--
-- Furo de cobranca junto: quando a ficha esquecida e a do 1o clique, e ela que segura
-- o atendimento. O cron estornava a cobranca e encerrava o atendimento com a sessao
-- (alimentada pela outra ficha) ainda aberta. Ate hoje so aconteceu com plano, sem
-- nada cobrado, mas em conta por credito o clique duplo daria o acesso de graca.
--
-- Aqui: create_access_grant reaproveita a ficha do clique anterior do MESMO tecnico na
-- MESMA maquina enquanto ela nao recebeu sinal (ate 2 min). Coluna nova de retorno
-- `reutilizado`: a connect-device nao pode desfazer um grant reaproveitado, porque
-- revoke_access_grant apagaria a ficha do clique que deu certo e estornaria.
--
-- O cron e a limpeza do passado ficam em 20261027170100_clique_repetido_limpeza.
--
-- Clique de OUTRO tecnico na mesma maquina continua gravando ficha propria: e outra
-- pessoa tentando, e a Auditoria deve mostrar.
--
-- A funcao muda de colunas de retorno, o que pede apagar a versao antiga. O conector
-- do Supabase recusa DROP, entao a antiga fica renomeada com sufixo _v1 e sem
-- permissao para ninguem.

alter function public.create_access_grant(uuid, uuid, text, text, text)
  rename to create_access_grant_v1;
revoke all on function public.create_access_grant_v1(uuid, uuid, text, text, text)
  from public, anon, authenticated, service_role;

create function public.create_access_grant(p_device_id uuid, p_actor uuid, p_technician_email text DEFAULT NULL::text, p_technician_ip text DEFAULT NULL::text, p_source text DEFAULT NULL::text)
 RETURNS TABLE(grant_id uuid, tenant_id uuid, rustdesk_id text, effective_limit integer, active_before integer, source text, atendimento_id uuid, charged boolean, reutilizado boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_tenant uuid; v_rid text; v_active boolean; v_role public.user_role;
  v_plan text; v_limit integer; v_count integer; v_ip inet;
  v_seat integer; v_total integer; v_count_tec integer;
  v_mode public.billing_mode; v_status text;
  v_today date; v_free_used int; v_free_cap int; v_free_remaining int;
  v_balance int; v_atend public.atendimentos%rowtype;
  v_source public.atendimento_source; v_window interval; v_hardcap timestamptz;
  v_new_atend uuid; v_charged boolean := false; v_is_individual boolean;
  v_tenant_ativa boolean; v_reuso uuid;
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

  select t.max_concurrent_per_tech, t.plan_code, t.billing_mode, t.billing_status, t.is_active, t.seat_limit
    into v_limit, v_plan, v_mode, v_status, v_tenant_ativa, v_seat
    from public.tenants t where t.id = v_tenant;
  if v_limit is null and v_plan is not null then
    select pl.max_concurrent_per_tech into v_limit
      from public.plans pl where pl.code = v_plan;
  end if;
  v_total := private.teto_total_simultaneo(v_limit, v_seat);

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

  if v_role is distinct from 'super_admin'::public.user_role
     and private.usuarios_acima_do_plano(v_tenant) then
    raise exception 'usuarios_acima_do_plano'
      using errcode = 'P0001', detail = 'mais usuarios ativos que o plano permite';
  end if;

  select count(distinct cl.rustdesk_id)::int,
         (count(distinct cl.rustdesk_id) filter (where cl.technician_id = p_actor))::int
    into v_count, v_count_tec
    from public.connection_logs cl
   where cl.tenant_id = v_tenant
     and cl.status = 'active'::public.session_status
     and cl.rustdesk_id <> v_rid
     and coalesce(cl.last_heartbeat_at, cl.session_start) > now() - interval '2 minutes';

  begin v_ip := nullif(p_technician_ip, '')::inet; exception when others then v_ip := null; end;

  if v_role is distinct from 'super_admin'::public.user_role
     and v_limit is not null and v_count_tec >= v_limit then
    raise exception 'quota_exceeded'
      using errcode = 'P0001',
            detail  = format('limite de %s acesso(s) simultaneo(s) por tecnico atingido', v_limit);
  end if;
  if v_role is distinct from 'super_admin'::public.user_role
     and v_total is not null and v_count >= v_total then
    raise exception 'quota_exceeded'
      using errcode = 'P0001',
            detail  = format('limite de %s acesso(s) simultaneo(s) da empresa atingido', v_total);
  end if;

  -- Clique repetido: o mesmo tecnico ja tem a ficha de um clique nesta maquina e a
  -- conexao ainda nao chegou. Devolve a mesma ficha em vez de gravar outra, que ficaria
  -- sem sinal e viraria "falhou". O lock por tecnico acima serializa os cliques, entao
  -- o segundo pedido sempre enxerga a ficha do primeiro.
  --
  -- session_start vai para agora: a conta dos 5 min do cron e a isencao do horario de
  -- acesso (primeiro_sinal_em) passam a valer a partir do ultimo clique.
  select cl.id into v_reuso
    from public.connection_logs cl
   where cl.rustdesk_id = v_rid
     and cl.tenant_id = v_tenant
     and cl.technician_id = p_actor
     and cl.status = 'active'::public.session_status
     and cl.last_heartbeat_at is null
     and cl.session_start > now() - interval '2 minutes'
   order by cl.session_start desc limit 1;
  if found then
    update public.connection_logs cl
       set session_start = now(),
           technician_ip = coalesce(v_ip, cl.technician_ip)
     where cl.id = v_reuso;

    -- O atendimento e o desta ficha (1o clique) ou o aberto da maquina (reconexao).
    select * into v_atend
      from public.atendimentos a where a.connection_log_id = v_reuso;
    if not found then
      select * into v_atend
        from public.atendimentos a
       where a.rustdesk_id = v_rid
         and a.tenant_id = v_tenant
         and a.ended_at is null and a.window_expires_at > now()
       order by a.started_at desc limit 1;
    end if;

    grant_id := v_reuso; tenant_id := v_tenant; rustdesk_id := v_rid; effective_limit := v_limit;
    active_before := v_count; source := v_atend.source::text;
    atendimento_id := v_atend.id; charged := false; reutilizado := true;
    return next; return;
  end if;

  select * into v_atend
    from public.atendimentos a
   where a.rustdesk_id = v_rid
     and a.tenant_id = v_tenant
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
    atendimento_id := v_atend.id; charged := false; reutilizado := false;
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
  atendimento_id := v_new_atend; charged := v_charged; reutilizado := false;
  return next;
end;
$function$;

revoke all on function public.create_access_grant(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.create_access_grant(uuid, uuid, text, text, text) to service_role;
