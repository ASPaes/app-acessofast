-- Separa eventos de sandbox e produção na mesma tabela.
-- Aditiva: default 'sandbox' preserva todo o histórico existente como sandbox.
alter table public.asaas_events
  add column environment text not null default 'sandbox'
  check (environment in ('sandbox', 'production'));

create index if not exists idx_asaas_events_environment
  on public.asaas_events (environment);
