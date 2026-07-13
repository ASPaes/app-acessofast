create extension if not exists pg_cron;

-- Fecha sozinho sessoes presas em 'active'. Chamada pelo cron (postgres), fora do alcance de anon/authenticated.
create or replace function public.close_stale_sessions()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_c1 integer;
  v_c2 integer;
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

  return coalesce(v_c1,0) + coalesce(v_c2,0);
end;
$fn$;

revoke all on function public.close_stale_sessions() from public, anon, authenticated;