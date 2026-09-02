-- AcessoFast, 02/09/2026: faxina automatica de duas tabelas que cresciam sem freio.
--
-- Diagnostico: private.rate_limit_counters chegou a 732.004 linhas / 114 MB — 75% do
-- banco inteiro — com 99,7% de lixo. E contador de janela FIXA: passada a janela, a
-- linha nao serve mais para nada, e nunca houve purga. cron.job_run_details somava
-- 74.392 linhas / 12 MB pelo mesmo motivo (o pg_cron nunca limpa o proprio historico,
-- e o job de 1 em 1 minuto sozinho gera 1.440 linhas/dia).
--
-- A limpeza do acumulado ja foi feita a mao. Isto aqui e so o que impede voltar.

-- Corte em 2 HORAS, e nao na janela de 60s do claim-status, de proposito: os buckets
-- de antifraude do cadastro (fr:, sg:, sgl:, tr:) usam janela de 3600s. Uma janela de
-- 1h ativa sempre tem window_start dentro da ultima hora, entao 2h e o dobro da folga
-- necessaria — nenhum limite de signup em curso e zerado pela purga.
create or replace function private.purge_rate_limit_counters()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.rate_limit_counters
   where window_start < now() - interval '2 hours';
$$;

-- Historico do pg_cron: ninguem le. Confirmado — nenhuma funcao, view ou codigo do
-- painel referencia job_run_details. 7 dias cobrem qualquer investigacao de cron que
-- valha a pena fazer.
create or replace function private.purge_cron_history()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from cron.job_run_details
   where end_time < now() - interval '7 days';
$$;

revoke all on function private.purge_rate_limit_counters() from public, anon, authenticated;
revoke all on function private.purge_cron_history()        from public, anon, authenticated;

-- 3:40 e 3:45 entram na mesma janela de madrugada das purgas que ja existem
-- (3:10 connection_logs, 3:20 vps_metrics, 3:30 e 3:35 suspensoes), sem atropelar.
select cron.schedule('acessofast_purge_rate_limit',   '40 3 * * *', 'select private.purge_rate_limit_counters();');
select cron.schedule('acessofast_purge_cron_history', '45 3 * * *', 'select private.purge_cron_history();');
