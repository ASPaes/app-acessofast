-- AcessoFast, 28/10/2026: o Financeiro da Plataforma mostrava so o valor por mes de
-- cada conta. Faltava o que o cliente pagou de fato: o total, em quantas vezes, em
-- que forma e quando o dinheiro cai na conta. Isso ja chega pelo webhook do Asaas
-- (asaas_events, desde 21/08/2026), so nao tinha ligacao com a conta.
--
-- Uma linha por cobranca do Asaas (payment_id), no estado do ULTIMO evento recebido.
-- `evento` vai junto porque cobranca removida no Asaas chega com o status de antes
-- (PENDING) e so o tipo do evento diz que ela saiu.
--
-- A conta da cobranca sai, nesta ordem, de:
--   1. compra de creditos (credit_purchases) -> origem 'creditos';
--   2. contratacao (signup_intents) pelo pagamento, checkout ou referencia;
--   3. assinatura do tenant (mensal);
--   4. cliente do Asaas do tenant (mesma regra do webhook para renovacao).
-- A conta do Asaas e da ASP inteira: certificado digital e outros produtos chegam no
-- mesmo webhook. Cobranca que nao liga em nenhuma conta do AcessoFast fica de fora.
--
-- parcelas: o Asaas nao manda o total de parcelas no pagamento, so na descricao que
-- ele mesmo gera ("Parcela 1 de 3."). Sem ela, conta as cobrancas do parcelamento
-- que ja chegaram.

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
  )
  select l.payment_id,
         l.tenant_id,
         l.origem,
         l.p->>'billingType',
         l.p->>'status',
         l.event_type,
         round((l.p->>'value')::numeric * 100)::integer,
         round((l.p->>'netValue')::numeric * 100)::integer,
         l.p->>'installment',
         (l.p->>'installmentNumber')::integer,
         coalesce(
           substring(l.p->>'description' from 'Parcela [0-9]+ de ([0-9]+)')::integer,
           case when l.p->>'installment' is not null
                then (count(*) over (partition by l.p->>'installment'))::integer end
         ),
         l.p->>'subscription',
         (l.p->>'dueDate')::date,
         coalesce(l.p->>'clientPaymentDate', l.p->>'confirmedDate', l.p->>'paymentDate')::date,
         coalesce(l.p->>'creditDate', l.p->>'estimatedCreditDate')::date,
         l.received_at
    from ligado l
   where l.tenant_id is not null
     and private.is_super_admin()
   order by coalesce(l.p->>'clientPaymentDate', l.p->>'confirmedDate', l.p->>'paymentDate', l.p->>'dueDate') desc nulls last,
            (l.p->>'installmentNumber')::integer desc nulls last
$fn$;

revoke all on function public.pagamentos_plataforma() from public, anon;
grant execute on function public.pagamentos_plataforma() to authenticated;
