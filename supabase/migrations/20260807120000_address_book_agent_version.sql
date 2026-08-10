-- Visibilidade de frota: qual versao do agente roda em cada endpoint.
--
-- Hoje nao existe forma de saber isso sem abrir a maquina. Com ~50 endpoints em
-- producao, qualquer rollout (o manual de hoje ou o auto-update futuro) e cego:
-- nao da pra dizer quais maquinas ficaram pra tras nem se um deploy pegou.
--
-- Quem escreve: a edge function session-ingest (service_role), a cada sinal do
-- agente — presence (60s ocioso) ou start/heartbeat/end de sessao. Ou seja, uma
-- maquina ligada carimba a propria versao em no maximo 60s.
--
-- Nullable de proposito: agente antigo nao manda o campo e fica null. Null NAO e
-- ausencia de informacao — e a informacao "essa maquina roda um build anterior ao
-- reporte de versao", que e exatamente o que se quer enxergar primeiro.
alter table public.address_book
  add column if not exists agent_version text;

comment on column public.address_book.agent_version is
  'Versao do agente reportada no ultimo sinal a session-ingest. Formato AAAA.MM.DD-<sha7> '
  '(ou "dev" em build local). Null = agente anterior ao reporte de versao.';

-- Nao ha grant a conceder aqui, e isso e intencional nos dois sentidos:
--
--  * SELECT do address_book segue no nivel da TABELA (a 20260714002937 so tornou
--    insert/update por coluna), entao o painel ja le a coluna nova.
--
--  * INSERT/UPDATE sao por coluna e enumeram o que o usuario pode editar. Omitir
--    agent_version dessa lista e o que impede o painel de forjar a versao de um
--    dispositivo — a coluna e um dado atestado pelo agente, nao um campo de
--    cadastro. Mesmo tratamento dado ao agent_token_hash.
