-- Vinculo conversa do DoctorSaaS <-> cliente do AcessoFast.
--
-- POR QUE EXISTE
-- O popup /conectar recebe so o id da conversa. O CNPJ de proposito nao viaja na
-- querystring: documento em URL acaba gravado em log de servidor e no historico
-- do navegador. Para listar as maquinas certas, o painel precisa saber de que
-- cliente aquela conversa trata.
--
-- Na primeira vez o tecnico escolhe o cliente e a linha e gravada; da segunda em
-- diante a resolucao e automatica. Isso e o que torna a integracao independente
-- de uma API do DoctorSaaS: do lado de la basta abrir a URL com ?conv=<id>.
-- Quando (e se) o DoctorSaaS expuser a consulta conversa -> CNPJ, o match por
-- raiz passa a preencher esta tabela sozinho e a escolha manual vira excecao.
--
-- ESCOPO DE SEGURANCA: a chave e (tenant_id, conversation_id), nunca o id da
-- conversa sozinho. O mesmo id pode existir para dois MSPs diferentes e um nao
-- pode enxergar o cliente do outro. Quem garante e a RLS, identica a de clients.

create table if not exists public.doctorsaas_conversation_links (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  conversation_id text not null,
  client_id       uuid not null references public.clients(id) on delete cascade,
  created_by      uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- O id vem de fora: nao confiamos no formato, so limitamos o tamanho e
  -- recusamos vazio (que casaria com qualquer conversa sem id).
  constraint ck_doctorsaas_conversation_id
    check (btrim(conversation_id) <> '' and char_length(conversation_id) <= 200)
);

comment on table public.doctorsaas_conversation_links is
  'Liga uma conversa do DoctorSaaS ao cliente do AcessoFast. Preenchida na primeira vez que o tecnico abre o popup /conectar daquela conversa e escolhe o cliente.';
comment on column public.doctorsaas_conversation_links.conversation_id is
  'Identificador estavel da conversa no DoctorSaaS. Opaco para o AcessoFast: so precisa nao mudar entre sessoes.';

-- Uma conversa aponta para um cliente so, por tenant.
create unique index if not exists uq_doctorsaas_link_tenant_conversa
  on public.doctorsaas_conversation_links (tenant_id, conversation_id);

-- Serve ao ON DELETE CASCADE quando um cliente e apagado.
create index if not exists ix_doctorsaas_link_client
  on public.doctorsaas_conversation_links (client_id);

drop trigger if exists trg_doctorsaas_link_updated_at on public.doctorsaas_conversation_links;
create trigger trg_doctorsaas_link_updated_at
  before update on public.doctorsaas_conversation_links
  for each row execute function private.set_updated_at();

alter table public.doctorsaas_conversation_links enable row level security;

-- RLS espelhando clients: o tenant enxerga e mantem os proprios vinculos;
-- apagar e so super_admin (mesmo criterio de clients_delete).
drop policy if exists doctorsaas_link_select on public.doctorsaas_conversation_links;
create policy doctorsaas_link_select on public.doctorsaas_conversation_links
  for select to authenticated
  using (private.is_super_admin() or (tenant_id = private.current_tenant_id()));

drop policy if exists doctorsaas_link_insert on public.doctorsaas_conversation_links;
create policy doctorsaas_link_insert on public.doctorsaas_conversation_links
  for insert to authenticated
  with check (private.is_super_admin() or (tenant_id = private.current_tenant_id()));

drop policy if exists doctorsaas_link_update on public.doctorsaas_conversation_links;
create policy doctorsaas_link_update on public.doctorsaas_conversation_links
  for update to authenticated
  using (private.is_super_admin() or (tenant_id = private.current_tenant_id()))
  with check (private.is_super_admin() or (tenant_id = private.current_tenant_id()));

drop policy if exists doctorsaas_link_delete on public.doctorsaas_conversation_links;
create policy doctorsaas_link_delete on public.doctorsaas_conversation_links
  for delete to authenticated
  using (private.is_super_admin());

grant select, insert, update, delete on public.doctorsaas_conversation_links to authenticated;

-- Defesa em profundidade. O TRUNCATE nao passa por RLS: com o privilegio na mao,
-- um authenticated qualquer limparia os vinculos de todos os tenants. O mesmo
-- corte que a 20260714002937 fez em address_book/leads/tenant_features, aplicado
-- desde o nascimento desta tabela.
revoke truncate, references, trigger on public.doctorsaas_conversation_links from authenticated;

-- O visitante anonimo nao fala com esta tabela em hipotese nenhuma.
revoke all on public.doctorsaas_conversation_links from anon;
