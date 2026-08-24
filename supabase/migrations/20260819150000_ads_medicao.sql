-- ---------------------------------------------------------------------------
-- Anuncios — a MEDICAO (leitura agregada da Fase 1).
--
-- A Fase 1 escreve ad_impressions e ninguem le. Isso deixa a fase sem responder
-- a pergunta que a justificou: "anunciante paga por esse inventario?". Quem
-- responde e exibicoes/dia e CTR — nao um portal.
--
-- Por que RPC agregada, e nao grant de select na tabela:
-- ad_impressions nomeia QUEM (viewer_user_id) viu QUAL peca e QUANDO. E dado de
-- comportamento do tecnico, e o comentario da migration da Fase 1 ja fixou que o
-- relatorio sairia de agregado, nunca da tabela crua. Um grant de select aqui
-- entregaria o historico individual de navegacao de cada tecnico a qualquer
-- authenticated que a policy deixasse passar. As funcoes abaixo devolvem SO
-- contagens: nenhuma linha identifica espectador.
--
-- Guarda: `where private.is_super_admin()` no fim de cada query. Nesta fase a
-- medicao e da PLATAFORMA — nao existe portal do anunciante, e portanto nao
-- existe ainda um recorte "so as minhas campanhas". Quando existir, entra como
-- um segundo predicado (advertiser_tenant_id = private.current_tenant_id()),
-- nao como uma funcao nova.
--
-- "Dia" em America/Sao_Paulo, igual ao resto do metering (ver ad_pick_for_viewer
-- e billing_eligibility). Misturar fuso aqui faria o relatorio comercial nao
-- bater com o contador de acessos gratuitos que ele existe pra explicar.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Serie diaria — o inventario no tempo
-- ---------------------------------------------------------------------------
-- `acessos_gratuitos` e o TETO COMERCIAL do inventario, nao um numero decorativo:
-- o espaco do anunciante so existe enquanto resta uso gratuito, entao o que se
-- vende e o numero de usos gratuitos consumidos por dia — nao a base de tecnicos
-- free. Exibicoes muito abaixo dele significam inventario ocioso (teto por
-- espectador, falta de peca elegivel ou momento que nao dispara), e essa e a
-- primeira coisa que um anunciante vai perguntar.
create or replace function public.ad_stats_diario(p_dias int default 30)
returns table (
  dia               date,
  exibicoes         bigint,
  cliques           bigint,
  espectadores      bigint,
  exibicoes_painel  bigint,
  exibicoes_embed   bigint,
  acessos_gratuitos bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with dias as (
    -- Serie densa: dia sem exibicao TEM que aparecer com zero. Uma lista que so
    -- mostra os dias movimentados esconde exatamente o buraco que interessa.
    select generate_series(
             (now() at time zone 'America/Sao_Paulo')::date - (greatest(p_dias, 1) - 1),
             (now() at time zone 'America/Sao_Paulo')::date,
             interval '1 day'
           )::date as dia
  ),
  imp as (
    select (i.shown_at at time zone 'America/Sao_Paulo')::date       as dia,
           count(*)                                                  as exibicoes,
           count(i.clicked_at)                                       as cliques,
           count(distinct i.viewer_user_id)                          as espectadores,
           count(*) filter (where i.surface = 'painel')              as painel,
           count(*) filter (where i.surface = 'embed')               as embed
      from public.ad_impressions i
     group by 1
  ),
  livre as (
    select da.access_date as dia, sum(da.used)::bigint as usados
      from public.daily_access da
     group by 1
  )
  select d.dia,
         coalesce(imp.exibicoes, 0),
         coalesce(imp.cliques, 0),
         coalesce(imp.espectadores, 0),
         coalesce(imp.painel, 0),
         coalesce(imp.embed, 0),
         coalesce(livre.usados, 0)
    from dias d
    left join imp   on imp.dia   = d.dia
    left join livre on livre.dia = d.dia
   -- Guarda: nao-super recebe ZERO LINHAS, nao erro. A tela ja trata "sem dado",
   -- e um raise aqui viraria tela de erro pra quem so errou o endereco.
   where private.is_super_admin()
   order by d.dia desc;
$$;

comment on function public.ad_stats_diario(int) is
  'Serie diaria agregada do inventario de anuncios (America/Sao_Paulo). Zero '
  'linhas para quem nao e super_admin. Nenhuma linha identifica espectador.';

-- ---------------------------------------------------------------------------
-- 2. Por campanha — o numero que vai pro anunciante
-- ---------------------------------------------------------------------------
create or replace function public.ad_stats_campanha(p_dias int default 30)
returns table (
  campanha     text,
  kind         text,
  status       text,
  exibicoes    bigint,
  cliques      bigint,
  ctr          numeric,
  espectadores bigint,
  ultima       timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.name,
         c.kind,
         c.status,
         count(i.id),
         count(i.clicked_at),
         -- CTR nulo (nao zero) quando nao houve exibicao: 0% e uma afirmacao
         -- sobre desempenho, e sem exibicao nao ha afirmacao a fazer.
         case when count(i.id) = 0 then null
              else round(100.0 * count(i.clicked_at) / count(i.id), 1)
         end,
         count(distinct i.viewer_user_id),
         max(i.shown_at)
    from public.ad_campaigns c
    left join public.ad_impressions i
      on i.campaign_id = c.id
     and i.shown_at >= (now() at time zone 'America/Sao_Paulo')::date
                       - (greatest(p_dias, 1) - 1)
   where private.is_super_admin()
   group by c.id, c.name, c.kind, c.status
   order by count(i.id) desc, c.name;
$$;

comment on function public.ad_stats_campanha(int) is
  'Exibicoes, cliques e CTR por campanha na janela pedida. Campanha sem exibicao '
  'aparece com zero — e a lista tambem serve de inventario do que esta no ar.';

-- ---------------------------------------------------------------------------
-- 3. Por momento e superficie — o diagnostico do CTR
-- ---------------------------------------------------------------------------
-- Existe por causa de um risco concreto: o embed do DoctorSaaS e uma janela de
-- 520px que se FECHA SOZINHA 2,5s depois do clique em "Abrir conexao". Um CTR
-- ruim somando as duas superficies seria indiagnosticavel — nao daria pra saber
-- se a peca e fraca ou se a janela sumiu antes de ser lida.
create or replace function public.ad_stats_superficie(p_dias int default 30)
returns table (
  placement text,
  surface   text,
  exibicoes bigint,
  cliques   bigint,
  ctr       numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select i.placement,
         i.surface,
         count(*),
         count(i.clicked_at),
         case when count(*) = 0 then null
              else round(100.0 * count(i.clicked_at) / count(*), 1)
         end
    from public.ad_impressions i
   where i.shown_at >= (now() at time zone 'America/Sao_Paulo')::date
                       - (greatest(p_dias, 1) - 1)
     and private.is_super_admin()
   group by i.placement, i.surface
   order by count(*) desc;
$$;

comment on function public.ad_stats_superficie(int) is
  'Exibicoes, cliques e CTR por placement x surface. Separar painel de embed e o '
  'motivo de ad_impressions.surface existir.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- `anon` NOMINALMENTE no revoke: o default privilege do Supabase concede EXECUTE
-- a anon/authenticated/service_role no create function, e `revoke from public`
-- NAO desfaz grant nominal (public e pseudo-role). O repo ja tropecou nisso —
-- ver 20260812162229_resolve_agent_update_revoke_anon.
revoke all on function public.ad_stats_diario(int)     from public, anon, authenticated;
revoke all on function public.ad_stats_campanha(int)   from public, anon, authenticated;
revoke all on function public.ad_stats_superficie(int) from public, anon, authenticated;

grant execute on function public.ad_stats_diario(int)     to authenticated;
grant execute on function public.ad_stats_campanha(int)   to authenticated;
grant execute on function public.ad_stats_superficie(int) to authenticated;
