-- ---------------------------------------------------------------------------
-- Aviso do plano gratuito — ciencia registrada, versionada.
--
-- O card no Financeiro nao garante que alguem leu: e uma tela que a pessoa pode
-- nunca abrir. Este aviso aparece uma vez, dentro do painel, e fica registrado
-- QUEM viu, QUANDO e QUAL VERSAO.
--
-- E AVISO, NAO ACEITE — e a diferenca esta no desenho, nao so no texto. O
-- anuncio e condicao do plano gratuito: nao existe "recusar e continuar no
-- gratuito". Um botao unico "Entendi" descreve exatamente o que acontece.
-- Oferecer "aceito/recuso" com uma unica saida real seria teatro de escolha, e
-- e a mesma incoerencia que ja existe no cadastro, onde a mensagem de erro fala
-- em "termos" que nao existem em lugar nenhum.
--
-- POR QUE A VERSAO E O CAMPO MAIS IMPORTANTE AQUI: a politica promete "se
-- alguma dessas condicoes mudar, avisamos antes de valer"
-- (ANUNCIOS-POLITICA-CONTEUDO.md §5). Isso so e executavel se o registro guarda
-- qual versao foi vista: ao subir a versao, quem viu a anterior volta a receber
-- o aviso, sozinho. Sem esse campo, a frase seria intencao, nao mecanismo.
--
-- POR QUE NO BANCO E NAO EM localStorage: storage de navegador some com limpeza
-- de cache, nao acompanha a pessoa para outra maquina, e nao deixa nada a que se
-- possa apontar depois. Ciencia que nao sobrevive a um Ctrl+Shift+Del nao e
-- ciencia.
-- ---------------------------------------------------------------------------

-- Versao vigente da politica, no MESMO singleton que ja guarda o teto por
-- espectador. Fica no banco (e nao numa constante do front) por dois motivos:
-- subir a versao passa a ser um update, sem deploy; e o cliente nunca escolhe
-- que versao esta reconhecendo — quem carimba e o servidor.
alter table public.ad_policy
  add column if not exists notice_version text not null default '2026-08-19';

comment on column public.ad_policy.notice_version is
  'Versao vigente do aviso do plano gratuito. Subir este valor faz o aviso '
  'reaparecer para todos que so viram versoes anteriores.';

-- ---------------------------------------------------------------------------
-- Registro da ciencia
-- ---------------------------------------------------------------------------
-- Chave composta (usuario, versao) e nao so usuario: guardar HISTORICO, nao
-- estado. Uma linha por versao permite responder "em que data essa pessoa viu a
-- versao 1?" depois de a versao 2 existir — que e a pergunta que se faz quando
-- alguem questiona o que foi comunicado.
create table if not exists public.ad_notice_acks (
  user_id         uuid not null references auth.users(id) on delete cascade,
  policy_version  text not null,
  -- Contexto do momento da ciencia. NAO e chave: a pessoa pode mudar de
  -- empresa depois, e isso nao reescreve o que ela viu naquele dia.
  tenant_id       uuid references public.tenants(id) on delete set null,
  acknowledged_at timestamptz not null default now(),
  primary key (user_id, policy_version)
);

comment on table public.ad_notice_acks is
  'Ciencia do aviso do plano gratuito, por usuario e por versao da politica. '
  'Historico: uma linha por versao vista, nunca sobrescrita.';

alter table public.ad_notice_acks enable row level security;

-- Default privilege do Supabase concede TUDO a anon e authenticated no create
-- table, TRUNCATE inclusive — e TRUNCATE nao passa por RLS. Revoke nominal
-- ANTES de conceder o que se quer. Ver 20260731025047 e a nota em
-- 20260812162229_resolve_agent_update_revoke_anon.
revoke all on public.ad_notice_acks from anon, authenticated;

-- Leitura da propria ciencia: util para a pessoa e inofensiva. Escrita NAO tem
-- grant nenhum — entra so pela RPC abaixo, que carimba auth.uid() e a versao do
-- servidor. Com grant de insert, daria para registrar ciencia de outra pessoa ou
-- de uma versao que nunca esteve no ar.
grant select on public.ad_notice_acks to authenticated;

create policy ad_notice_acks_select_propria on public.ad_notice_acks
  for select to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 1. A tela pergunta: preciso mostrar o aviso?
-- ---------------------------------------------------------------------------
-- Toda a regra mora aqui: so conta no plano gratuito, so quem ainda nao deu
-- ciencia da versao vigente. A tela nao sabe o que e "plano gratuito" nem qual e
-- a versao — ela so desenha o que esta funcao mandar.
create or replace function public.ad_notice_status()
returns table (version text, deve_exibir boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    pol.notice_version,
    -- Aviso e do plano GRATUITO. Conta em plano ou credito nao exibe anuncio,
    -- entao nao ha o que comunicar. super_admin nao tem tenant e cai fora por
    -- consequencia, nao por excecao escrita.
    coalesce(t.billing_mode::text = 'free', false)
      and not exists (
        select 1 from public.ad_notice_acks a
         where a.user_id = auth.uid()
           and a.policy_version = pol.notice_version
      )
    from public.ad_policy pol
    left join public.profiles pr on pr.id = auth.uid()
    left join public.tenants  t  on t.id = pr.tenant_id
   where pol.id = true;
$$;

comment on function public.ad_notice_status() is
  'Diz a tela se o aviso do plano gratuito deve aparecer para quem chamou, e '
  'qual a versao vigente. Toda a regra (conta free, versao nao vista) vive aqui.';

-- ---------------------------------------------------------------------------
-- 2. A tela informa: a pessoa clicou em Entendi
-- ---------------------------------------------------------------------------
-- Sem parametro de proposito. A versao vem do banco e o usuario vem do token:
-- nada que o cliente mande influencia o que fica gravado.
create or replace function public.ad_notice_ack()
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.ad_notice_acks (user_id, policy_version, tenant_id)
  select auth.uid(),
         (select pol.notice_version from public.ad_policy pol where pol.id = true),
         (select pr.tenant_id from public.profiles pr where pr.id = auth.uid())
   where auth.uid() is not null
  -- Clique duplo, dois separadores abertos, recarregar no meio: a ciencia ja
  -- existe e a data original e a que vale. Nao sobrescreve.
  on conflict (user_id, policy_version) do nothing;
$$;

comment on function public.ad_notice_ack() is
  'Registra a ciencia do aviso para o usuario do token, na versao vigente do '
  'servidor. Idempotente: repetir nao reescreve a data original.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.ad_notice_status() from public, anon, authenticated;
revoke all on function public.ad_notice_ack()    from public, anon, authenticated;

grant execute on function public.ad_notice_status() to authenticated;
grant execute on function public.ad_notice_ack()    to authenticated;
