-- Anuncio na superficie do agente, agora COM IMAGEM.
--
-- Decisao de 26/09/2026: a caixa nativa do Windows (WTSSendMessage, texto puro)
-- lida como erro do sistema, nao como mensagem do app. Vamos trocar por uma
-- janela propria do AcessoFast, com marca e imagem, desenhada por um binario
-- auxiliar do agente (fora deste repo). Este arquivo faz a PARTE DO SERVIDOR:
-- levar o caminho da imagem da campanha ate o agente.
--
-- Onde a imagem entra na trilha (nada mais muda de comportamento):
--   ad_pick_for_device        -> passa a devolver image_path
--   registrar_anuncio_esgotado-> grava image_path no aviso enfileirado
--   avisos_agente.image_path  -> carrega o caminho ate a entrega
--   puxar_aviso_agente        -> devolve image_path junto de titulo/mensagem
-- Quem ASSINA a URL do bucket privado 'ad-creatives' e a edge session-ingest
-- (service_role), no momento em que puxa o aviso — igual a ad-serve faz no painel.
-- O banco so trafega o caminho; nunca a URL assinada.
--
-- Segue SO campanha da casa (o filtro kind='house' em ad_pick_for_device fica):
-- anuncio de terceiro numa janela nativa e outra decisao (conteudo/responsabilidade),
-- nao coberta aqui. As imagens desta fase sao promo do proprio AcessoFast.

-- ---------------------------------------------------------------------------
-- 1. A fila carrega o caminho da imagem.
-- ---------------------------------------------------------------------------
alter table private.avisos_agente
  add column if not exists image_path text;

comment on column private.avisos_agente.image_path is
  'Preenchido so em tipo=anuncio quando a campanha tem criativo. Caminho no '
  'bucket privado ad-creatives; a session-ingest assina a URL na entrega.';

-- ---------------------------------------------------------------------------
-- 2. ad_pick_for_device passa a devolver image_path.
--    Muda a assinatura (nova coluna de saida) -> DROP + CREATE.
--    Corpo identico ao anterior, so com c.image_path a mais.
-- ---------------------------------------------------------------------------
drop function if exists public.ad_pick_for_device(text, uuid, uuid);

create function public.ad_pick_for_device(
  p_placement     text,
  p_viewer_device uuid,
  p_viewer_tenant uuid
) returns table (
  id uuid, kind text, headline text, body text, cta_label text, cta_url text, image_path text
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
  select c.id, c.kind, c.headline, c.body, c.cta_label, c.cta_url, c.image_path
    from public.ad_campaigns c
   cross join dia d
   cross join politica p
   cross join vistos_hoje v
   where c.status = 'approved'
     and c.kind = 'house'
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
-- 3. registrar_anuncio_esgotado grava o image_path no aviso.
--    Assinatura inalterada -> CREATE OR REPLACE. v_ad agora tem image_path.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_anuncio_esgotado(p_destino_rustdesk_id text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_device uuid;
  v_tenant uuid;
  v_ad     record;
  v_msg    text;
begin
  if p_destino_rustdesk_id !~ '^[0-9]{6,12}$' then return; end if;

  select ab.id, ab.tenant_id into v_device, v_tenant
    from public.address_book ab
   where ab.rustdesk_id = p_destino_rustdesk_id;
  if v_device is null then return; end if;

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
  if not found then return; end if;

  v_msg := coalesce(v_ad.body || chr(10) || chr(10), '')
           || v_ad.cta_label || ':' || chr(10) || v_ad.cta_url;

  insert into private.avisos_agente
    (destino_rustdesk_id, tipo, titulo, mensagem, campaign_id, image_path)
  values
    (p_destino_rustdesk_id, 'anuncio', v_ad.headline, v_msg, v_ad.id, v_ad.image_path);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. puxar_aviso_agente devolve image_path.
--    Muda a assinatura -> DROP + CREATE. Corpo identico, so carregando a coluna.
-- ---------------------------------------------------------------------------
drop function if exists public.puxar_aviso_agente(text);

create function public.puxar_aviso_agente(p_rustdesk_id text)
returns table (titulo text, mensagem text, image_path text)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id     uuid;
  v_titulo text;
  v_msg    text;
  v_camp   uuid;
  v_image  text;
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
  returning a.id, a.titulo, a.mensagem, a.campaign_id, a.image_path
       into v_id, v_titulo, v_msg, v_camp, v_image;

  if v_id is null then return; end if;

  if v_camp is not null then
    select ab.id, ab.tenant_id into v_device, v_tenant
      from public.address_book ab
     where ab.rustdesk_id = p_rustdesk_id;

    insert into public.ad_impressions
      (campaign_id, placement, surface, viewer_device_id, viewer_tenant_id)
    values
      (v_camp, 'agent_exhausted', 'agente', v_device, v_tenant);
  end if;

  titulo := v_titulo;
  mensagem := v_msg;
  image_path := v_image;
  return next;
end;
$function$;

revoke all on function public.puxar_aviso_agente(text) from public, anon, authenticated;
grant execute on function public.puxar_aviso_agente(text) to service_role;
