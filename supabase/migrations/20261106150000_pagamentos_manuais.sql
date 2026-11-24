-- AcessoFast, 06/11/2026: pagamento de plano feito por fora do checkout passa a ser
-- registrado no Financeiro da Plataforma, sem pedir SQL a ninguem.
--
-- POR QUE EXISTE: alguns clientes pagam o anual por Pix direto na chave da ASP para fugir
-- dos juros do parcelamento no Asaas (Feax em 03/11, Consysa em 06/11, as duas liberadas
-- a mao). O Asaas transforma esse Pix numa cobranca dele ("Cobranca gerada automaticamente
-- a partir de Pix recebido"), com um cliente criado na hora, que nao liga em conta nenhuma
-- do AcessoFast: o webhook so registra (intent_not_found).
--
-- O QUE O REGISTRO FAZ (registrar_pagamento_manual, so super_admin):
--   * cria a contratacao paga em signup_intents (provisioned, anual). E ela que o
--     Financeiro, a oferta de lancamento e a faixa do topo ja leem;
--   * aplica o plano (assign_plan, com vagas por excecao se pedirem) e libera a conta:
--     active, fora do teste, com vencimento;
--   * marca a venda do revendedor, como o webhook faz no 1o pagamento de plano.
--
-- SO ANUAL, de proposito: plano mensal fora do checkout nao tem quem cobre o mes seguinte,
-- e a faixa do topo avisa o vencimento com 30 dias de antecedencia, ou seja, o mes inteiro.
--
-- VENCIMENTO: 12 meses a partir de agora; se a conta ja tem plano pago em dia, a partir do
-- vencimento atual (renovar antes nao perde dias). Pode ser informado a mao.
--
-- COBRANCA DO ASAAS: com asaas_payment_id, valor, data e forma vem da cobranca, e o
-- Financeiro mostra a cobranca de la (pagamentos_plataforma liga pela contratacao). Sem
-- cobranca (transferencia, dinheiro), o Financeiro mostra este registro.
--
-- NAO grava o cliente do Asaas na conta: com ele la, qualquer Pix futuro do mesmo pagador
-- reativaria a conta suspensa sozinho (passo 10 do asaas-webhook-prod).
--
-- CORRIGIR: editar_pagamento_manual muda valor, data e forma (so sem cobranca do Asaas),
-- vencimento, referencia e observacao.
-- CANCELAR: cancelar_pagamento_manual devolve a conta exatamente como estava antes
-- (estado_anterior) e desfaz a contratacao. Vencimento e cancelamento so valem enquanto a
-- conta continua no vencimento que este pagamento deu: se algo mudou depois (renovacao,
-- outro pagamento), recusa em vez de desfazer por cima.
--
-- Leitura: tabela com RLS e sem policy. O painel le por pagamentos_manuais_lista e
-- pix_sem_vinculo, as duas com private.is_super_admin().
--
-- Aplicada em 06/11/2026 via apply_migration (pagamentos_manuais). Testada no banco com
-- super_admin simulado e tudo desfeito no fim: registrar, corrigir e cancelar na conta
-- "teste" (cancelar devolveu a conta igual), cobranca ja ligada recusada, tecnico recusado.

-- ---------------------------------------------------------------------
-- 1. Tabela
-- ---------------------------------------------------------------------
create table if not exists public.pagamentos_manuais (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  -- A contratacao que este pagamento criou. delete_tenant apaga as duas.
  signup_intent_id    uuid not null unique references public.signup_intents(id) on delete cascade,
  plan_code           text not null references public.plans(code),
  valor_cents         integer not null check (valor_cents > 0),
  pago_em             date not null,
  forma               text not null
                      check (forma in ('pix', 'transferencia', 'boleto', 'cartao', 'dinheiro', 'outro')),
  asaas_payment_id    text,
  -- ID da transacao do comprovante, para achar o pagamento no extrato.
  referencia          text,
  observacao          text,
  -- Vagas pedidas no registro; null = as do plano.
  vagas               integer check (vagas is null or vagas >= 1),
  vencimento_anterior timestamptz,
  vencimento_novo     timestamptz not null,
  -- A conta antes do registro, nos campos que o registro muda. O cancelamento devolve isto.
  estado_anterior     jsonb not null,
  -- registrar_venda_indicada marcou a venda do revendedor por causa deste pagamento.
  venda_indicada      boolean not null default false,
  status              text not null default 'ativo' check (status in ('ativo', 'cancelado')),
  registrado_por      uuid,
  registrado_em       timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),
  cancelado_por       uuid,
  cancelado_em        timestamptz,
  motivo_cancelamento text
);

