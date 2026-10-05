-- Auto-update do APP AcessoFast (o cliente, AcessoFast.exe), pelo agente.
--
-- Mesmo desenho do auto-update do agente (20260812120000_agent_auto_update.sql), com
-- catálogo e alvo separados, e por isso o mesmo rollout escalonado:
--   1. client_releases     — QUAIS builds do app existem e como validá-los.
--   2. o ALVO              — QUAL build cada máquina deve rodar, em cascata
--                            device -> tenant -> global.
-- Publicar um release NÃO instala nada. Só mexer no alvo instala, e o alvo global nasce
-- DESLIGADO.
--
-- Quem instala é o agente (ele já roda como SYSTEM e já sabe trocar binário): ao receber o
-- bloco client_update no 'presence', confere a assinatura, espera não haver sessão e roda o
-- instalador do app por cima. O app novo mantém nome, pasta e config do AcessoFast: o ID e a
-- senha da máquina não mudam (testado em 01/10/2026 no PC do Ryan, 307871329).
--
-- Até hoje o app NÃO tinha versão própria (sempre "1.4.9", a do RustDesk). A versão do app
-- novo vem do arquivo acessofast-versao.txt na pasta instalada (data + commit, ex.:
-- 2026.10.01-875ebe8). O agente lê e manda em client_version; o AcessoFast antigo, sem o
-- arquivo, é reportado como 'legado'.

-- ---------------------------------------------------------------------------
-- 1. Catálogo de builds do app
-- ---------------------------------------------------------------------------
create table if not exists public.client_releases (
  version     text primary key,
  platform    text not null default 'windows',
  url         text not null,
  sha256      text not null,
  -- Assinatura Ed25519 (base64) sobre a string canônica
  --     acessofast-client:v1:<version>:<sha256>
  -- Mesma chave do agente (a privada só no GitHub Actions secret), mas com prefixo
  -- PRÓPRIO: uma assinatura de release do agente não vale como release do app, e vice-versa.
  -- Sem isso, um alvo trocado por engano mandaria o agente "instalar" o próprio agente
  -- como se fosse o app, e a assinatura conferiria.
  signature   text not null,
  notes       text,
  created_at  timestamptz not null default now()
);

comment on table public.client_releases is
  'Catálogo de builds do app AcessoFast (cliente). Publicar aqui NÃO instala em lugar '
  'nenhum — quem instala é o alvo (address_book.client_target_version / tenant_settings / '
  'client_update_policy), aplicado pelo agente.';

-- ---------------------------------------------------------------------------
-- 2. Versão reportada e alvo, em cascata
-- ---------------------------------------------------------------------------

-- O que a máquina diz estar rodando (o agente manda a cada presence). 'legado' = o
-- AcessoFast antigo, sem acessofast-versao.txt. Null = agente que ainda não reporta.
alter table public.address_book
  add column if not exists client_version text;

comment on column public.address_book.client_version is
  'Versão do app AcessoFast instalada, reportada pelo agente no presence. '
  '''legado'' = AcessoFast antigo (sem versão própria). Null = agente que não reporta.';

-- Nível 1 (vence): alvo fixado numa máquina — o degrau do canary.
alter table public.address_book
  add column if not exists client_target_version text;

comment on column public.address_book.client_target_version is
  'Alvo de versão do app SÓ desta máquina. Vence tenant e global. Null = herda.';

-- Nível 2: alvo do tenant.
alter table public.tenant_settings
  add column if not exists client_target_version text;

comment on column public.tenant_settings.client_target_version is
  'Alvo de versão do app no tenant. Perde pro alvo do device, vence o global. Null = herda.';

-- Nível 3 (default): alvo global, tabela de UMA linha.
create table if not exists public.client_update_policy (
  id             boolean primary key default true check (id),
  target_version text references public.client_releases(version),
  updated_at     timestamptz not null default now()
);

comment on table public.client_update_policy is
  'Alvo global do auto-update do app (uma única linha). target_version null = DESLIGADO '
  'para quem não tem alvo de device ou tenant — estado inicial, de propósito.';

insert into public.client_update_policy (id, target_version)
  values (true, null)
  on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Grants: mesmo tratamento do auto-update do agente
-- ---------------------------------------------------------------------------
-- Leitura liberada (url e sha256 não são segredo; o binário é público). Escrita só pelo
-- service_role: escrever no alvo é mandar o agente instalar um programa como SYSTEM em
-- máquina de cliente, e uma sessão de painel comprometida não pode alcançar isso.
grant select on public.client_releases      to authenticated;
grant select on public.client_update_policy to authenticated;

alter table public.client_releases      enable row level security;
alter table public.client_update_policy enable row level security;

create policy client_releases_select_all on public.client_releases
  for select to authenticated using (true);
create policy client_update_policy_select_all on public.client_update_policy
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 4. Resolução do alvo (uma ida ao banco por presence)
-- ---------------------------------------------------------------------------
-- Zero linhas no caso comum: sem alvo, alvo igual ao que já roda, ou alvo sem release.
-- Compara por IGUALDADE (voltar para uma versão anterior é rollback e precisa funcionar).
-- Plataforma pelo address_book.os, FAIL-CLOSED como na do agente: os desconhecido não
-- recebe nada.
create or replace function public.resolve_client_update(
  p_device_id       uuid,
  p_current_version text
)
returns table (version text, url text, sha256 text, signature text)
language sql
stable
security definer
set search_path = public
as $$
  with alvo as (
    select
      coalesce(ab.client_target_version,
               ts.client_target_version,
               pol.target_version) as version,
      case
        when ab.os ilike 'windows%' then 'windows'
      end                          as platform
      from public.address_book ab
      left join public.tenant_settings ts on ts.tenant_id = ab.tenant_id
      cross join public.client_update_policy pol
     where ab.id = p_device_id
  )
  select r.version, r.url, r.sha256, r.signature
    from public.client_releases r
    join alvo a
      on r.version  = a.version
     and r.platform = a.platform
   where r.version is distinct from coalesce(p_current_version, '');
$$;

comment on function public.resolve_client_update(uuid, text) is
  'Resolve o alvo de atualização do app (device -> tenant -> global) e devolve o release '
  'da plataforma do device, ou zero linhas. Chamada pela session-ingest a cada presence.';

revoke all on function public.resolve_client_update(uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_client_update(uuid, text) to service_role;
