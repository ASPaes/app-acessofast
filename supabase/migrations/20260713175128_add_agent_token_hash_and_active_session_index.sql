-- Token de agente por dispositivo (hash sha256 em hex). Plaintext vive so no agente.
alter table public.address_book
  add column if not exists agent_token_hash text;

comment on column public.address_book.agent_token_hash is
  'SHA-256 (hex) do token de agente daquele endpoint. O agente apresenta o token em texto; a Edge Function session-ingest compara o hash. Isola cada maquina: uma nao forja evento da outra.';

-- Acelera a busca "sessao ativa desta maquina" que a session-ingest faz a cada evento.
create index if not exists idx_connection_logs_active_by_rustdesk
  on public.connection_logs (rustdesk_id)
  where status = 'active';