-- Uma cobranca do Asaas paga um plano so. Cancelar libera a cobranca para outra conta.
create unique index if not exists pagamentos_manuais_cobranca_ativa
  on public.pagamentos_manuais (asaas_payment_id)
  where status = 'ativo' and asaas_payment_id is not null;
create index if not exists pagamentos_manuais_tenant
  on public.pagamentos_manuais (tenant_id, registrado_em desc);

alter table public.pagamentos_manuais enable row level security;
revoke all on public.pagamentos_manuais from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Registrar
-- ---------------------------------------------------------------------
create or replace function public.registrar_pagamento_manual(
  p_tenant           uuid,
  p_plan_code        text,
  p_valor_cents      integer default null,
  p_pago_em          date default null,
  p_forma            text default null,
  p_asaas_payment_id text default null,
  p_vagas            integer default null,
  p_vence_em         timestamptz default null,
  p_referencia       text default null,
  p_observacao       text default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  t        public.tenants%rowtype;
  v_plano  public.plans%rowtype;
  v_cob    text := nullif(btrim(coalesce(p_asaas_payment_id, '')), '');
  v_evento text;
  v_p      jsonb;
  v_valor  integer := p_valor_cents;
  v_pago   date := p_pago_em;
  v_forma  text := p_forma;
  v_base   timestamptz;
  v_vence  timestamptz;
  v_email  text;
  v_intent uuid;
  v_venda  boolean;
  v_id     uuid;
begin
  if not private.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into t from public.tenants where id = p_tenant for update;
  if t.id is null then
    raise exception 'tenant_not_found' using errcode = 'P0001';
  end if;
  if not t.is_active then
    raise exception 'conta_inativa' using errcode = 'P0001';
  end if;
  if t.billing_exempt and (t.billing_exempt_until is null or t.billing_exempt_until > now()) then
    raise exception 'conta_isenta' using errcode = 'P0001';
  end if;

  select * into v_plano from public.plans where code = p_plan_code;
  if v_plano.code is null or not v_plano.is_active
     or (not v_plano.is_custom and coalesce(v_plano.price_year_cents, 0) = 0) then
    raise exception 'plano_invalido' using errcode = 'P0001';
  end if;

  -- Cobranca do Asaas: valor, data e forma saem dela, nao do formulario.
  if v_cob is not null then
    select e.event_type, e.payload->'payment' into v_evento, v_p
      from public.asaas_events e
     where e.environment = 'production'
       and e.payment_id = v_cob
       and jsonb_typeof(e.payload->'payment') = 'object'
     order by e.received_at desc
     limit 1;
    if v_p is null then
      raise exception 'cobranca_nao_encontrada' using errcode = 'P0001';
    end if;
    if v_evento = 'PAYMENT_DELETED'
       or coalesce(v_p->>'status', '') not in ('CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH') then
      raise exception 'cobranca_nao_paga' using errcode = 'P0001';
    end if;
    -- Ja ligada a uma conta no Financeiro (mesmas ligacoes de pagamentos_plataforma).
    if exists (select 1 from public.signup_intents i where i.asaas_payment_id = v_cob)
       or exists (select 1 from public.credit_purchases c where c.asaas_payment_id = v_cob)
       or exists (select 1 from public.pagamentos_manuais m
                   where m.asaas_payment_id = v_cob and m.status = 'ativo')
       or exists (select 1 from public.tenants x
                   where x.asaas_customer_id = v_p->>'customer'
                      or x.asaas_subscription_id = v_p->>'subscription') then
      raise exception 'cobranca_ja_vinculada' using errcode = 'P0001';
    end if;
    v_valor := round((v_p->>'value')::numeric * 100)::integer;
    v_pago  := coalesce(v_p->>'clientPaymentDate', v_p->>'confirmedDate', v_p->>'paymentDate')::date;
    v_forma := case v_p->>'billingType'
                 when 'PIX' then 'pix'
                 when 'BOLETO' then 'boleto'
                 when 'CREDIT_CARD' then 'cartao'
                 when 'DEBIT_CARD' then 'cartao'
                 else 'outro'
               end;
  end if;

  if v_valor is null or v_valor <= 0 then
    raise exception 'valor_invalido' using errcode = 'P0001';
  end if;
  if v_pago is null or v_pago > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'data_invalida' using errcode = 'P0001';
  end if;
  if v_forma is null
     or v_forma not in ('pix', 'transferencia', 'boleto', 'cartao', 'dinheiro', 'outro') then
    raise exception 'forma_invalida' using errcode = 'P0001';
  end if;

  v_base := case
              when not t.is_trial
               and t.billing_status <> 'suspended'
               and t.plan_expires_at > now()
               and exists (select 1 from private.valores_contratados() v where v.tenant_id = t.id)
              then t.plan_expires_at
              else now()
            end;
  v_vence := coalesce(p_vence_em, v_base + interval '12 months');
  if v_vence <= now() then
    raise exception 'vencimento_invalido' using errcode = 'P0001';
  end if;

  select p.email into v_email
    from public.profiles p
   where p.tenant_id = t.id and p.role = 'admin'::public.user_role and p.is_active
   order by p.created_at
   limit 1;

  insert into public.signup_intents
    (status, company_name, cnpj, admin_email, plan_code, billing_cycle, amount_cents,
     tenant_id, environment, asaas_payment_id, provisioned_at)
  values
    ('provisioned', t.name, t.cnpj, coalesce(t.billing_email, v_email, '-'), v_plano.code,
     'annual', v_valor, t.id, 'production', v_cob, now())
  returning id into v_intent;

  -- Valida as vagas (plano sob medida exige numero) e grava o limite simultaneo do plano.
  perform public.assign_plan(t.id, v_plano.code, p_vagas, null);

  update public.tenants
     set billing_status      = 'active',
         is_trial            = false,
         past_due_since      = null,
         billing_invoice_url = null,
         plan_expires_at     = v_vence,
         updated_at          = now()
   where id = t.id;

  v_venda := public.registrar_venda_indicada(t.id, v_intent, v_cob);

  insert into public.pagamentos_manuais (
    tenant_id, signup_intent_id, plan_code, valor_cents, pago_em, forma, asaas_payment_id,
    referencia, observacao, vagas, vencimento_anterior, vencimento_novo, estado_anterior,
    venda_indicada, registrado_por
  ) values (
    t.id, v_intent, v_plano.code, v_valor, v_pago, v_forma, v_cob,
    nullif(btrim(coalesce(p_referencia, '')), ''), nullif(btrim(coalesce(p_observacao, '')), ''),
    p_vagas, t.plan_expires_at, v_vence,
    jsonb_build_object(
      'plan_code', t.plan_code,
      'seat_limit', t.seat_limit,
      'max_concurrent_per_tech', t.max_concurrent_per_tech,
      'billing_mode', t.billing_mode,
      'billing_status', t.billing_status,
      'plan_expires_at', t.plan_expires_at,
      'is_trial', t.is_trial,
      'past_due_since', t.past_due_since,
      'billing_invoice_url', t.billing_invoice_url
    ),
    coalesce(v_venda, false), (select auth.uid())
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

-- ---------------------------------------------------------------------
-- 3. Corrigir
-- ---------------------------------------------------------------------
create or replace function public.editar_pagamento_manual(
  p_id          uuid,
  p_valor_cents integer,
  p_pago_em     date,
  p_forma       text,
  p_vence_em    timestamptz,
  p_referencia  text,
  p_observacao  text
)
returns void
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  m       public.pagamentos_manuais%rowtype;
  v_atual timestamptz;
begin
  if not private.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into m from public.pagamentos_manuais where id = p_id for update;
  if m.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if m.status <> 'ativo' then
    raise exception 'pagamento_cancelado' using errcode = 'P0001';
  end if;

  -- Ligado a cobranca do Asaas: valor, data e forma sao os de la e ficam como estao.
  if m.asaas_payment_id is null then
    if p_valor_cents is null or p_valor_cents <= 0 then
      raise exception 'valor_invalido' using errcode = 'P0001';
    end if;
    if p_pago_em is null or p_pago_em > (now() at time zone 'America/Sao_Paulo')::date then
      raise exception 'data_invalida' using errcode = 'P0001';
    end if;
    if p_forma is null
       or p_forma not in ('pix', 'transferencia', 'boleto', 'cartao', 'dinheiro', 'outro') then
      raise exception 'forma_invalida' using errcode = 'P0001';
    end if;
    update public.signup_intents
       set amount_cents = p_valor_cents, updated_at = now()
     where id = m.signup_intent_id;
  end if;

  if p_vence_em is distinct from m.vencimento_novo then
    if p_vence_em is null or p_vence_em <= now() then
      raise exception 'vencimento_invalido' using errcode = 'P0001';
    end if;
    select plan_expires_at into v_atual from public.tenants where id = m.tenant_id for update;
    if v_atual is distinct from m.vencimento_novo then
      raise exception 'conta_mudou_depois' using errcode = 'P0001';
    end if;
    -- Suspensa com o vencimento deste pagamento = suspensa porque ele venceu.
    update public.tenants
       set plan_expires_at = p_vence_em,
           billing_status  = case when billing_status = 'suspended' then 'active' else billing_status end,
           updated_at      = now()
     where id = m.tenant_id;
  end if;

  update public.pagamentos_manuais
     set valor_cents     = case when m.asaas_payment_id is null then p_valor_cents else valor_cents end,
         pago_em         = case when m.asaas_payment_id is null then p_pago_em else pago_em end,
         forma           = case when m.asaas_payment_id is null then p_forma else forma end,
         vencimento_novo = coalesce(p_vence_em, vencimento_novo),
         referencia      = nullif(btrim(coalesce(p_referencia, '')), ''),
         observacao      = nullif(btrim(coalesce(p_observacao, '')), ''),
         atualizado_em   = now()
   where id = p_id;
end;
$fn$;

-- ---------------------------------------------------------------------
-- 4. Cancelar
-- ---------------------------------------------------------------------
create or replace function public.cancelar_pagamento_manual(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  m        public.pagamentos_manuais%rowtype;
  t        public.tenants%rowtype;
  v_ant    jsonb;
  v_status text;
  v_vence  timestamptz;
begin
  if not private.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'motivo_obrigatorio' using errcode = 'P0001';
  end if;

  select * into m from public.pagamentos_manuais where id = p_id for update;
  if m.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if m.status <> 'ativo' then
    raise exception 'pagamento_cancelado' using errcode = 'P0001';
  end if;

  select * into t from public.tenants where id = m.tenant_id for update;
  if t.plan_expires_at is distinct from m.vencimento_novo then
    raise exception 'conta_mudou_depois' using errcode = 'P0001';
  end if;

  v_ant    := m.estado_anterior;
  v_vence  := (v_ant->>'plan_expires_at')::timestamptz;
  v_status := v_ant->>'billing_status';
  -- Prazo de antes ja passou: deixa como o cron deixaria na madrugada.
  if v_status <> 'suspended' and v_vence is not null and v_vence < now()
     and not (t.billing_exempt and (t.billing_exempt_until is null or t.billing_exempt_until > now())) then
    v_status := 'suspended';
  end if;

  update public.tenants
     set plan_code               = v_ant->>'plan_code',
         seat_limit              = (v_ant->>'seat_limit')::integer,
         max_concurrent_per_tech = (v_ant->>'max_concurrent_per_tech')::integer,
         billing_mode            = (v_ant->>'billing_mode')::public.billing_mode,
         billing_status          = v_status,
         plan_expires_at         = v_vence,
         is_trial                = coalesce((v_ant->>'is_trial')::boolean, false),
         past_due_since          = (v_ant->>'past_due_since')::timestamptz,
         billing_invoice_url     = v_ant->>'billing_invoice_url',
         updated_at              = now()
   where id = t.id;

  -- A cobranca do Asaas sai da conta (fica so no historico deste registro) e pode ser
  -- ligada a outra.
  update public.signup_intents
     set status           = 'failed',
         failure_reason   = 'pagamento manual cancelado: ' || btrim(p_motivo),
         asaas_payment_id = null,
         updated_at       = now()
   where id = m.signup_intent_id;

  -- Venda de revendedor marcada por este pagamento volta a esperar, se a comissao ainda
  -- nao foi paga. Paga, fica: o dinheiro ja saiu.
  if m.venda_indicada then
    update public.indicacoes i
       set venda_em            = null,
           asaas_payment_id    = null,
           comissao_cents      = null,
           comissao_percentual = null,
           valor_venda_cents   = null,
           competencia         = null
     where i.tenant_id = m.tenant_id
       and i.venda_em is not null
       and i.comissao_paga_em is null
       and i.removida_em is null;
  end if;

  update public.pagamentos_manuais
     set status              = 'cancelado',
         cancelado_por       = (select auth.uid()),
         cancelado_em        = now(),
         motivo_cancelamento = btrim(p_motivo),
         atualizado_em       = now()
   where id = p_id;
end;
$fn$;

-- ---------------------------------------------------------------------
-- 5. Leitura
-- ---------------------------------------------------------------------
-- pode_desfazer: a conta ainda esta no vencimento que este pagamento deu, entao mudar o
-- vencimento ou cancelar nao passa por cima de nada.
create or replace function public.pagamentos_manuais_lista()
returns table(
  id uuid,
  tenant_id uuid,
  empresa text,
  plan_code text,
  valor_cents integer,
  pago_em date,
  forma text,
  asaas_payment_id text,
  referencia text,
  observacao text,
  vagas integer,
  vencimento_anterior timestamptz,
  vencimento_novo timestamptz,
  status text,
  registrado_por text,
  registrado_em timestamptz,
  cancelado_por text,
  cancelado_em timestamptz,
  motivo_cancelamento text,
  pode_desfazer boolean
)
language sql
stable
security definer
set search_path to ''
as $fn$
  select m.id, m.tenant_id, t.name, m.plan_code, m.valor_cents, m.pago_em, m.forma,
         m.asaas_payment_id, m.referencia, m.observacao, m.vagas,
         m.vencimento_anterior, m.vencimento_novo, m.status,
         rp.email, m.registrado_em, cp.email, m.cancelado_em, m.motivo_cancelamento,
         m.status = 'ativo' and t.plan_expires_at is not distinct from m.vencimento_novo
    from public.pagamentos_manuais m
    join public.tenants t on t.id = m.tenant_id
    left join public.profiles rp on rp.id = m.registrado_por
    left join public.profiles cp on cp.id = m.cancelado_por
   where private.is_super_admin()
   order by m.registrado_em desc
$fn$;

-- Pix feito direto na chave da ASP que ainda nao paga conta nenhuma. Certificado digital
-- e outros produtos chegam no mesmo Asaas, mas com a descricao do pedido; o Pix sem
-- cobranca vem com a descricao que o proprio Asaas escreve. recebido_em e o primeiro aviso
-- (bate com o horario do comprovante).
create or replace function public.pix_sem_vinculo()
returns table(
  payment_id text,
  pago_em date,
  valor_cents integer,
  recebido_em timestamptz,
  comprovante_url text
)
language sql
stable
security definer
set search_path to ''
as $fn$
  with ultimo as (
    select distinct on (e.payment_id)
           e.payment_id, e.event_type, e.payload->'payment' as p,
           min(e.received_at) over (partition by e.payment_id) as primeiro
      from public.asaas_events e
     where e.environment = 'production'
       and e.payment_id is not null
       and jsonb_typeof(e.payload->'payment') = 'object'
     order by e.payment_id, e.received_at desc
  )
  select u.payment_id,
         coalesce(u.p->>'clientPaymentDate', u.p->>'confirmedDate', u.p->>'paymentDate')::date,
         round((u.p->>'value')::numeric * 100)::integer,
         u.primeiro,
         u.p->>'transactionReceiptUrl'
    from ultimo u
   where private.is_super_admin()
     and u.event_type <> 'PAYMENT_DELETED'
     and u.p->>'status' in ('CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH')
     and u.p->>'description' ilike '%a partir de Pix recebido%'
     and u.primeiro > now() - interval '120 days'
     and not exists (select 1 from public.signup_intents i where i.asaas_payment_id = u.payment_id)
     and not exists (select 1 from public.credit_purchases c where c.asaas_payment_id = u.payment_id)
     and not exists (select 1 from public.pagamentos_manuais m
                      where m.asaas_payment_id = u.payment_id and m.status = 'ativo')
     and not exists (select 1 from public.tenants x
                      where x.asaas_customer_id = u.p->>'customer'
                         or x.asaas_subscription_id = u.p->>'subscription')
   order by u.primeiro desc
$fn$;

-- ---------------------------------------------------------------------
-- 6. Pagamentos do Financeiro: inclui o registro sem cobranca do Asaas
-- ---------------------------------------------------------------------
-- Mesma consulta de 20261028150000 para as cobrancas do Asaas. Registro manual ligado a
-- cobranca ja aparece por ela (pela contratacao); o sem cobranca entra como recebido por
-- fora (RECEIVED_IN_CASH, o status que o proprio Asaas usa), sem taxa e com o dinheiro na
-- conta no dia do pagamento.
create or replace function public.pagamentos_plataforma()
returns table(
  payment_id text,
  tenant_id uuid,
  origem text,
  forma text,
  status text,
  evento text,
  valor_cents integer,
  liquido_cents integer,
  parcelamento_id text,
  parcela integer,
  parcelas integer,
  assinatura_id text,
  vencimento date,
  pago_em date,
  credito_em date,
  atualizado_em timestamptz
)
language sql
stable
security definer
set search_path to ''
as $fn$
  with ultimo as (
    select distinct on (e.payment_id)
           e.payment_id, e.event_type, e.received_at, e.payload->'payment' as p
      from public.asaas_events e
     where e.environment = 'production'
       and e.payment_id is not null
       and jsonb_typeof(e.payload->'payment') = 'object'
     order by e.payment_id, e.received_at desc
  ),
  ligado as (
    select u.payment_id, u.event_type, u.received_at, u.p,
           coalesce(cp.tenant_id, si.tenant_id, ts.id, tc.id) as tenant_id,
           case when cp.tenant_id is not null then 'creditos' else 'plano' end as origem
      from ultimo u
      left join lateral (
        select c.tenant_id from public.credit_purchases c
         where c.environment = 'production'
           and (c.asaas_payment_id = u.payment_id
                or c.asaas_checkout_id = u.p->>'checkoutSession'
                or c.id::text = u.p->>'externalReference')
         limit 1
      ) cp on true
      left join lateral (
        select i.tenant_id from public.signup_intents i
         where i.environment = 'production'
           and i.tenant_id is not null
           and (i.asaas_payment_id = u.payment_id
                or i.asaas_checkout_id = u.p->>'checkoutSession'
                or i.id::text = u.p->>'externalReference')
         order by i.provisioned_at desc nulls last
         limit 1
      ) si on true
      left join lateral (
        select t.id from public.tenants t
         where t.asaas_subscription_id = u.p->>'subscription'
         limit 1
      ) ts on true
      left join lateral (
        select t.id from public.tenants t
         where t.asaas_customer_id = u.p->>'customer'
         limit 1
      ) tc on true
  ),
  todos as (
    select l.payment_id,
           l.tenant_id,
           l.origem,
           l.p->>'billingType' as forma,
           l.p->>'status' as status,
           l.event_type as evento,
           round((l.p->>'value')::numeric * 100)::integer as valor_cents,
           round((l.p->>'netValue')::numeric * 100)::integer as liquido_cents,
           l.p->>'installment' as parcelamento_id,
           (l.p->>'installmentNumber')::integer as parcela,
           coalesce(
             substring(l.p->>'description' from 'Parcela [0-9]+ de ([0-9]+)')::integer,
             case when l.p->>'installment' is not null
                  then (count(*) over (partition by l.p->>'installment'))::integer end
           ) as parcelas,
           l.p->>'subscription' as assinatura_id,
           (l.p->>'dueDate')::date as vencimento,
           coalesce(l.p->>'clientPaymentDate', l.p->>'confirmedDate', l.p->>'paymentDate')::date as pago_em,
           coalesce(l.p->>'creditDate', l.p->>'estimatedCreditDate')::date as credito_em,
           l.received_at as atualizado_em
      from ligado l
     where l.tenant_id is not null
    union all
    select 'manual:' || m.id::text,
           m.tenant_id,
           'plano',
           case m.forma
             when 'pix' then 'PIX'
             when 'boleto' then 'BOLETO'
             when 'cartao' then 'CREDIT_CARD'
             when 'transferencia' then 'TRANSFER'
             when 'dinheiro' then 'CASH'
             else 'OTHER'
           end,
           'RECEIVED_IN_CASH',
           'MANUAL',
           m.valor_cents,
           m.valor_cents,
           null,
           null,
           null,
           null,
           m.pago_em,
           m.pago_em,
           m.pago_em,
           m.atualizado_em
      from public.pagamentos_manuais m
     where m.status = 'ativo'
       and m.asaas_payment_id is null
  )
  select x.payment_id, x.tenant_id, x.origem, x.forma, x.status, x.evento, x.valor_cents,
         x.liquido_cents, x.parcelamento_id, x.parcela, x.parcelas, x.assinatura_id,
         x.vencimento, x.pago_em, x.credito_em, x.atualizado_em
    from todos x
   where private.is_super_admin()
   order by coalesce(x.pago_em, x.vencimento) desc nulls last,
            x.parcela desc nulls last
$fn$;

revoke all on function public.registrar_pagamento_manual(uuid, text, integer, date, text, text, integer, timestamptz, text, text) from public, anon;
revoke all on function public.editar_pagamento_manual(uuid, integer, date, text, timestamptz, text, text) from public, anon;
revoke all on function public.cancelar_pagamento_manual(uuid, text) from public, anon;
revoke all on function public.pagamentos_manuais_lista() from public, anon;
revoke all on function public.pix_sem_vinculo() from public, anon;
revoke all on function public.pagamentos_plataforma() from public, anon;
grant execute on function public.registrar_pagamento_manual(uuid, text, integer, date, text, text, integer, timestamptz, text, text) to authenticated;
grant execute on function public.editar_pagamento_manual(uuid, integer, date, text, timestamptz, text, text) to authenticated;
grant execute on function public.cancelar_pagamento_manual(uuid, text) to authenticated;
grant execute on function public.pagamentos_manuais_lista() to authenticated;
grant execute on function public.pix_sem_vinculo() to authenticated;
grant execute on function public.pagamentos_plataforma() to authenticated;

-- ---------------------------------------------------------------------
-- 7. As duas liberacoes feitas a mao antes desta tela
-- ---------------------------------------------------------------------
-- Feax (03/11) e Consysa (06/11): contratacao ja criada, conta ja liberada. Entram aqui
-- com o estado de antes conferido no banco naquele dia, para poderem ser corrigidas ou
-- canceladas pela tela como qualquer outro registro.
insert into public.pagamentos_manuais (
  tenant_id, signup_intent_id, plan_code, valor_cents, pago_em, forma, asaas_payment_id,
  referencia, observacao, vagas, vencimento_anterior, vencimento_novo, estado_anterior,
  registrado_por, registrado_em
)
select i.tenant_id, i.id, i.plan_code, i.amount_cents, x.pago_em, 'pix', i.asaas_payment_id,
       x.referencia, x.observacao, x.vagas, timestamptz '2026-10-31 03:00:00+00', t.plan_expires_at,
       jsonb_build_object(
         'plan_code', x.plano_antes,
         'seat_limit', x.vagas_antes,
         'max_concurrent_per_tech', x.simultaneo_antes,
         'billing_mode', 'plan',
         'billing_status', 'suspended',
         'plan_expires_at', timestamptz '2026-10-31 03:00:00+00',
         'is_trial', false,
         'past_due_since', null,
         'billing_invoice_url', null
       ),
       'eb8d07a1-e100-476f-98e7-d625089bc023'::uuid,
       i.provisioned_at
  from (values
    ('3d3dbb49-832f-4049-a596-e94bfc16f33c'::uuid, 'pay_npgdu7va1330sq4l', date '2026-11-03',
     null::text, 'Liberado por SQL antes desta tela. 6 vagas por excecao (Team = 5), decisao de 03/11/2026.',
     6, 'enterprise', 10, 5),
    ('40a6d915-0251-4889-a93b-cf7210ef4b4e'::uuid, 'pay_8su5n9pbsy7wx5ki', date '2026-11-06',
     'E60701190202611061720DY5P0H1SVT2', 'Liberado por SQL antes desta tela.',
     null::integer, 'team', 5, 3)
  ) as x(tenant_id, cobranca, pago_em, referencia, observacao, vagas, plano_antes, vagas_antes, simultaneo_antes)
  join public.signup_intents i
    on i.tenant_id = x.tenant_id and i.asaas_payment_id = x.cobranca and i.status = 'provisioned'
  join public.tenants t on t.id = x.tenant_id
 where not exists (select 1 from public.pagamentos_manuais m where m.signup_intent_id = i.id);
