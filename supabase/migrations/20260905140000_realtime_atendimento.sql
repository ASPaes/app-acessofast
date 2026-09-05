-- AcessoFast, 05/09/2026: publicar no Realtime as tabelas que movem o status de
-- atendimento no painel.
--
-- Ate aqui a publicacao `supabase_realtime` tinha UMA tabela: vps_metrics. Isso
-- quer dizer que o canal `mon_conn_logs_rt` da tela de Monitoramento, que assina
-- connection_logs desde que foi escrito, nunca recebeu um evento — o subscribe
-- devolve SUBSCRIBED e o callback simplesmente nunca dispara. Uma assinatura sem
-- a tabela publicada falha em silencio, que e o pior modo de falhar: parece
-- funcionando.
--
-- Com isto, tanto aquele canal quanto o novo `dispositivos_atendimento_rt`
-- passam a receber de verdade. O ganho pro operador: "entrou em atendimento"
-- aparece no instante em que o agente reporta (~3s), e nao no proximo refetch de
-- 15-30s. Foi disso que um parceiro reclamou.
--
-- O QUE NAO ENTRA, e por que: address_book. Ela leva um UPDATE a cada sinal de
-- presenca — ~480/dia por maquina, ~160 maquinas, ~77 mil eventos/dia. O Realtime
-- cobra por mensagem ENTREGUE, entao multiplica por painel aberto: com 4 abas
-- daria ~9M/mes contra os 5M do plano. Trocaria o estouro de invocacoes que
-- acabamos de resolver por um estouro de Realtime. Online/offline continua no
-- refetch periodico, que deixou de piscar quando a janela foi corrigida.

alter publication supabase_realtime add table public.connection_logs;
alter publication supabase_realtime add table public.atendimentos;
