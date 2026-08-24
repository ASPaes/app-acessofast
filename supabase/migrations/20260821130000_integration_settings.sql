-- Como cada empresa quer que a integracao se comporte.
--
-- POR QUE EXISTE
-- A sincronizacao de clientes do DoctorSaaS escreve no nosso cadastro, e uma
-- pergunta nao tem resposta unica: cliente que alguem DESATIVOU aqui deve voltar
-- quando reaparece na carteira de la? Quem opera so pelo DoctorSaaS quer que
-- volte — a lista de la e a verdade. Quem opera pelo painel do AcessoFast quer
-- que fique quieto — desativar foi uma decisao, nao um esquecimento.
--
-- Nao da para escolher por nos. Entao vira configuracao, por empresa.
--
-- O PADRAO E O CONSERVADOR
-- `false`: nao reativa. Uma linha ausente vale o padrao, e por isso a tabela
-- nasce vazia e ninguem precisa configurar nada para o comportamento de hoje
-- continuar. Ligar e uma escolha explicita de quem administra a conta.

create table if not exists public.integration_settings (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  -- Mesma coluna de integration_keys, pelo mesmo motivo: o segundo parceiro nao
  -- deve exigir tabela nova.
  provider   text not null default 'doctorsaas',
  -- Ligado: a sincronizacao reativa cliente desativado que voltar na lista de
  -- la. Desligado: ele sai como `cliente_inativo` na resposta e nada muda aqui.
  reactivate_on_sync boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  primary key (tenant_id, provider),
  constraint ck_integration_settings_provider check (provider in ('doctorsaas'))
);

comment on table public.integration_settings is
  'Preferencias por empresa de como a integracao com um parceiro se comporta. Linha ausente = padrao.';
comment on column public.integration_settings.reactivate_on_sync is
  'Se a sincronizacao pode reativar cliente que foi desativado no AcessoFast. Padrao false: quem desativou aqui manda.';

alter table public.integration_settings enable row level security;

-- Mesmo recorte das chaves: super admin e o admin do proprio tenant. Mudar isso
-- altera o que um sistema de fora pode escrever no cadastro — nao e decisao de
-- tecnico.
drop policy if exists integration_settings_select on public.integration_settings;
create policy integration_settings_select on public.integration_settings
  for select to authenticated
  using (
    private.is_super_admin()
    or (tenant_id = private.current_tenant_id() and private.current_app_role()::text = 'admin')
  );

drop policy if exists integration_settings_insert on public.integration_settings;
create policy integration_settings_insert on public.integration_settings
  for insert to authenticated
  with check (
    private.is_super_admin()
    or (tenant_id = private.current_tenant_id() and private.current_app_role()::text = 'admin')
  );

drop policy if exists integration_settings_update on public.integration_settings;
create policy integration_settings_update on public.integration_settings
  for update to authenticated
  using (
    private.is_super_admin()
    or (tenant_id = private.current_tenant_id() and private.current_app_role()::text = 'admin')
  )
  with check (
    private.is_super_admin()
    or (tenant_id = private.current_tenant_id() and private.current_app_role()::text = 'admin')
  );

-- Apagar a linha equivale a voltar ao padrao, e isso o update ja faz. Deixar o
-- delete aberto so criaria um segundo caminho para o mesmo efeito.
drop policy if exists integration_settings_delete on public.integration_settings;
create policy integration_settings_delete on public.integration_settings
  for delete to authenticated
  using (false);

grant select, insert, update on public.integration_settings to authenticated;
revoke delete, truncate, references, trigger on public.integration_settings from authenticated;
revoke all on public.integration_settings from anon;
