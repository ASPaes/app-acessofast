-- Anuncios no plano gratuito — Fase 1 (painel).
--
-- Contexto: o ANUNCIOS-POSSIBILIDADES.md fala de um invetario "ja pronto" no
-- commit 45e499a / branch anuncios-plano-gratuito. Esse codigo nunca chegou ao
-- origin nem ao banco (conferido por sonda REST em producao: ad_campaigns,
-- ad_impressions, ad_creatives, advertisers e ad_ledger todas com PGRST205, e a
-- edge function ad-serve com NOT_FOUND). Esta migration escreve o invetario do
-- zero, no recorte minimo que a Fase 1 precisa.
--
-- O recorte: campanha + impressao + selecao. NAO tem portal do anunciante nem
-- aba de moderacao — enquanto nao existir anunciante real, o lado da oferta nao
-- tem o que servir. Quem cria campanha nesta fase e a plataforma, por SQL.
--
-- A pergunta que a Fase 1 responde e "anunciante paga por esse inventario?", e
-- quem responde isso e a MEDICAO (exibicoes/dia, CTR) — nao um portal. Por isso
-- a primeira campanha e a da casa: ela liga o slot, gera numero real, e o numero
-- e o que se leva pro anunciante.

-- ---------------------------------------------------------------------------
-- 1. Campanhas
-- ---------------------------------------------------------------------------
create table if not exists public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),

  -- 'house'       = campanha da casa (vender credito/plano). Sem anunciante.
  -- 'third_party' = anunciante externo pagante.
  --
  -- A distincao nao e cosmetica: ela carrega a regra de selecao definida em
  -- 2026-08-06 — enquanto ha uso gratuito, terceiro na frente; a casa preenche
  -- o slot quando nao ha terceiro elegivel.
  kind text not null check (kind in ('house', 'third_party')),

  -- Tenant do ANUNCIANTE (nao do espectador). Null para campanha da casa.
  advertiser_tenant_id uuid references public.tenants(id) on delete cascade,

  -- Nome interno, so pra operacao achar a campanha. Nao vai pra tela.
  -- Unico porque e o que torna o seed da campanha da casa idempotente — sem
  -- isso, reaplicar a migration criaria uma segunda copia da mesma peca.
  name text not null unique,

  -- Criativo. Uma peca por campanha nesta fase: separar ad_creatives so paga
  -- quando existir teste A/B, e nao existe anunciante ainda.
  headline  text not null,
  body      text,
  cta_label text not null,
  cta_url   text not null,
  -- Caminho no bucket privado 'ad-creatives'. A ad-serve assina na hora.
  -- Null = peca so de texto, que e o caso da campanha da casa.
  image_path text,

  -- ONDE a peca pode aparecer. Os dois momentos da Fase 1:
  --   'free_start' — inicio de um uso gratuito, antes de abrir a conexao.
  --   'exhausted'  — free e credito zerados (402 no_credits).
  --
  -- A campanha da casa recebe SO 'free_start'. Isso nao e detalhe: a tela do
  -- 'exhausted' JA E a oferta de credito (uma tela, dois espacos — a oferta como
  -- conteudo principal, o espaco do anunciante dentro dela). Dar 'exhausted' a
  -- uma campanha da casa desenharia oferta de credito dentro de oferta de
  -- credito. Deixando isso nos DADOS, o codigo do painel nao precisa de nenhum
  -- if pra tratar o caso.
  -- cardinality, nao array_length: array_length('{}', 1) devolve NULL, e check
  -- constraint com resultado NULL PASSA — ou seja, com array_length daria pra
  -- gravar campanha sem nenhum placement, que nunca apareceria em lugar nenhum
  -- e nao daria erro. cardinality('{}') e 0 e barra de verdade.
  placements text[] not null
    check (placements <@ array['free_start', 'exhausted']::text[]
           and cardinality(placements) >= 1),

  status text not null default 'draft'
    check (status in ('draft', 'pending', 'approved', 'paused', 'archived')),

  -- Janela de veiculacao. Null dos dois lados = sem limite de data.
  starts_at timestamptz,
  ends_at   timestamptz,

  -- Teto de exibicoes desta campanha por dia. Null = sem teto. Protege o
  -- ORCAMENTO do anunciante — nao protege o espectador (ver ad_policy).
  daily_cap integer check (daily_cap is null or daily_cap > 0),

  -- Desempate quando mais de uma campanha esta elegivel. Maior ganha.
  weight integer not null default 1 check (weight > 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Campanha da casa nao tem anunciante; a de terceiro tem, obrigatoriamente.
  -- Sem isso, uma peca de terceiro sem dono nao teria a quem cobrar nem a quem
  -- responder por conteudo.
  constraint ad_campaigns_advertiser_coerente check (
    (kind = 'house'       and advertiser_tenant_id is null) or
    (kind = 'third_party' and advertiser_tenant_id is not null)
  ),
  constraint ad_campaigns_janela_coerente check (
    starts_at is null or ends_at is null or ends_at > starts_at
  )
);

