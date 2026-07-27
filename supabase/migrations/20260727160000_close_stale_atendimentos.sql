-- =====================================================================
-- Billing B6 fix — close_stale_sessions() passa a encerrar ATENDIMENTOS.
-- =====================================================================
-- Bug: nada fechava atendimentos. A edge function (evento 'end') e este cron
-- so encerravam connection_logs; atendimentos ficavam com ended_at = null p/
-- sempre, mesmo muito depois da janela de reconexao vencer. Efeitos:
--   • painel/consumo enxergava sessoes "eternamente em andamento";
--   • a deduplicacao de reconexao (create_access_grant / meter_external_session)
--     casava contra atendimentos mortos.
-- Fix: Caso 3 — fecha em window_expires_at (fim LOGICO da janela). Fechar aqui,
-- e NAO no evento 'end', preserva a janela de reconexao gratis (a sessao fisica
-- pode acabar antes; a janela segue valendo ate window_expires_at). Nao estorna
-- free/credito. Roda 1x/min (mesmo cron), entao fecha ate ~1min apos vencer.
-- =====================================================================

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

  -- Caso 2: clique no painel que nunca virou sessao (agente nunca assumiu) -> marca como falha.
  update public.connection_logs
     set status = 'failed',
         session_end = session_start,
         notes = coalesce(notes,'') || ' [auto-close: sessao nunca confirmada]'
   where status = 'active'
     and last_heartbeat_at is null
     and session_start < now() - interval '5 minutes';
  get diagnostics v_c2 = row_count;

  -- Caso 3 (B6): atendimento cuja JANELA de reconexao ja venceu -> encerra.
  update public.atendimentos
     set ended_at = window_expires_at
   where ended_at is null
     and window_expires_at <= now();
  get diagnostics v_c3 = row_count;

  return coalesce(v_c1,0) + coalesce(v_c2,0) + coalesce(v_c3,0);
end;
$function$;
