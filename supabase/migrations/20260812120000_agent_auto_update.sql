-- Passo 2 da atualizacao de frota: auto-update do agente.
--
-- O canal ja existe — o agente faz POST autenticado a session-ingest a cada 60s
-- (presence) e JA LE a resposta (e assim que o hard_cap_at do billing chega nele).
-- Falta so o servidor ter o que responder. Esta migration cria esse "o que".
--
-- Duas coisas separadas de proposito:
--   1. agent_releases  — QUAIS builds existem e como valida-los (catalogo).
--   2. o ALVO          — QUAL build cada maquina deve rodar (politica), resolvido
--                        em cascata device -> tenant -> global.
--
-- Separar as duas e o que permite rollout escalonado: publicar um release NAO
-- instala nada em lugar nenhum. So mexer no alvo instala. Sem essa separacao,
-- publicar seria sinonimo de mandar para as ~50 maquinas de uma vez — e um agente
-- ruim cegaria justamente a telemetria que se usaria pra descobrir o problema.

-- ---------------------------------------------------------------------------
-- 1. Catalogo de builds
-- ---------------------------------------------------------------------------
create table if not exists public.agent_releases (
  version     text primary key,
  platform    text not null default 'windows',
  url         text not null,
  sha256      text not null,
  -- Assinatura Ed25519 (base64) sobre a string canonica
  --     acessofast-agent:v1:<version>:<sha256>
  -- A chave PRIVADA vive so num GitHub Actions secret e NUNCA toca este banco;
  -- a PUBLICA esta embutida no binario do agente.
  --
  -- Por que isso e obrigatorio e nao "defesa em profundidade": conferir apenas o
  -- sha256 protege contra download corrompido, nao contra servidor comprometido —
  -- o hash vem do mesmo lugar que o arquivo. Como o agente roda como SYSTEM em
  -- maquinas de cliente, quem controlar este canal controla a frota inteira. Com
  -- a assinatura, comprometer o banco OU o Release nao basta: sem a chave privada
  -- nao se forja um manifesto que o agente aceite.
  signature   text not null,
  notes       text,
  created_at  timestamptz not null default now()
);

comment on table public.agent_releases is
  'Catalogo de builds do agente. Publicar aqui NAO instala em lugar nenhum — quem '
  'instala e o alvo (address_book.agent_target_version / tenant_settings / '
  'agent_update_policy).';

-- ---------------------------------------------------------------------------
-- 2. O alvo, em cascata
-- ---------------------------------------------------------------------------

-- Nivel 1 (vence): alvo fixado numa maquina. E o degrau do canary — fixa numa,
-- observa a coluna "Agente" no painel, e so entao sobe pro tenant.
alter table public.address_book
  add column if not exists agent_target_version text;

comment on column public.address_book.agent_target_version is
  'Alvo de versao SO desta maquina. Vence tenant e global. Null = herda. '
  'Usado pra canary: fixa numa maquina antes de liberar pro resto.';

-- Nivel 2: alvo do tenant.
alter table public.tenant_settings
  add column if not exists agent_target_version text;

comment on column public.tenant_settings.agent_target_version is
  'Alvo de versao do tenant. Perde pro alvo do device, vence o global. Null = herda.';

-- Nivel 3 (default): alvo global. Tabela de UMA linha — o check(id) e o que
-- garante isso, entao nao existe "qual das linhas vale?".
create table if not exists public.agent_update_policy (
  id             boolean primary key default true check (id),
  target_version text references public.agent_releases(version),
  updated_at     timestamptz not null default now()
);

comment on table public.agent_update_policy is
  'Alvo global do auto-update (uma unica linha). target_version null = auto-update '
  'DESLIGADO pra quem nao tem alvo de device ou tenant — que e o estado inicial, '
  'de proposito: a migration nao liga nada sozinha.';

