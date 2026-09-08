-- Anuncios — Fase 1 do EXECUTAVEL: o momento "esgotado" no acesso direto.
--
-- O QUE ESTAVA DE FORA. A Fase 1 do painel cobre quem clica em Conectar: o slot
-- aparece no inicio do uso gratuito e na tela do 402 no_credits. Quem abre o
-- cliente e digita o ID nao passa por tela nossa — e quando o saldo acaba, a
-- sessao dele simplesmente CAI. Hoje o tecnico nao recebe explicacao nenhuma:
-- meter_external_session devolve blocked/no_credits, a session-ingest responde
-- hard_cap_at = agora, e o agente derruba. Do lado de la parece defeito.
--
-- POR ONDE O ANUNCIO SAI. Pelo mesmo tubo que o aviso de frota desatualizada
-- estreou hoje: servidor decide -> agente da maquina DO TECNICO entrega ->
-- WTSSendMessage desenha na sessao interativa dele (aviso.go no repo do agente).
-- A maquina acessada nao serve: quem desenharia la e o agente dela, e no caso
-- limite ele nem esta atualizado.
--
-- O PRECO, declarado: o agente do tecnico so fala com o servidor no presence, de
-- 3 em 3 minutos — entao o recado chega ATE 3 MIN depois do corte. Nao da para
-- fazer melhor sem encurtar o presence, que e exatamente o custo que estamos
-- eliminando da cota do Supabase.
--
-- O QUE ESTA SUPERFICIE NAO FAZ, e e preciso saber antes de ler o relatorio:
--   * NAO TEM CLIQUE. Uma caixa de mensagem do Windows tem um botao OK e nada
--     mais — nao ha link. O cta_url vai no texto para a pessoa digitar. Logo
--     `clicked_at` e SEMPRE null em surface='agente', e o CTR dessa linha do
--     ad_stats_superficie e 0% por construcao. Ler isso como "peca fraca" seria
--     erro de leitura, nao de campanha.
--   * NAO TEM IMAGEM. Texto puro. Peca que depende de criativo visual nao cabe.
--   * SO CAMPANHA DA CASA — ver ad_pick_for_device abaixo.

-- ---------------------------------------------------------------------------
-- 1. Placement proprio: 'agent_exhausted', separado do 'exhausted' do painel.
--
-- Por que nao reusar 'exhausted': no painel aquela tela JA E a oferta de
-- credito, e por isso a campanha da casa e proibida la (dar 'exhausted' a uma
-- peca da casa desenharia oferta de credito dentro de oferta de credito — a
-- regra da Fase 1, garantida nos dados). Na caixa do agente nao ha tela nenhuma
-- em volta: a peca da casa E o recado inteiro. Sao momentos com regras opostas,
-- entao sao placements diferentes — e nenhuma peca vaza de um lado para o outro
-- sem ninguem escrever um if.
-- ---------------------------------------------------------------------------
alter table public.ad_campaigns drop constraint if exists ad_campaigns_placements_check;
alter table public.ad_campaigns add constraint ad_campaigns_placements_check
  check (placements <@ array['free_start', 'exhausted', 'agent_exhausted']::text[]
         and cardinality(placements) >= 1);

alter table public.ad_impressions drop constraint if exists ad_impressions_placement_check;
alter table public.ad_impressions add constraint ad_impressions_placement_check
  check (placement in ('free_start', 'exhausted', 'agent_exhausted'));

-- ---------------------------------------------------------------------------
-- 2. O espectador do agente e uma MAQUINA, nao um usuario logado.
--
-- Nao ha sessao autenticada nesse caminho — o que o servidor conhece e o
-- rustdesk_id que a maquina acessada reportou como controlador. Entao a
-- impressao passa a poder ser atribuida a um device, e viewer_user_id deixa de
-- ser obrigatorio. O check garante que toda impressao continua tendo DONO: uma
-- linha sem espectador nenhum nao mede nada e estragaria o rodizio.
-- ---------------------------------------------------------------------------
alter table public.ad_impressions
  add column if not exists viewer_device_id uuid references public.address_book(id) on delete cascade;

alter table public.ad_impressions alter column viewer_user_id drop not null;

