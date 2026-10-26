-- AcessoFast, 26/10/2026: link de indicacao para revendedor.
--
-- Cada revendedor tem um codigo e um link (acessofast.com.br/r/<codigo>). Quem
-- abre o link fica marcado no navegador; se fizer cadastro ou contratar no site,
-- a empresa fica ligada ao revendedor. A VENDA e o 1o pagamento de plano dessa
-- empresa confirmado pelo Asaas.
--
-- Regras do Ryan (26/10/2026):
--   * R$ 50 por venda, uma vez por empresa. As mensalidades seguintes nao geram
--     comissao.
--   * A comissao entra no mes em que o pagamento caiu e e paga ate o dia 30,
--     somando as vendas do mes.
--   * Sem validade: quem abriu o link e pagou meses depois ainda conta.
--   * O revendedor ve so a quantidade de vendas, numa pagina sem login.
--   * Cupom continua como esta; o link nao da desconto.
--
-- Quem grava:
--   clique    -> site, registrar_clique_revendedor (anon)
--   indicacao -> start-trial-prod / start-free-prod / create-checkout-prod,
--                registrar_indicacao (service_role)
--   venda     -> asaas-webhook-prod, registrar_venda_indicada (service_role)
--   manual    -> painel, vincular_indicacao (super_admin): venda fechada pelo
--                comercial, ou de quem abriu o link num aparelho e contratou em outro.
--
-- Leitura: as tres tabelas ficam com RLS e sem policy. O painel le pelas funcoes
-- abaixo, todas com private.is_super_admin(); o revendedor, por revendedor_painel.

