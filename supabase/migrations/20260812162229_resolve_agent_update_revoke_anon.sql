-- Fecha a brecha do grant default do Supabase: toda funcao nova recebe EXECUTE
-- de anon/authenticated/service_role via ALTER DEFAULT PRIVILEGES. A migration
-- 20260812120000 revogou public+authenticated mas nao anon, entao a RPC ficou
-- chamavel por request nao autenticado via PostgREST — contra a intencao dela
-- ("So o service_role executa"). Dados nao sao segredo, mas nao ha motivo pra
-- expor o manifesto/oraculo de update a anon. Fecha agora, enquanto e inofensivo.
revoke execute on function public.resolve_agent_update(uuid, text) from anon;
