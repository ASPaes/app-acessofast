-- Concorrencia PERSISTENTE no acesso direto (.exe).
--
-- BUG (teste 26/09): duas sessoes .exe simultaneas passavam o teto de 1.
--
-- Por que: no acesso direto a sessao JA esta aberta quando o agente reporta
-- 'start' — o servidor so pode CORTAR depois, devolvendo hard_cap = agora. Mas
-- meter_external_session so devolvia esse corte UMA vez, na resposta do 'start'.
-- Nos 'heartbeat' seguintes a session-ingest lia currentHardCap(), que devolve o
-- hard_cap do ATENDIMENTO (reusado por reconexao, com janela de 2h no futuro) —
-- e isso sobrescrevia o corte. Resultado: o corte da 2a sessao evaporava e as
-- duas ficavam vivas ate o tecnico desconectar.
--
-- Fix: uma funcao que a session-ingest chama em TODO start/heartbeat externo e
-- que devolve o hard_cap efetivo considerando os dois limites:
--   * o cap do atendimento (2h do free; null credito/plano), como antes;
--   * a CONCORRENCIA por ranking: se ha >= limite OUTRAS maquinas com sessao
--     viva que comecou ANTES desta, esta e uma sessao "extra" -> corta agora.
--     As sessoes mais ANTIGAS sobrevivem; as mais novas caem. Deterministico, e
--     reavaliado a cada heartbeat, entao o corte GRUDA ate a sessao morrer.
--
-- "Sessao viva" segue a mesma definicao do gate:
--   coalesce(last_heartbeat_at, session_start) > now() - interval '2 minutes'.

create or replace function public.external_session_hard_cap(p_rustdesk_id text)
returns timestamptz
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_tenant uuid; v_limit int; v_plan text;
  v_my_start timestamptz; v_older int; v_atend_cap timestamptz;
begin
  select ab.tenant_id into v_tenant
    from public.address_book ab where ab.rustdesk_id = p_rustdesk_id limit 1;
  if v_tenant is null then return null; end if;

  select t.max_concurrent_per_tech, t.plan_code into v_limit, v_plan
    from public.tenants t where t.id = v_tenant;
  if v_limit is null and v_plan is not null then
    select pl.max_concurrent_per_tech into v_limit
      from public.plans pl where pl.code = v_plan;
  end if;

  -- Inicio da sessao viva mais ANTIGA desta maquina (vale como "esta sessao").
  select min(cl.session_start) into v_my_start
    from public.connection_logs cl
   where cl.tenant_id = v_tenant
     and cl.rustdesk_id = p_rustdesk_id
     and cl.status = 'active'::public.session_status
     and coalesce(cl.last_heartbeat_at, cl.session_start) > now() - interval '2 minutes';

  -- Cap do atendimento aberto (mesma regra do currentHardCap da session-ingest):
  -- null = credito/plano (sem corte); vencido = corta agora; senao o instante.
  select case when a.hard_cap_at is null then null
              when a.hard_cap_at <= now() then now()
              else a.hard_cap_at end
    into v_atend_cap
    from public.atendimentos a
   where a.rustdesk_id = p_rustdesk_id and a.ended_at is null
   order by a.started_at desc limit 1;

  -- Concorrencia por ranking: OUTRAS maquinas com sessao viva iniciada ANTES.
  if v_limit is not null and v_my_start is not null then
    select count(distinct cl.rustdesk_id) into v_older
      from public.connection_logs cl
     where cl.tenant_id = v_tenant
       and cl.rustdesk_id <> p_rustdesk_id
       and cl.status = 'active'::public.session_status
       and coalesce(cl.last_heartbeat_at, cl.session_start) > now() - interval '2 minutes'
       and cl.session_start < v_my_start;
    if v_older >= v_limit then
      return now();   -- sessao "extra" -> corte imediato e PERSISTENTE
    end if;
  end if;

  return v_atend_cap;
end;
$function$;

revoke all on function public.external_session_hard_cap(text) from public, anon, authenticated;
grant execute on function public.external_session_hard_cap(text) to service_role;
