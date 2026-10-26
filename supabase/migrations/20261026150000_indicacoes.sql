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
--   * O revendedor ve so a quantidade de vendas, na area dele no site.
--   * Cupom continua como esta; o link nao da desconto.
--   * O revendedor se cadastra sozinho no site (nome, WhatsApp, Pix e senha) e
--     espera a aprovacao da equipe, em ate 1 dia util; so entao o link funciona.
--     O cadastro manual pelo painel continua e ja nasce aprovado.
--
-- Area do revendedor (acessofast.com.br/revendedor): entra com WhatsApp e senha.
-- A sessao e a chave_painel guardada no navegador. Quem foi cadastrado pelo painel,
-- ou esqueceu a senha, recebe da equipe o link de acesso (/revendedor/acesso/<chave>)
-- e cria a senha la; "gerar novo acesso" no painel troca a chave e apaga a senha.
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
  -- WhatsApp, so digitos com DDD (10 ou 11). E o login da area do revendedor.
  telefone        text,
  pix             text,
  -- Valor por venda, copiado para a indicacao no momento da venda. Mudar aqui so
  -- vale para as vendas seguintes.
  comissao_cents  integer not null default 5000 check (comissao_cents >= 0),
  -- Sessao da area do revendedor e link de acesso (/revendedor/acesso/<chave>).
  -- Quem tem a chave ve a quantidade de vendas dele; nada alem disso.
  chave_painel    uuid not null default gen_random_uuid() unique,
  -- bcrypt (pgcrypto). Null = ainda nao criou senha: so entra pelo link de acesso.
  senha_hash      text,
  -- 'site' = se cadastrou sozinho; 'painel' = cadastrado pela equipe.
  origem          text not null default 'painel' check (origem in ('site', 'painel')),
  -- Aceite das regras e da politica de privacidade, no cadastro pelo site.
  aceite_em       timestamptz,
  -- So revendedor ativo marca clique e indicacao. Cadastro do site nasce inativo e
  -- passa a ativo na aprovacao.
  ativo           boolean not null default true,
  -- Situacao (private.revendedor_situacao): recusado_em preenchido = recusado;
  -- aprovado_em vazio = aguardando aprovacao; senao, ativo ou inativo.
  aprovado_em     timestamptz,
  recusado_em     timestamptz,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint ck_revendedores_codigo
    check (codigo ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'),
  constraint ck_revendedores_nome
    check (length(btrim(nome)) between 1 and 120),
  constraint ck_revendedores_telefone
    check (telefone is null or telefone ~ '^[1-9][0-9]{9,10}$'),
  constraint ck_revendedores_pix
    check (pix is null or length(pix) between 1 and 140)
);

-- Um WhatsApp por revendedor: e com ele que se entra na area.
create unique index if not exists uq_revendedores_telefone
  on public.revendedores(telefone) where telefone is not null;

comment on table public.revendedores is
  'Quem indica o AcessoFast com link proprio (acessofast.com.br/r/<codigo>). Escrita so pelas funcoes desta migracao.';

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

  -- "Tirar empresa deste revendedor" marca aqui em vez de apagar: fica o rastro de
  -- que a atribuicao existiu, e os vinculos com empresa e intencao saem para a
  -- empresa poder ir para outro revendedor. Todas as contas ignoram retirada.
  removida_em        timestamptz,

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
-- 7. Area do revendedor no site (visitante anonimo)
-- ---------------------------------------------------------------------
-- Cadastro e login devolvem o erro como valor em vez de levantar excecao: excecao
-- desfaria a contagem do rl_hit, e o teto de tentativas nao seguraria nada.

-- WhatsApp so com digitos e DDD (10 ou 11). Aceita o 55 do pais na frente.
create or replace function private.revendedor_telefone(p_telefone text)
returns text
language sql
immutable
set search_path to ''
as $fn$
  select case
           when x.d ~ '^55[1-9][0-9]{9,10}$' then substr(x.d, 3)
           when x.d ~ '^[1-9][0-9]{9,10}$' then x.d
         end
    from (select regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g') as d) x
$fn$;

-- IP de quem chamou, pelo cabecalho que o gateway do Supabase repassa.
create or replace function private.ip_da_requisicao()
returns text
language sql
stable
set search_path to ''
as $fn$
  select nullif(btrim(split_part(
           coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''),
           ',', 1)), '')
