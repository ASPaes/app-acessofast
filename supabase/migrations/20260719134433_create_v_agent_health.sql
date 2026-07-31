CREATE OR REPLACE VIEW public.v_agent_health
WITH (security_invoker = on) AS
SELECT
  tenant_id,
  rustdesk_id,
  address_book_id,
  count(*)                                   AS tentativas_totais,
  count(*) FILTER (WHERE status = 'ended')   AS sessoes_reais,
  count(*) FILTER (WHERE status = 'failed')  AS falhas,
  count(*) FILTER (WHERE status = 'active')  AS abertas_agora,
  max(last_heartbeat_at)                     AS ultimo_heartbeat,
  max(created_at)                            AS ultima_atividade,
  coalesce(max(last_heartbeat_at) > now() - interval '24 hours', false) AS agente_vivo_24h
FROM public.connection_logs
GROUP BY tenant_id, rustdesk_id, address_book_id;

REVOKE ALL ON public.v_agent_health FROM anon;
GRANT SELECT ON public.v_agent_health TO authenticated;
