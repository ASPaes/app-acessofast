-- Necessario para o pg_cron chamar a edge function promo-restore-sweep.
-- O pg_cron sozinho agenda SQL; quem faz HTTP a partir do Postgres e o pg_net.
create extension if not exists pg_net;