$fn$;

-- Codigo do link a partir do nome, sem repetir: "Joao da Silva" vira joao-da-silva,
-- e o segundo Joao da Silva vira joao-da-silva-2.
create or replace function private.revendedor_codigo_livre(p_nome text)
returns text
language plpgsql
volatile
security definer
set search_path to ''
as $fn$
declare
  v_base   text;
  v_codigo text;
  v_n      integer := 1;
begin
  v_base := translate(lower(btrim(coalesce(p_nome, ''))),
                      'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn');
  v_base := btrim(regexp_replace(v_base, '[^a-z0-9]+', '-', 'g'), '-');
  -- 28 deixa espaco para o sufixo "-NNN" sem passar dos 32 do codigo.
  v_base := btrim(left(v_base, 28), '-');
  if length(v_base) < 3 then
    v_base := 'parceiro';
  end if;

  v_codigo := v_base;
  while exists (select 1 from public.revendedores r where r.codigo = v_codigo) loop
    v_n := v_n + 1;
    v_codigo := v_base || '-' || v_n;
  end loop;
  return v_codigo;
end;
$fn$;

-- pendente | recusado | ativo | inativo. Uma regra so para o painel e para a area.
create or replace function private.revendedor_situacao(
  p_ativo       boolean,
  p_aprovado_em timestamptz,
  p_recusado_em timestamptz
) returns text
language sql
immutable
set search_path to ''
as $fn$
  select case
           when p_recusado_em is not null then 'recusado'
           when p_aprovado_em is null then 'pendente'
           when p_ativo then 'ativo'
           else 'inativo'
         end
$fn$;

-- Senha da area (Ryan, 26/10/2026): 8 caracteres ou mais, com letra maiuscula,
-- letra minuscula e um caractere especial (espaco nao conta). 72 e o limite do
-- bcrypt. O site confere a mesma regra antes de enviar.
create or replace function private.revendedor_senha_forte(p_senha text)
returns boolean
language sql
immutable
set search_path to ''
as $fn$
  select coalesce(
           length(p_senha) between 8 and 72
           and p_senha ~ '[[:upper:]]'
           and p_senha ~ '[[:lower:]]'
           and p_senha ~ '[^[:alnum:][:space:]]',
           false)
$fn$;

revoke all on function private.revendedor_telefone(text) from public;
revoke all on function private.ip_da_requisicao() from public;
revoke all on function private.revendedor_codigo_livre(text) from public;
revoke all on function private.revendedor_situacao(boolean, timestamptz, timestamptz) from public;
revoke all on function private.revendedor_senha_forte(text) from public;

-- Cadastro pelo site. Nasce inativo, aguardando a aprovacao da equipe (ate 1 dia
-- util): o link so marca indicacao depois de aprovado. A pessoa ja entra na area,
-- que mostra o aviso. chave = sessao da area (o site guarda no navegador).
create or replace function public.revendedor_cadastrar(
  p_nome     text,
  p_telefone text,
  p_pix      text,
  p_senha    text,
  p_aceite   boolean
) returns table(chave uuid, codigo text, erro text)
language plpgsql
volatile
security definer
set search_path to ''
as $fn$
#variable_conflict use_column
declare
  v_tel    text := private.revendedor_telefone(p_telefone);
  v_ip     text := private.ip_da_requisicao();
  v_codigo text;
  v_chave  uuid;
