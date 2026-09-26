-- Estorno do no-show: clique em Conectar que nunca virou sessao.
--
-- BUG: create_access_grant debita free/credito na EMISSAO da senha (etapa 2 do
-- edge connect-device), antes de qualquer sessao RustDesk abrir. O cron
-- close_stale_sessions ja detecta o no-show (Caso 2: log 'active' + sem
-- heartbeat + session_start ha mais de 5 min) e marca o log como 'failed' —
-- mas NAO estornava o acesso/credito. A maquina de estorno existe
-- (revoke_access_grant), so nao estava ligada aqui. Resultado: o cliente era
-- cobrado por conexao que nunca aconteceu.
--
-- FIX: no Caso 2, para cada log de no-show cujo atendimento associado esteja
-- charged, estornar (credito -> refund no ledger; free -> decrementa
-- daily_access.used do dia local) e encerrar o atendimento, ANTES de marcar o
-- log como failed. Preserva o log 'failed' para auditoria do no-show — por isso
-- nao chama revoke_access_grant direto (aquela funcao APAGA o log).
--
-- Guarda contra estorno duplo: no mesmo passo o log deixa de ser 'active', entao
-- a proxima rodada do cron nao o re-seleciona. Reconexao (log com charged=false
-- e sem atendimento proprio) cai no ramo sem estorno — correto, nao foi cobrada.
--
-- last_heartbeat_at is null continua sendo a guarda: sessao real ja teria
-- heartbeat via session-ingest em segundos (Caso 1 depende disso). 5 min sem
-- nenhum sinal = no-show de verdade.

create or replace function public.close_stale_sessions()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_c1 integer;
  v_c2 integer;
  v_c3 integer;
  r record;
begin
  -- Caso 1: sessao real que perdeu heartbeat (crash/queda) -> fecha no ultimo sinal de vida.
  update public.connection_logs
     set status = 'ended',
         session_end = last_heartbeat_at,
         notes = coalesce(notes,'') || ' [auto-close: heartbeat perdido]'
   where status = 'active'
     and last_heartbeat_at is not null
     and last_heartbeat_at < now() - interval '90 seconds';
  get diagnostics v_c1 = row_count;

  -- Caso 2: clique no painel que nunca virou sessao -> ESTORNA e marca falha.
  v_c2 := 0;
  for r in
    select cl.id           as log_id,
           a.id            as atend_id,
           a.charged       as charged,
           a.source        as source,
           a.tenant_id     as tenant_id,
           a.started_at    as started_at
      from public.connection_logs cl
      left join public.atendimentos a on a.connection_log_id = cl.id
     where cl.status = 'active'
       and cl.last_heartbeat_at is null
       and cl.session_start < now() - interval '5 minutes'
  loop
    -- Estorno do que este grant cobrou (espelha revoke_access_grant, mas preserva
    -- o log para auditoria). Reconexao nao tem atendimento proprio -> atend_id null.
    if r.atend_id is not null and r.charged then
      if r.source = 'credit'::public.atendimento_source then
        insert into public.credit_ledger (tenant_id, entry_type, credits, atendimento_id, note)
          values (r.tenant_id, 'refund'::public.credit_entry_type, 1, r.atend_id,
                  'estorno: sessao nunca confirmada');
      elsif r.source = 'free'::public.atendimento_source then
        update public.daily_access
           set used = greatest(used - 1, 0), updated_at = now()
         where tenant_id = r.tenant_id
           and access_date = (r.started_at at time zone 'America/Sao_Paulo')::date;
      end if;
    end if;

    -- Encerra o atendimento: sem sessao nao ha janela de reconexao a preservar.
    if r.atend_id is not null then
      update public.atendimentos
         set ended_at = coalesce(ended_at, now())
       where id = r.atend_id;
    end if;

    -- Marca o log como falha (auditoria do no-show).
    update public.connection_logs
       set status = 'failed',
           session_end = session_start,
           notes = coalesce(notes,'') || ' [auto-close: sessao nunca confirmada, cobranca estornada]'
     where id = r.log_id;

    v_c2 := v_c2 + 1;
  end loop;

  -- Caso 3 (B6): atendimento cuja JANELA de reconexao ja venceu -> encerra.
  update public.atendimentos
     set ended_at = window_expires_at
   where ended_at is null
     and window_expires_at <= now();
  get diagnostics v_c3 = row_count;

  return coalesce(v_c1,0) + coalesce(v_c2,0) + coalesce(v_c3,0);
end;
$function$;