comment on table public.ad_campaigns is
  'Campanhas do slot de anuncio do plano gratuito. Fase 1: criadas pela '
  'plataforma via SQL — nao ha portal do anunciante nem UI de moderacao ainda.';

comment on column public.ad_campaigns.placements is
  'Momentos em que a peca pode aparecer. Campanha da casa recebe so free_start: '
  'a tela do exhausted ja e a propria oferta de credito.';

-- ---------------------------------------------------------------------------
-- 2. Impressoes — a medicao, que e o produto desta fase
-- ---------------------------------------------------------------------------
create table if not exists public.ad_impressions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,

  -- QUANDO (momento no fluxo).
  placement text not null check (placement in ('free_start', 'exhausted')),

  -- ONDE (tela que desenhou). As duas superficies do painel nao sao
  -- equivalentes: o embed do DoctorSaaS e uma janela de 520px que se FECHA
  -- SOZINHA 2,5s depois do clique em "Abrir conexão". Sem separar as duas, um
  -- CTR ruim seria indiagnosticavel — nao daria pra saber se a peca e fraca ou
  -- se a janela sumiu antes de ser lida. E CTR e o numero que se leva pro
  -- anunciante nesta fase.
  surface text not null default 'painel' check (surface in ('painel', 'embed')),

  -- O ESPECTADOR: o tecnico que viu. Nao confundir com advertiser_tenant_id.
  viewer_user_id   uuid not null references auth.users(id) on delete cascade,
  viewer_tenant_id uuid references public.tenants(id) on delete set null,

  shown_at   timestamptz not null default now(),
  clicked_at timestamptz
);

comment on table public.ad_impressions is
  'Exibicao e clique, por espectador. E daqui que sai a resposta pra "anunciante '
  'paga por esse inventario?" — exibicoes/dia e CTR reais do uso gratuito.';

-- Teto diario da campanha: conta impressoes da campanha no dia.
create index if not exists ad_impressions_campanha_dia
  on public.ad_impressions (campaign_id, shown_at desc);

-- Teto por espectador e rodizio: as duas leituras sao por espectador no tempo.
create index if not exists ad_impressions_espectador_dia
  on public.ad_impressions (viewer_user_id, shown_at desc);

-- ---------------------------------------------------------------------------
-- 3. Politica de exibicao — o teto que protege QUEM USA o gratuito
-- ---------------------------------------------------------------------------
--
-- O daily_cap da campanha protege o orcamento do anunciante. Ninguem protegia o
-- espectador: sem este teto, um tecnico que gasta os 5 acessos gratuitos ve
-- anuncio 5 vezes + a tela do esgotado, e nao ha nada no sistema que impeca isso
-- de crescer quando o inventario de terceiro crescer.
--
-- Tabela de UMA linha, mesmo padrao do agent_update_policy — o check(id) e o que
-- garante que nao existe "qual das linhas vale?".
create table if not exists public.ad_policy (
  id boolean primary key default true check (id),

  -- Quantos anuncios um mesmo espectador ve por dia, somando todas as campanhas.
  -- Null = sem teto.
  --
  -- Default 6 = o maximo que o desenho atual ja produz naturalmente (5 usos
  -- gratuitos/dia + a tela do esgotado). Ou seja: NASCE sem cortar nada, e so
  -- pode ser apertado depois com dado na mao. Nascer restritivo mataria
  -- inventario antes de existir medicao pra justificar.
  viewer_daily_cap integer check (viewer_daily_cap is null or viewer_daily_cap > 0),

  updated_at timestamptz not null default now()
);

insert into public.ad_policy (id, viewer_daily_cap)
  values (true, 6)
  on conflict (id) do nothing;

comment on table public.ad_policy is
  'Politica global do slot (uma unica linha). viewer_daily_cap = teto de anuncios '
  'por espectador por dia — o daily_cap da campanha nao cobre isso.';

