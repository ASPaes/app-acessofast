-- =====================================================================
-- AcessoFast — Remove a funcao morta public.log_connection_attempt.
-- =====================================================================
-- Motivo: no modelo de senha efemera, a contagem/emissao de sessao passou
-- a acontecer na Edge Function connect-device via create_access_grant
-- (gate de quota atomico). A antiga log_connection_attempt tambem inseria
-- linha 'active' em connection_logs, mas nao tem mais nenhum caller — so
-- restava na definicao de tipos gerada (types.ts).
--
-- Alem de codigo morto, ela era um BYPASS do gate: sendo SECURITY DEFINER e
-- executavel por anon/authenticated via /rest/v1/rpc/log_connection_attempt,
-- qualquer usuario logado (ou anonimo) poderia inserir sessoes 'active'
-- direto, sem passar pela quota. Removida.
--
-- Verificado antes do drop: unico overload (uuid), sem triggers e sem outras
-- funcoes referenciando-a. Sem CASCADE de proposito — se algo passar a
-- depender dela, o drop deve falhar em vez de derrubar dependencias em silencio.
-- =====================================================================

drop function if exists public.log_connection_attempt(uuid);