-- ---------------------------------------------------------------------
-- 1. revendedores
-- ---------------------------------------------------------------------
create table if not exists public.revendedores (
  id              uuid primary key default gen_random_uuid(),
  -- Vai no link. Nao muda depois de criado (salvar_revendedor ignora): o link que
  -- o revendedor ja espalhou pararia de funcionar.
  codigo          text not null unique,
  nome            text not null,
  contato         text,
  pix             text,
  -- Valor por venda, copiado para a indicacao no momento da venda. Mudar aqui so
  -- vale para as vendas seguintes.
  comissao_cents  integer not null default 5000 check (comissao_cents >= 0),
  -- Chave da pagina do revendedor (/revendedor/<chave> no painel). Quem tem o
  -- link ve a quantidade de vendas dele; nada alem disso.
  chave_painel    uuid not null default gen_random_uuid() unique,
  ativo           boolean not null default true,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint ck_revendedores_codigo
    check (codigo ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'),
  constraint ck_revendedores_nome
    check (length(btrim(nome)) between 1 and 120)
);

comment on table public.revendedores is
  'Quem indica o AcessoFast com link proprio (acessofast.com.br/r/<codigo>). Escrita so por salvar_revendedor.';

-- ---------------------------------------------------------------------
-- 2. revendedor_cliques — um por visitante por dia
-- ---------------------------------------------------------------------
create table if not exists public.revendedor_cliques (
  revendedor_id  uuid not null references public.revendedores(id) on delete cascade,
  -- Dia em Brasilia.
  dia            date not null,
  -- Id aleatorio que o site guarda no navegador. Nao identifica a pessoa.
  visitante      text not null check (length(visitante) between 8 and 64),
  primary key (revendedor_id, dia, visitante)
);

comment on table public.revendedor_cliques is
  'Aberturas do link do revendedor. Recarregar ou abrir de novo no mesmo dia nao conta outra vez.';

-- ---------------------------------------------------------------------
-- 3. indicacoes — empresa (ou checkout) ligada a um revendedor
-- ---------------------------------------------------------------------
create table if not exists public.indicacoes (
  id                 uuid primary key default gen_random_uuid(),
  revendedor_id      uuid not null references public.revendedores(id),
  -- Do site. Quem contrata direto no checkout so ganha empresa no pagamento; ate
  -- la a indicacao existe so pela intencao.
  signup_intent_id   uuid unique references public.signup_intents(id) on delete set null,
  -- Uma empresa e de um revendedor so.
  tenant_id          uuid unique references public.tenants(id) on delete set null,
  origem             text not null default 'link' check (origem in ('link', 'manual')),
  created_at         timestamptz not null default now(),

  -- Venda: 1o pagamento de plano. Uma vez so por empresa.
  venda_em           timestamptz,
  asaas_payment_id   text,
  comissao_cents     integer,
  -- Mes da comissao: 1o dia do mes do pagamento, em Brasilia.
  competencia        date,

  comissao_paga_em   timestamptz,
  comissao_paga_por  uuid references public.profiles(id),

  constraint ck_indicacoes_venda check (
    (venda_em is null) = (competencia is null)
    and (venda_em is null) = (comissao_cents is null)
  ),
  constraint ck_indicacoes_paga check (comissao_paga_em is null or venda_em is not null)
);

create index if not exists idx_indicacoes_revendedor
  on public.indicacoes(revendedor_id, created_at desc);
create index if not exists idx_indicacoes_competencia
  on public.indicacoes(revendedor_id, competencia) where venda_em is not null;

comment on table public.indicacoes is
  'Empresa trazida por um revendedor. venda_em/competencia/comissao_cents nascem juntos no 1o pagamento de plano.';

alter table public.revendedores enable row level security;
alter table public.revendedor_cliques enable row level security;
alter table public.indicacoes enable row level security;

revoke all on public.revendedores from anon, authenticated;
revoke all on public.revendedor_cliques from anon, authenticated;
revoke all on public.indicacoes from anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Clique (site, visitante anonimo)
-- ---------------------------------------------------------------------
-- true = codigo de revendedor ativo. O site so guarda a indicacao no navegador
-- quando o codigo existe, para um link errado nao atribuir nada a ninguem.
create or replace function public.registrar_clique_revendedor(p_codigo text, p_visitante text)
returns boolean
language plpgsql
volatile
security definer
set search_path to ''
as $fn$
declare
  v_id uuid;
begin
  select r.id into v_id
    from public.revendedores r
   where r.codigo = lower(btrim(p_codigo))
     and r.ativo;
  if v_id is null then
    return false;
  end if;

  if length(p_visitante) between 8 and 64 then
    insert into public.revendedor_cliques (revendedor_id, dia, visitante)
    values (v_id, (now() at time zone 'America/Sao_Paulo')::date, p_visitante)
    on conflict do nothing;
  end if;
  return true;
end;
$fn$;

revoke all on function public.registrar_clique_revendedor(text, text) from public;
grant execute on function public.registrar_clique_revendedor(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Indicacao (funcoes do site comercial, service_role)
-- ---------------------------------------------------------------------
-- Codigo desconhecido ou inativo nao e erro: o cadastro segue sem indicacao.
create or replace function public.registrar_indicacao(
  p_codigo           text,
  p_signup_intent_id uuid,
  p_tenant_id        uuid default null
) returns boolean
language plpgsql
volatile
security definer
set search_path to ''
as $fn$
declare
  v_id uuid;
begin
  select r.id into v_id
    from public.revendedores r
   where r.codigo = lower(btrim(p_codigo))
     and r.ativo;
  if v_id is null then
    return false;
  end if;

  insert into public.indicacoes (revendedor_id, signup_intent_id, tenant_id, origem)
  values (v_id, p_signup_intent_id, p_tenant_id, 'link')
  on conflict do nothing;
  return found;
end;
$fn$;

revoke all on function public.registrar_indicacao(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.registrar_indicacao(text, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------
-- 6. Venda (asaas-webhook-prod, service_role)
-- ---------------------------------------------------------------------
-- Chamada a cada pagamento de plano aplicado. So o primeiro de cada empresa vira
-- venda: os seguintes encontram venda_em preenchido e nao mudam nada.
create or replace function public.registrar_venda_indicada(
  p_tenant_id        uuid,
  p_signup_intent_id uuid,
  p_payment_id       text
) returns boolean
language plpgsql
volatile
security definer
set search_path to ''
as $fn$
begin
  if p_tenant_id is null then
    return false;
  end if;

  -- Contratou direto no checkout: a empresa acabou de nascer e a indicacao so
  -- conhecia a intencao.
  if p_signup_intent_id is not null then
    update public.indicacoes i
       set tenant_id = p_tenant_id
     where i.signup_intent_id = p_signup_intent_id
       and i.tenant_id is null
       and not exists (select 1 from public.indicacoes x where x.tenant_id = p_tenant_id);
  end if;

  update public.indicacoes i
     set venda_em         = now(),
         asaas_payment_id = p_payment_id,
         comissao_cents   = r.comissao_cents,
         competencia      = date_trunc('month', now() at time zone 'America/Sao_Paulo')::date
    from public.revendedores r
   where r.id = i.revendedor_id
     and i.tenant_id = p_tenant_id
     and i.venda_em is null;
  return found;
end;
$fn$;

revoke all on function public.registrar_venda_indicada(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.registrar_venda_indicada(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- 7. Painel da plataforma (super_admin)
-- ---------------------------------------------------------------------
-- p_id null cria; senao edita nome, contato, pix e ativo. O codigo so vale na
-- criacao. Os opcionais tem default para o painel poder omiti-los.
create or replace function public.salvar_revendedor(
  p_nome    text,
  p_codigo  text default null,
  p_contato text default null,
  p_pix     text default null,
  p_ativo   boolean default null,
  p_id      uuid default null
) returns uuid
language plpgsql
volatile
security definer
set search_path to ''
as $fn$
declare
  v_id uuid;
begin
  if not private.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_id is null then
    insert into public.revendedores (codigo, nome, contato, pix, ativo, created_by)
    values (
      lower(btrim(p_codigo)),
      btrim(p_nome),
      nullif(btrim(coalesce(p_contato, '')), ''),
      nullif(btrim(coalesce(p_pix, '')), ''),
      coalesce(p_ativo, true),
      (select auth.uid())
    )
    returning id into v_id;
  else
    update public.revendedores
       set nome       = btrim(p_nome),
           contato    = nullif(btrim(coalesce(p_contato, '')), ''),
           pix        = nullif(btrim(coalesce(p_pix, '')), ''),
           ativo      = coalesce(p_ativo, ativo),
           updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$fn$;

revoke all on function public.salvar_revendedor(text, text, text, text, boolean, uuid) from public, anon;
grant execute on function public.salvar_revendedor(text, text, text, text, boolean, uuid) to authenticated;

-- Numeros por revendedor. Periodo [p_inicio, p_fim), null = desde sempre:
--   cliques   pelo dia do clique
--   cadastros pela data da indicacao, so as que viraram empresa
--   vendas    pelo mes da comissao
-- a_pagar e pago nao seguem o periodo: e o saldo de hoje.
create or replace function public.indicacoes_resumo(
  p_inicio date default null,
  p_fim    date default null
) returns table(
  id            uuid,
  codigo        text,
  nome          text,
  contato       text,
  pix           text,
  ativo         boolean,
  chave_painel  uuid,
  created_at    timestamptz,
  cliques       bigint,
  cadastros     bigint,
  vendas        bigint,
  a_pagar_cents bigint,
  pago_cents    bigint
)
language sql
stable
security definer
set search_path to ''
as $fn$
  select r.id, r.codigo, r.nome, r.contato, r.pix, r.ativo, r.chave_painel, r.created_at,
         (select count(*) from public.revendedor_cliques c
           where c.revendedor_id = r.id
             and (p_inicio is null or c.dia >= p_inicio)
             and (p_fim is null or c.dia < p_fim)),
         (select count(*) from public.indicacoes i
           where i.revendedor_id = r.id
             and (i.tenant_id is not null or i.venda_em is not null)
             and (p_inicio is null or (i.created_at at time zone 'America/Sao_Paulo')::date >= p_inicio)
             and (p_fim is null or (i.created_at at time zone 'America/Sao_Paulo')::date < p_fim)),
         (select count(*) from public.indicacoes i
           where i.revendedor_id = r.id
             and i.venda_em is not null
             and (p_inicio is null or i.competencia >= p_inicio)
             and (p_fim is null or i.competencia < p_fim)),
         (select coalesce(sum(i.comissao_cents), 0) from public.indicacoes i
           where i.revendedor_id = r.id and i.venda_em is not null and i.comissao_paga_em is null),
         (select coalesce(sum(i.comissao_cents), 0) from public.indicacoes i
           where i.revendedor_id = r.id and i.comissao_paga_em is not null)
    from public.revendedores r
   where private.is_super_admin()
   order by r.ativo desc, r.nome
$fn$;

revoke all on function public.indicacoes_resumo(date, date) from public, anon;
grant execute on function public.indicacoes_resumo(date, date) to authenticated;

-- Empresas de um revendedor, com a situacao de cada uma.
create or replace function public.indicacoes_do_revendedor(p_revendedor_id uuid)
returns table(
  id                   uuid,
  origem               text,
  created_at           timestamptz,
  empresa              text,
  tenant_id            uuid,
  em_teste             boolean,
  gratis               boolean,
  aguardando_pagamento boolean,
  venda_em             timestamptz,
  competencia          date,
  comissao_cents       integer,
  comissao_paga_em     timestamptz
)
language sql
stable
security definer
set search_path to ''
as $fn$
  select i.id, i.origem, i.created_at,
         coalesce(t.name, si.company_name, 'Empresa removida'),
         i.tenant_id,
         coalesce(t.is_trial, false),
         coalesce(t.billing_mode = 'free', false),
         -- Abriu o checkout no site e nao pagou: ainda nao existe empresa.
         i.tenant_id is null and si.id is not null and i.venda_em is null,
         i.venda_em, i.competencia, i.comissao_cents, i.comissao_paga_em
    from public.indicacoes i
    left join public.tenants t on t.id = i.tenant_id
    left join public.signup_intents si on si.id = i.signup_intent_id
   where i.revendedor_id = p_revendedor_id
     and private.is_super_admin()
   order by i.created_at desc
$fn$;

revoke all on function public.indicacoes_do_revendedor(uuid) from public, anon;
grant execute on function public.indicacoes_do_revendedor(uuid) to authenticated;

-- Marca (ou desmarca) como paga a comissao de um revendedor num mes.
create or replace function public.marcar_comissao_paga(
  p_revendedor_id uuid,
  p_competencia   date,
  p_paga          boolean default true
) returns integer
language plpgsql
volatile
security definer
set search_path to ''
as $fn$
declare
  v_n integer;
begin
  if not private.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.indicacoes i
     set comissao_paga_em  = case when p_paga then now() end,
         comissao_paga_por = case when p_paga then (select auth.uid()) end
   where i.revendedor_id = p_revendedor_id
     and i.competencia = p_competencia
     and i.venda_em is not null
     and (i.comissao_paga_em is null) = p_paga;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

revoke all on function public.marcar_comissao_paga(uuid, date, boolean) from public, anon;
grant execute on function public.marcar_comissao_paga(uuid, date, boolean) to authenticated;

-- Liga uma empresa a um revendedor a mao. p_ja_pagou = a empresa ja paga o plano:
-- a venda entra no mes de hoje, porque o pagamento de verdade passou antes do
-- vinculo e o webhook nao vai ve-lo de novo.
create or replace function public.vincular_indicacao(
  p_revendedor_id uuid,
  p_tenant_id     uuid,
  p_ja_pagou      boolean default false
) returns uuid
language plpgsql
volatile
security definer
set search_path to ''
as $fn$
declare
  v_id uuid;
begin
  if not private.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if exists (select 1 from public.indicacoes i where i.tenant_id = p_tenant_id) then
    raise exception 'empresa_ja_indicada' using errcode = 'P0001';
  end if;

  insert into public.indicacoes (
    revendedor_id, tenant_id, origem, venda_em, comissao_cents, competencia
  )
  select r.id, p_tenant_id, 'manual',
         case when p_ja_pagou then now() end,
         case when p_ja_pagou then r.comissao_cents end,
         case when p_ja_pagou
              then date_trunc('month', now() at time zone 'America/Sao_Paulo')::date end
    from public.revendedores r
   where r.id = p_revendedor_id
  returning id into v_id;

  if v_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return v_id;
end;
$fn$;

revoke all on function public.vincular_indicacao(uuid, uuid, boolean) from public, anon;
grant execute on function public.vincular_indicacao(uuid, uuid, boolean) to authenticated;

-- Desfaz um vinculo errado. Comissao ja paga nao sai: o dinheiro ja foi.
create or replace function public.desvincular_indicacao(p_indicacao_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $fn$
begin
  if not private.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  delete from public.indicacoes i
   where i.id = p_indicacao_id
     and i.comissao_paga_em is null;
  if not found then
    raise exception 'comissao_ja_paga' using errcode = 'P0001';
  end if;
end;
$fn$;

revoke all on function public.desvincular_indicacao(uuid) from public, anon;
grant execute on function public.desvincular_indicacao(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Pagina do revendedor (sem login, pela chave)
-- ---------------------------------------------------------------------
-- So quantidade de vendas: nada de empresa, valor ou clique.
create or replace function public.revendedor_painel(p_chave uuid)
returns table(
  nome         text,
  codigo       text,
  vendas_total bigint,
  vendas_mes   bigint,
  meses        jsonb
)
language sql
stable
security definer
set search_path to ''
as $fn$
  select r.nome, r.codigo,
         (select count(*) from public.indicacoes i
           where i.revendedor_id = r.id and i.venda_em is not null),
         (select count(*) from public.indicacoes i
           where i.revendedor_id = r.id
             and i.venda_em is not null
             and i.competencia = date_trunc('month', now() at time zone 'America/Sao_Paulo')::date),
         coalesce((
           select jsonb_agg(jsonb_build_object('mes', m.competencia, 'vendas', m.n)
                            order by m.competencia desc)
             from (select i.competencia, count(*) as n
                     from public.indicacoes i
                    where i.revendedor_id = r.id and i.venda_em is not null
                    group by i.competencia
                    order by i.competencia desc
                    limit 12) m
         ), '[]'::jsonb)
    from public.revendedores r
   where r.chave_painel = p_chave
$fn$;

revoke all on function public.revendedor_painel(uuid) from public;
grant execute on function public.revendedor_painel(uuid) to anon, authenticated;