-- Linha unica, com o auto-update DESLIGADO. Ligar e um ato deliberado depois de
-- publicar um release e testa-lo num canary — nao um efeito colateral de aplicar
-- esta migration.
insert into public.agent_update_policy (id, target_version)
  values (true, null)
  on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Grants — o que o painel pode e o que NAO pode
-- ---------------------------------------------------------------------------
--
-- Leitura liberada: url e sha256 nao sao segredo (o binario e publico num Release
-- do GitHub), e o painel precisa disso pra mostrar o que existe e qual e o alvo.
grant select on public.agent_releases  to authenticated;
grant select on public.agent_update_policy to authenticated;

alter table public.agent_releases      enable row level security;
alter table public.agent_update_policy enable row level security;

create policy agent_releases_select_all on public.agent_releases
  for select to authenticated using (true);
create policy agent_update_policy_select_all on public.agent_update_policy
  for select to authenticated using (true);

-- ESCRITA: nenhum grant, em nenhuma das duas tabelas, nem nas colunas de alvo.
-- Nao e esquecimento — e o mesmo tratamento dado a agent_token_hash e a
-- agent_version (20260807120000). Quem escreve e o service_role (edge function /
-- SQL de operacao), que passa por cima de RLS.
--
-- O motivo concreto: escrever nessas colunas e mandar codigo executar como SYSTEM
-- em maquina de cliente. Uma sessao de painel comprometida nao pode alcancar isso,
-- por mais que o papel do usuario seja alto. Quando existir UI de rollout, ela
-- deve entrar como RPC security definer com checagem de super_admin — nao como
-- grant de update nessas colunas.

-- ---------------------------------------------------------------------------
-- 4. Resolucao do alvo, em uma unica ida ao banco
-- ---------------------------------------------------------------------------
--
-- A session-ingest chama isto a cada 'presence' — 60s, por maquina, ~50 maquinas.
-- Resolver a cascata em TypeScript custaria ate 3 queries por chamada (device,
-- tenant, global) so pra na maioria das vezes concluir "nao ha nada a fazer". O
-- coalesce faz a cascata inteira em um round trip.
--
-- Devolve ZERO linhas quando nao ha o que atualizar, que e o caso comum:
--   * nenhum alvo definido em nenhum nivel (auto-update desligado), ou
--   * o alvo e exatamente a versao que a maquina ja roda, ou
--   * o alvo aponta pra um release que nao existe no catalogo.
--
-- Compara por IGUALDADE, nao por "mais novo": apontar o alvo pra uma versao
-- anterior e um rollback deliberado e precisa funcionar. E justamente o que salva
-- um rollout escalonado que deu errado no canary.
create or replace function public.resolve_agent_update(
  p_device_id       uuid,
  p_current_version text
)
returns table (version text, url text, sha256 text, signature text)
language sql
stable
security definer
set search_path = public
as $$
  select r.version, r.url, r.sha256, r.signature
    from public.agent_releases r
   where r.version = (
           select coalesce(ab.agent_target_version,
                           ts.agent_target_version,
                           pol.target_version)
             from public.address_book ab
             left join public.tenant_settings ts on ts.tenant_id = ab.tenant_id
             cross join public.agent_update_policy pol
            where ab.id = p_device_id
         )
     and r.version is distinct from coalesce(p_current_version, '');
$$;

comment on function public.resolve_agent_update(uuid, text) is
  'Resolve o alvo de auto-update (device -> tenant -> global) e devolve o release '
  'correspondente, ou zero linhas se nao ha o que atualizar. Chamada pela '
  'session-ingest a cada presence.';

-- Só o service_role executa. Não é informação secreta (o binário está num Release
-- publico), mas nao ha motivo pro painel chamar isto — quem decide atualizar e o
-- servidor, respondendo ao agente.
revoke all on function public.resolve_agent_update(uuid, text) from public, authenticated;
grant execute on function public.resolve_agent_update(uuid, text) to service_role;