-- ---------------------------------------------------------------------------
-- 4. Bucket do criativo
-- ---------------------------------------------------------------------------
--
-- PRIVADO. A arte de anunciante nao e conteudo publico da plataforma: quem serve
-- e a ad-serve, que assina URL de vida curta no momento da exibicao. Nenhuma
-- policy de storage acompanha — de proposito. Sem policy, authenticated e anon
-- nao alcancam o bucket, e o unico caminho ate a arte passa pela edge function,
-- que e onde a elegibilidade e o teto sao aplicados.
insert into storage.buckets (id, name, public)
  values ('ad-creatives', 'ad-creatives', false)
  on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Grants — o painel LE campanha, e so isso
-- ---------------------------------------------------------------------------
alter table public.ad_campaigns   enable row level security;
alter table public.ad_impressions enable row level security;
alter table public.ad_policy      enable row level security;

-- Zerar ANTES de conceder. O default privilege do Supabase no schema public da
-- todos os privilegios a anon e authenticated no create table — inclusive
-- TRUNCATE, que NAO passa por RLS (e por isso que existe a migration
-- 20260731025047_harden_remaining_tables_truncate_grants). Sem este revoke, o
-- "ESCRITA: nenhum grant" logo abaixo seria intencao, nao fato.
revoke all on public.ad_campaigns, public.ad_impressions, public.ad_policy
  from anon, authenticated;

grant select on public.ad_campaigns to authenticated;

-- O anunciante ve as campanhas dele; a plataforma ve todas. O espectador NAO
-- precisa ler esta tabela — quem entrega a peca pra ele e a ad-serve.
create policy ad_campaigns_select_dono on public.ad_campaigns
  for select to authenticated
  using (
    private.is_super_admin()
    or (advertiser_tenant_id is not null
        and advertiser_tenant_id = private.current_tenant_id())
  );

-- ESCRITA de campanha: nenhum grant. Nesta fase quem cria campanha e a
-- plataforma por SQL. Quando existir o portal do anunciante, ele entra como RPC
-- security definer com a maquina de estados da moderacao dentro — nao como grant
-- de insert/update aqui. O motivo: 'status' e o que separa peca aprovada de peca
-- crua, e um grant de update deixaria o proprio anunciante se aprovar.

-- ad_impressions: nenhum grant a authenticated, nem de leitura. Quem escreve e a
-- ad-serve (service_role). Leitura fica de fora porque a tabela nomeia QUEM viu
-- QUAL anuncio — dado de comportamento do tecnico. O relatorio do anunciante,
-- quando existir, sai de uma view agregada, nao da tabela crua.