begin
  if v_ip is not null and not public.rl_hit('rev:cad:ip:' || v_ip, 5, 3600) then
    return query select null::uuid, null::text, 'muitas_tentativas';
    return;
  end if;
  if length(btrim(coalesce(p_nome, ''))) not between 2 and 120 then
    return query select null::uuid, null::text, 'nome_invalido';
    return;
  end if;
  if v_tel is null then
    return query select null::uuid, null::text, 'telefone_invalido';
    return;
  end if;
  if length(btrim(coalesce(p_pix, ''))) not between 3 and 140 then
    return query select null::uuid, null::text, 'pix_invalido';
    return;
  end if;
  if not private.revendedor_senha_forte(p_senha) then
    return query select null::uuid, null::text, 'senha_fraca';
    return;
  end if;
  if p_aceite is not true then
    return query select null::uuid, null::text, 'aceite_obrigatorio';
    return;
  end if;
  if exists (select 1 from public.revendedores r where r.telefone = v_tel) then
    return query select null::uuid, null::text, 'telefone_ja_cadastrado';
    return;
  end if;

  v_codigo := private.revendedor_codigo_livre(p_nome);
  begin
    insert into public.revendedores (codigo, nome, telefone, pix, senha_hash, origem, aceite_em, ativo)
    values (v_codigo, btrim(p_nome), v_tel, btrim(p_pix),
            extensions.crypt(p_senha, extensions.gen_salt('bf', 8)), 'site', now(), false)
    returning revendedores.chave_painel into v_chave;
  exception when unique_violation then
    -- Dois cadastros com o mesmo WhatsApp ao mesmo tempo.
    return query select null::uuid, null::text, 'telefone_ja_cadastrado';
    return;
  end;

  return query select v_chave, v_codigo, null::text;
end;
$fn$;

revoke all on function public.revendedor_cadastrar(text, text, text, text, boolean) from public;
grant execute on function public.revendedor_cadastrar(text, text, text, text, boolean) to anon, authenticated;

-- Login da area: WhatsApp e senha. Devolve a chave da sessao.
--   sem_senha         cadastrado pela equipe e ainda sem senha: entra pelo link de acesso
--   dados_incorretos  WhatsApp sem cadastro ou senha errada (mesma resposta para os dois)
create or replace function public.revendedor_entrar(p_telefone text, p_senha text)
returns table(chave uuid, erro text)
language plpgsql
volatile
security definer
set search_path to ''
as $fn$
#variable_conflict use_column
declare
  v_tel   text := private.revendedor_telefone(p_telefone);
  v_ip    text := private.ip_da_requisicao();
  v_chave uuid;
  v_hash  text;
begin
  if (v_ip is not null and not public.rl_hit('rev:login:ip:' || v_ip, 30, 900))
     or (v_tel is not null and not public.rl_hit('rev:login:tel:' || v_tel, 10, 900)) then
    return query select null::uuid, 'muitas_tentativas';
    return;
  end if;

  select r.chave_painel, r.senha_hash into v_chave, v_hash
    from public.revendedores r
   where r.telefone = v_tel;

  if v_chave is not null and v_hash is null then
    return query select null::uuid, 'sem_senha';
    return;
  end if;
  if v_hash is null or v_hash <> extensions.crypt(coalesce(p_senha, ''), v_hash) then
    return query select null::uuid, 'dados_incorretos';
    return;
  end if;
  return query select v_chave, null::text;
end;
$fn$;

revoke all on function public.revendedor_entrar(text, text) from public;
grant execute on function public.revendedor_entrar(text, text) to anon, authenticated;

-- Cria a senha de quem ainda nao tem (primeiro acesso ou acesso novo gerado pela
-- equipe). Quem ja tem senha nao troca por aqui. Devolve null ou o erro.
create or replace function public.revendedor_definir_senha(p_chave uuid, p_senha text)
returns text
language plpgsql
volatile
security definer
set search_path to ''
as $fn$
begin
  if not private.revendedor_senha_forte(p_senha) then
    return 'senha_fraca';
  end if;
  update public.revendedores r
     set senha_hash = extensions.crypt(p_senha, extensions.gen_salt('bf', 8)),
         updated_at = now()
   where r.chave_painel = p_chave
     and r.senha_hash is null;
  if not found then
    return 'nao_permitido';
  end if;
  return null;
end;
$fn$;

