alter table public.connection_logs
  add column if not exists last_heartbeat_at timestamptz;

comment on column public.connection_logs.last_heartbeat_at is
  'Ultimo heartbeat recebido do agente do endpoint durante a sessao ativa. Usado pelo pg_cron para fechar sessoes mortas (crash/queda).';