-- ad_policy: leitura liberada (nao e segredo e ajuda a explicar na tela por que
-- o anuncio nao apareceu); escrita so por service_role.
grant select on public.ad_policy to authenticated;
create policy ad_policy_select_all on public.ad_policy
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 6. Selecao: elegibilidade + rodizio + tetos, em uma ida ao banco
-- ---------------------------------------------------------------------------
--
-- Chamada pela ad-serve a cada exibicao. Devolve ZERO linhas quando nao ha peca
-- a exibir — que e um resultado normal, nao erro: sem terceiro elegivel e sem
-- campanha da casa no placement, o slot simplesmente nao aparece.
--
-- A ordem de escolha materializa a regra de 2026-08-06:
--   1. terceiro antes da casa            (kind = 'third_party' primeiro)
--   2. rodizio por espectador            (quem esse tecnico viu ha mais tempo)
--   3. weight, depois aleatorio          (desempate)
--
-- O teto por espectador e checado ANTES de qualquer candidato: se o tecnico ja
-- bateu o limite do dia, nao ha peca nenhuma, terceiro ou casa.
create or replace function public.ad_pick_for_viewer(
  p_placement      text,
  p_viewer_user    uuid,
  p_viewer_tenant  uuid
)
returns table (
  id         uuid,
  kind       text,
  headline   text,
  body       text,
  cta_label  text,
  cta_url    text,
  image_path text
)
language sql
-- VOLATILE (nao stable): o desempate final e random(), e marcar de stable seria
-- uma promessa falsa de que duas chamadas na mesma query devolvem o mesmo — que
-- e justamente o oposto do que o rodizio precisa.
volatile
security definer
set search_path = public
as $$
  -- "Hoje" TEM que ser o mesmo dia do billing: todo o metering conta em
  -- America/Sao_Paulo ((now() at time zone 'America/Sao_Paulo')::date, ver
  -- billing_eligibility / create_access_grant / daily_free_access). Usar o dia
  -- UTC aqui faria os tetos do anuncio virarem as 21h BRT enquanto o contador de
  -- acessos gratuitos so vira a meia-noite — um tecnico que bateu o teto de
  -- exibicoes ganharia lote novo no meio da noite, ainda gastando a cota de
  -- ontem.
  --
  -- Calculado como INSTANTE (timestamptz), nao como comparacao de ::date, pra
  -- continuar batendo nos indices (campaign_id, shown_at) e
  -- (viewer_user_id, shown_at).
  with dia as (
    select date_trunc('day', now() at time zone 'America/Sao_Paulo')
             at time zone 'America/Sao_Paulo' as inicio
  ),
  -- Tudo qualificado por alias de proposito: os nomes do `returns table` (id,
  -- kind, body, ...) sao parametros de SAIDA e ficam visiveis dentro do corpo.
  -- Um `where id = true` solto aqui casaria com o parametro id E com a coluna de
  -- ad_policy, e o Postgres recusa a funcao com "column reference is ambiguous".
  politica as (
    select pol.viewer_daily_cap from public.ad_policy pol where pol.id = true
  ),
  -- Quantos anuncios este espectador ja viu hoje, somando campanhas.
  vistos_hoje as (
    select count(*) as n
      from public.ad_impressions imp
     cross join dia
     where imp.viewer_user_id = p_viewer_user
       and imp.shown_at >= dia.inicio
  )
  select c.id, c.kind, c.headline, c.body, c.cta_label, c.cta_url, c.image_path
    from public.ad_campaigns c
   cross join dia d
   cross join politica p
   cross join vistos_hoje v
   where c.status = 'approved'
     and p_placement = any (c.placements)
     and (c.starts_at is null or c.starts_at <= now())
     and (c.ends_at   is null or c.ends_at   >  now())
     -- Anunciante nao paga pra anunciar pra si mesmo.
     and (c.advertiser_tenant_id is null
          or c.advertiser_tenant_id is distinct from p_viewer_tenant)
     -- Teto do espectador (protege quem usa o gratuito).
     and (p.viewer_daily_cap is null or v.n < p.viewer_daily_cap)
     -- Teto da campanha (protege o orcamento do anunciante).
     and (c.daily_cap is null
          or (select count(*)
                from public.ad_impressions i
               where i.campaign_id = c.id
                 and i.shown_at >= d.inicio) < c.daily_cap)
   order by
     -- 1. terceiro na frente da casa
     case c.kind when 'third_party' then 0 else 1 end,
     -- 2. rodizio: nunca vista por este espectador vem primeiro (nulls first),
     --    depois a vista ha mais tempo
     (select max(i.shown_at)
        from public.ad_impressions i
       where i.campaign_id = c.id
         and i.viewer_user_id = p_viewer_user) asc nulls first,
     c.weight desc,
     random()
   limit 1;
$$;

comment on function public.ad_pick_for_viewer(text, uuid, uuid) is
  'Escolhe a peca a exibir para um espectador num placement, aplicando '
  'elegibilidade, rodizio e os dois tetos (campanha e espectador). Zero linhas = '
  'nao ha o que exibir, que e resultado normal.';

-- So a ad-serve chama. O painel nao escolhe anuncio — se escolhesse, os tetos
-- viravam sugestao.
-- 'anon' entra NOMINALMENTE. O default privilege do Supabase no schema public
-- concede execute a anon/authenticated/service_role no create, e revoke de
-- `public` (pseudo-role) NAO desfaz grant nominal de role — o anon sobreviveria.
-- Foi exatamente esse o descuido corrigido depois pela migration
-- 20260812162229_resolve_agent_update_revoke_anon; aqui ja nasce fechado.
revoke all on function public.ad_pick_for_viewer(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.ad_pick_for_viewer(text, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7. A primeira campanha: a da casa
-- ---------------------------------------------------------------------------
--
-- Entra ja APROVADA e so em 'free_start'. E ela que liga o slot no dia 1 e faz o
-- numero existir. Enquanto nao houver terceiro, todo uso gratuito vira uma
-- exibicao de "comprar credito" — que e upsell legitimo, nao anuncio de terceiro,
-- e por isso nao depende de certificado nem de aviso novo nos termos.
insert into public.ad_campaigns
  (kind, advertiser_tenant_id, name, headline, body, cta_label, cta_url, placements, status)
values
  ('house', null, 'casa-credito-v1',
   'Precisa de mais que 2 horas?',
   'O acesso gratuito desconecta em 2 horas. Com crédito, o atendimento não tem esse corte.',
   'Ver pacotes de crédito',
   '/financeiro',
   array['free_start']::text[],
   'approved')
on conflict do nothing;