revoke all on function public.revendedor_definir_senha(uuid, text) from public;
grant execute on function public.revendedor_definir_senha(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. Painel da plataforma (super_admin)
-- ---------------------------------------------------------------------
-- p_id null cria; senao edita nome, WhatsApp, pix e ativo. O codigo so vale na
-- criacao. Os opcionais tem default para o painel poder omiti-los.
create or replace function public.salvar_revendedor(
  p_nome     text,
  p_codigo   text default null,
  p_telefone text default null,
  p_pix      text default null,
  p_ativo    boolean default null,
  p_id       uuid default null
) returns uuid
language plpgsql
volatile
security definer
set search_path to ''
as $fn$
declare
  v_id  uuid;
  v_tel text := private.revendedor_telefone(p_telefone);
begin
  if not private.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_tel is null and btrim(coalesce(p_telefone, '')) <> '' then
    raise exception 'telefone_invalido' using errcode = 'P0001';
  end if;

  if p_id is null then
    -- Cadastrado pela equipe ja nasce aprovado.
    insert into public.revendedores (codigo, nome, telefone, pix, ativo, origem, aprovado_em, created_by)
    values (
      lower(btrim(p_codigo)),
      btrim(p_nome),
      v_tel,
      nullif(btrim(coalesce(p_pix, '')), ''),
      coalesce(p_ativo, true),
      'painel',
      now(),
      (select auth.uid())
    )
    returning id into v_id;
  else
    -- Ativar/desativar so vale para quem ja foi aprovado; pendente e recusado mudam
    -- por revendedor_decidir.
    update public.revendedores r
       set nome       = btrim(p_nome),
           telefone   = v_tel,
           pix        = nullif(btrim(coalesce(p_pix, '')), ''),
           ativo      = case when r.aprovado_em is not null and r.recusado_em is null
                             then coalesce(p_ativo, r.ativo) else r.ativo end,
           updated_at = now()
     where r.id = p_id
    returning r.id into v_id;
    if v_id is null then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$fn$;

revoke all on function public.salvar_revendedor(text, text, text, text, boolean, uuid) from public, anon;
grant execute on function public.salvar_revendedor(text, text, text, text, boolean, uuid) to authenticated;

-- Aprova (o link passa a funcionar) ou recusa um cadastro do site. Recusado
-- continua no banco: o WhatsApp fica ocupado e a area mostra que nao foi aprovado.
-- Aprovar um recusado tambem vale, para desfazer engano.
create or replace function public.revendedor_decidir(p_id uuid, p_aprovar boolean)
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
  update public.revendedores r
     set aprovado_em = case when p_aprovar then coalesce(r.aprovado_em, now()) else r.aprovado_em end,
         recusado_em = case when p_aprovar then null else now() end,
         ativo       = p_aprovar,
         updated_at  = now()
   where r.id = p_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$fn$;

revoke all on function public.revendedor_decidir(uuid, boolean) from public, anon;
grant execute on function public.revendedor_decidir(uuid, boolean) to authenticated;

-- Quantos cadastros esperam aprovacao: o numero no menu do painel.
create or replace function public.revendedores_pendentes()
returns integer
language sql
stable
security definer
set search_path to ''
as $fn$
  select count(*)::integer
    from public.revendedores r
   where r.aprovado_em is null
     and r.recusado_em is null
     and private.is_super_admin()
$fn$;

revoke all on function public.revendedores_pendentes() from public, anon;
grant execute on function public.revendedores_pendentes() to authenticated;

-- Esqueceu a senha (ou o link vazou): troca a chave, apaga a senha e devolve a
-- chave nova para a equipe mandar o link de acesso. A sessao antiga cai.
create or replace function public.revendedor_novo_acesso(p_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path to ''
as $fn$
declare
  v_chave uuid;
begin
  if not private.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.revendedores r
     set chave_painel = gen_random_uuid(),
         senha_hash   = null,
         updated_at   = now()
   where r.id = p_id
  returning r.chave_painel into v_chave;
  if v_chave is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return v_chave;
end;
$fn$;

revoke all on function public.revendedor_novo_acesso(uuid) from public, anon;
grant execute on function public.revendedor_novo_acesso(uuid) to authenticated;

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
  telefone      text,
  pix           text,
  ativo         boolean,
  origem        text,
  tem_senha     boolean,
  situacao      text,
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
  select r.id, r.codigo, r.nome, r.telefone, r.pix, r.ativo, r.origem,
         r.senha_hash is not null,
         private.revendedor_situacao(r.ativo, r.aprovado_em, r.recusado_em),
         r.chave_painel, r.created_at,
         (select count(*) from public.revendedor_cliques c
           where c.revendedor_id = r.id
             and (p_inicio is null or c.dia >= p_inicio)
             and (p_fim is null or c.dia < p_fim)),
         (select count(*) from public.indicacoes i
           where i.revendedor_id = r.id
             and i.removida_em is null
             and (i.tenant_id is not null or i.venda_em is not null)
             and (p_inicio is null or (i.created_at at time zone 'America/Sao_Paulo')::date >= p_inicio)
             and (p_fim is null or (i.created_at at time zone 'America/Sao_Paulo')::date < p_fim)),
         (select count(*) from public.indicacoes i
           where i.revendedor_id = r.id
             and i.removida_em is null
             and i.venda_em is not null
             and (p_inicio is null or i.competencia >= p_inicio)
             and (p_fim is null or i.competencia < p_fim)),
         (select coalesce(sum(i.comissao_cents), 0) from public.indicacoes i
           where i.revendedor_id = r.id and i.removida_em is null
             and i.venda_em is not null and i.comissao_paga_em is null),
         (select coalesce(sum(i.comissao_cents), 0) from public.indicacoes i
           where i.revendedor_id = r.id and i.removida_em is null
             and i.comissao_paga_em is not null)
    from public.revendedores r
   where private.is_super_admin()
   -- Quem espera aprovacao primeiro: e o que pede acao.
   order by case private.revendedor_situacao(r.ativo, r.aprovado_em, r.recusado_em)
              when 'pendente' then 0 when 'ativo' then 1 when 'inativo' then 2 else 3 end,
            r.nome
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
     and i.removida_em is null
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
     and i.removida_em is null
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

  update public.indicacoes i
     set removida_em      = now(),
         tenant_id        = null,
         signup_intent_id = null
   where i.id = p_indicacao_id
     and i.comissao_paga_em is null
     and i.removida_em is null;
  if not found then
    raise exception 'comissao_ja_paga' using errcode = 'P0001';
  end if;
end;
$fn$;

revoke all on function public.desvincular_indicacao(uuid) from public, anon;
grant execute on function public.desvincular_indicacao(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 9. Area do revendedor (pela chave da sessao)
-- ---------------------------------------------------------------------
-- Das vendas, so a quantidade: nada de empresa, valor ou clique. Os dados
-- cadastrais sao os dele mesmo (WhatsApp e Pix), para ele conferir.
create or replace function public.revendedor_painel(p_chave uuid)
returns table(
  nome         text,
  codigo       text,
  ativo        boolean,
  tem_senha    boolean,
  situacao     text,
  telefone     text,
  pix          text,
  vendas_total bigint,
  vendas_mes   bigint,
  meses        jsonb
)
language sql
stable
security definer
set search_path to ''
as $fn$
  select r.nome, r.codigo, r.ativo, r.senha_hash is not null,
         private.revendedor_situacao(r.ativo, r.aprovado_em, r.recusado_em),
         r.telefone, r.pix,
         (select count(*) from public.indicacoes i
           where i.revendedor_id = r.id and i.removida_em is null and i.venda_em is not null),
         (select count(*) from public.indicacoes i
           where i.revendedor_id = r.id
             and i.removida_em is null
             and i.venda_em is not null
             and i.competencia = date_trunc('month', now() at time zone 'America/Sao_Paulo')::date),
         coalesce((
           select jsonb_agg(jsonb_build_object('mes', m.competencia, 'vendas', m.n)
                            order by m.competencia desc)
             from (select i.competencia, count(*) as n
                     from public.indicacoes i
                    where i.revendedor_id = r.id and i.removida_em is null and i.venda_em is not null
                    group by i.competencia
                    order by i.competencia desc
                    limit 12) m
         ), '[]'::jsonb)
    from public.revendedores r
   where r.chave_painel = p_chave
$fn$;

revoke all on function public.revendedor_painel(uuid) from public;
grant execute on function public.revendedor_painel(uuid) to anon, authenticated;