alter table public.ad_impressions drop constraint if exists ad_impressions_espectador_presente;
alter table public.ad_impressions add constraint ad_impressions_espectador_presente
  check (viewer_user_id is not null or viewer_device_id is not null);

alter table public.ad_impressions drop constraint if exists ad_impressions_surface_check;
alter table public.ad_impressions add constraint ad_impressions_surface_check
  check (surface in ('painel', 'embed', 'agente'));

-- Espelha o indice (viewer_user_id, shown_at): o rodizio e o teto por espectador
-- consultam por device exatamente do mesmo jeito.
create index if not exists ad_impressions_device_dia_idx
  on public.ad_impressions (viewer_device_id, shown_at)
  where viewer_device_id is not null;

comment on column public.ad_impressions.viewer_device_id is
  'Espectador quando a peca saiu na superficie agente: nao ha usuario logado no '
  'acesso direto, o que se conhece e a maquina do tecnico.';

-- ---------------------------------------------------------------------------
-- 3. Selecao para a superficie do agente.
--
-- Igual a ad_pick_for_viewer em tudo (dia em America/Sao_Paulo, teto do
-- espectador, teto da campanha, rodizio), com UMA diferenca que nao e detalhe:
--
--     and c.kind = 'house'
--
-- Anuncio de TERCEIRO numa janela nativa do Windows e a fronteira do adware, e a
-- decisao ja tomada e nao lancar isso com o instalador sem assinatura. Enquanto
-- o instalador nao for assinado, a superficie do agente serve so a casa. Isso
-- fica NO DADO, nao num if do servidor: uma peca de terceiro aprovada por engano
-- para este placement simplesmente nao e escolhida.
--
-- Nao devolve image_path: a caixa do Windows e texto puro, e devolver um caminho
-- de imagem que ninguem pode desenhar so conviteria alguem a tentar.
-- ---------------------------------------------------------------------------
create or replace function public.ad_pick_for_device(
  p_placement     text,
  p_viewer_device uuid,
  p_viewer_tenant uuid
) returns table (
  id uuid, kind text, headline text, body text, cta_label text, cta_url text
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with dia as (
    select date_trunc('day', now() at time zone 'America/Sao_Paulo')
             at time zone 'America/Sao_Paulo' as inicio
  ),
  politica as (
    select pol.viewer_daily_cap from public.ad_policy pol where pol.id = true
  ),
  vistos_hoje as (
    select count(*) as n
      from public.ad_impressions imp
     cross join dia
     where imp.viewer_device_id = p_viewer_device
       and imp.shown_at >= dia.inicio
  )
  select c.id, c.kind, c.headline, c.body, c.cta_label, c.cta_url
    from public.ad_campaigns c
   cross join dia d
   cross join politica p
   cross join vistos_hoje v
   where c.status = 'approved'
     and c.kind = 'house'                      -- ver o comentario acima
     and p_placement = any (c.placements)
     and (c.starts_at is null or c.starts_at <= now())
     and (c.ends_at   is null or c.ends_at   >  now())
     and (c.advertiser_tenant_id is null
          or c.advertiser_tenant_id is distinct from p_viewer_tenant)
     and (p.viewer_daily_cap is null or v.n < p.viewer_daily_cap)
     and (c.daily_cap is null
          or (select count(*)
                from public.ad_impressions i
               where i.campaign_id = c.id
                 and i.shown_at >= d.inicio) < c.daily_cap)
   order by
     (select max(i.shown_at)
        from public.ad_impressions i
       where i.campaign_id = c.id
         and i.viewer_device_id = p_viewer_device) asc nulls first,
     c.weight desc,
     random()
   limit 1;
$fn$;

revoke all on function public.ad_pick_for_device(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.ad_pick_for_device(text, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. A fila de avisos passa a carregar anuncio tambem.
--
-- Mesma fila de proposito: e o unico canal que alcanca o agente ocioso, ja
-- deduplica, ja tem faxina agendada, e o agente ja sabe desenhar o que sai dela.
-- O aviso.go nao precisa de UMA LINHA para o anuncio funcionar — o texto vem
-- pronto do servidor, que era exatamente o ponto daquele desenho.
-- ---------------------------------------------------------------------------
alter table private.avisos_agente drop constraint if exists avisos_agente_tipo_ck;
alter table private.avisos_agente add constraint avisos_agente_tipo_ck
  check (tipo in ('agente_desatualizado', 'anuncio'));

alter table private.avisos_agente
  add column if not exists campaign_id uuid references public.ad_campaigns(id) on delete cascade;

comment on column private.avisos_agente.campaign_id is
  'Preenchido so em tipo=anuncio. E o que liga a entrega a impressao: a linha de '
  'ad_impressions nasce quando o aviso e PUXADO, nao quando e enfileirado.';

-- ---------------------------------------------------------------------------
-- 5. Enfileira o anuncio quando o acesso direto e cortado por falta de saldo.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_anuncio_esgotado(
  p_destino_rustdesk_id text
) returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_device uuid;
  v_tenant uuid;
  v_ad     record;
  v_msg    text;
begin
  if p_destino_rustdesk_id !~ '^[0-9]{6,12}$' then return; end if;

  -- A maquina do tecnico precisa estar adotada: e dela que sai o presence que
  -- entrega o recado. Nao adotada, nao ha por onde falar com ela.
  select ab.id, ab.tenant_id into v_device, v_tenant
    from public.address_book ab
   where ab.rustdesk_id = p_destino_rustdesk_id;
  if v_device is null then return; end if;

  -- Um anuncio pendente por vez. Sem isto, um tecnico tentando reconectar tres
  -- vezes seguidas depois do corte ganharia tres caixas em sequencia — que e o
  -- caminho mais curto para o proximo aviso ser fechado sem ler.
  if exists (
    select 1 from private.avisos_agente
     where destino_rustdesk_id = p_destino_rustdesk_id
       and tipo = 'anuncio'
       and entregue_em is null
  ) then
    return;
  end if;

  select * into v_ad
    from public.ad_pick_for_device('agent_exhausted', v_device, v_tenant);
  -- FOUND, e nao `v_ad.id is null`: com zero linhas um RECORD nao ganha estrutura
  -- e ler um campo dele levanta "record is not assigned yet".
  if not found then return; end if;   -- sem peca elegivel, ou teto do dia batido

  -- O cta_url entra como TEXTO para digitar: a caixa do Windows nao tem link.
  -- Por isso a peca desta superficie guarda URL absoluta, nao a rota relativa
  -- que o painel usa — nao ha navegador em volta para resolver '/financeiro'.
  v_msg := coalesce(v_ad.body || chr(10) || chr(10), '')
           || v_ad.cta_label || ':' || chr(10) || v_ad.cta_url;

  insert into private.avisos_agente
    (destino_rustdesk_id, tipo, titulo, mensagem, campaign_id)
  values
    (p_destino_rustdesk_id, 'anuncio', v_ad.headline, v_msg, v_ad.id);
end;
$fn$;

revoke all on function public.registrar_anuncio_esgotado(text) from public, anon, authenticated;
grant execute on function public.registrar_anuncio_esgotado(text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Entrega: a impressao nasce aqui, no momento em que o recado SAI.
--
-- Contar no enfileiramento contaria peca que nunca chegou a tela nenhuma — a
-- maquina do tecnico pode passar o dia inteiro sem mandar presence, e a faxina
-- de 7 dias levaria o aviso embora sem ele ter sido visto. Impressao e entrega.
--
-- Substitui a versao de 20260908160000 mantendo assinatura e nome: a
-- session-ingest continua chamando puxar_aviso_agente e nao sabe que ha anuncio.
-- ---------------------------------------------------------------------------
create or replace function public.puxar_aviso_agente(p_rustdesk_id text)
returns table (titulo text, mensagem text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id     uuid;
  v_titulo text;
  v_msg    text;
  v_camp   uuid;
  v_device uuid;
  v_tenant uuid;
begin
  if p_rustdesk_id !~ '^[0-9]{6,12}$' then return; end if;

  with alvo as (
    select a.id from private.avisos_agente a
     where a.destino_rustdesk_id = p_rustdesk_id
       and a.entregue_em is null
     order by a.criado_em
     limit 1
     for update skip locked
  )
  update private.avisos_agente a
     set entregue_em = now()
    from alvo
   where a.id = alvo.id
  returning a.id, a.titulo, a.mensagem, a.campaign_id
       into v_id, v_titulo, v_msg, v_camp;

  if v_id is null then return; end if;

  if v_camp is not null then
    select ab.id, ab.tenant_id into v_device, v_tenant
      from public.address_book ab
     where ab.rustdesk_id = p_rustdesk_id;

    -- clicked_at fica null para sempre nesta superficie: nao ha o que clicar.
    insert into public.ad_impressions
      (campaign_id, placement, surface, viewer_device_id, viewer_tenant_id)
    values
      (v_camp, 'agent_exhausted', 'agente', v_device, v_tenant);
  end if;

  titulo := v_titulo;
  mensagem := v_msg;
  return next;
end;
$fn$;

revoke all on function public.puxar_aviso_agente(text) from public, anon, authenticated;
grant execute on function public.puxar_aviso_agente(text) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Relatorio: espectador agora pode ser maquina.
--
-- Sem isto, count(distinct viewer_user_id) devolveria ZERO espectadores para a
-- superficie do agente enquanto as exibicoes sobem — o relatorio mostraria a
-- peca sendo entregue para ninguem. A assinatura das funcoes nao muda, entao o
-- dashboard nao precisa de ajuste. A quebra por superficie ja sai de graca no
-- ad_stats_superficie, que agrupa por surface.
-- ---------------------------------------------------------------------------
create or replace function public.ad_stats_campanha(p_dias integer)
returns table (campanha text, kind text, status text, exibicoes bigint,
               cliques bigint, ctr numeric, espectadores bigint, ultima timestamptz)
language sql
stable
security definer
set search_path = ''
as $fn$
  select c.name,
         c.kind,
         c.status,
         count(i.id),
         count(i.clicked_at),
         case when count(i.id) = 0 then null
              else round(100.0 * count(i.clicked_at) / count(i.id), 1)
         end,
         count(distinct coalesce(i.viewer_user_id, i.viewer_device_id)),
         max(i.shown_at)
    from public.ad_campaigns c
    left join public.ad_impressions i
      on i.campaign_id = c.id
     and i.shown_at >= (now() at time zone 'America/Sao_Paulo')::date
                       - (greatest(p_dias, 1) - 1)
   where private.is_super_admin()
   group by c.id, c.name, c.kind, c.status
   order by count(i.id) desc, c.name;
$fn$;

create or replace function public.ad_stats_diario(p_dias integer)
returns table (dia date, exibicoes bigint, cliques bigint, espectadores bigint,
               exibicoes_painel bigint, exibicoes_embed bigint, acessos_gratuitos bigint)
language sql
stable
security definer
set search_path = ''
as $fn$
  with dias as (
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
           count(distinct coalesce(i.viewer_user_id, i.viewer_device_id)) as espectadores,
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
   where private.is_super_admin()
   order by d.dia desc;
$fn$;

-- ---------------------------------------------------------------------------
-- 8. A peca da casa desta superficie.
--
-- Separada da casa-credito-v1 de proposito: aquela fala do corte das 2h e mora
-- no free_start do painel; esta fala do saldo zerado e mora na caixa do agente.
-- Mesma oferta, momentos e limites de formato diferentes.
--
-- Os acentos aqui sao intencionais: o resto da migration e ASCII (padrao dos
-- comentarios do repo), mas headline/body/cta_label sao texto que a pessoa LE.
-- Ja perdemos isso uma vez na casa-credito-v1. O WTSSendMessage recebe UTF-16,
-- entao acento chega inteiro na tela.
-- ---------------------------------------------------------------------------
insert into public.ad_campaigns
  (kind, name, headline, body, cta_label, cta_url, placements, status)
values
  ('house',
   'casa-credito-agente-v1',
   'Seu acesso gratuito acabou',
   'A conexão foi encerrada porque os acessos gratuitos de hoje terminaram e o ' ||
   'saldo de crédito está zerado.' || chr(10) || chr(10) ||
   'Com crédito, o atendimento não é interrompido.',
   'Ver pacotes de crédito',
   'https://acessofast.com.br/financeiro',
   array['agent_exhausted']::text[],
   'approved')
on conflict (name) do nothing;
