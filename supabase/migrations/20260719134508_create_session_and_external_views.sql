CREATE OR REPLACE VIEW public.v_sessions_summary
WITH (security_invoker = on) AS
SELECT
  tenant_id,
  (session_start AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
  count(*)                                                         AS sessoes,
  count(*) FILTER (WHERE notes IS NULL OR notes NOT ILIKE '%heartbeat perdido%') AS fim_limpo,
  count(*) FILTER (WHERE notes ILIKE '%heartbeat perdido%')       AS quedas,
  count(*) FILTER (WHERE notes ILIKE '%Acesso externo%')          AS acessos_externos,
  round(avg(duration_seconds))::int                              AS dur_media_s,
  (percentile_cont(0.5)  WITHIN GROUP (ORDER BY duration_seconds::double precision))::int AS dur_p50_s,
  (percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_seconds::double precision))::int AS dur_p95_s
FROM public.connection_logs
WHERE status = 'ended'
GROUP BY tenant_id, (session_start AT TIME ZONE 'America/Sao_Paulo')::date;

REVOKE ALL ON public.v_sessions_summary FROM anon;
GRANT SELECT ON public.v_sessions_summary TO authenticated;

CREATE OR REPLACE VIEW public.v_external_access
WITH (security_invoker = on) AS
SELECT
  tenant_id,
  rustdesk_id,
  address_book_id,
  session_start,
  session_end,
  duration_seconds,
  last_heartbeat_at,
  technician_ip,
  created_at
FROM public.connection_logs
WHERE notes ILIKE '%Acesso externo%';

REVOKE ALL ON public.v_external_access FROM anon;
GRANT SELECT ON public.v_external_access TO authenticated;
