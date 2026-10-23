-- AcessoFast, 23/10/2026: o Financeiro mostrava o preco de TABELA do plano, mesmo
-- para quem contratou com a oferta de lancamento ou com cupom. O valor de verdade
-- fica na intencao paga (signup_intents) e na janela de desconto
-- (promo_subscription_windows), e as duas so o super_admin le. Esta RPC entrega ao
-- administrador da empresa so o que ele precisa: quanto a empresa paga hoje.
--
-- valor_cents: mensal = a mensalidade atual; anual = o total cobrado no ano.
--   Janela aberta (pending_link/active) -> valor com desconto; restaurada -> valor
--   cheio. Sem janela, ou se a restauracao falhou no Asaas, vale o que foi cobrado.
-- cobrancas_com_desconto: quantas mensalidades ainda saem com desconto (null = sem
--   prazo ou sem desconto).
--
-- Sem linha = a empresa nunca pagou: o painel mostra o preco de vitrine.

create or replace function public.valor_contratado()
returns table(billing_cycle text, valor_cents integer, cobrancas_com_desconto integer)
language sql
stable
security definer
set search_path to ''
as $fn$
  select i.billing_cycle,
         case when w.status in ('pending_link', 'active') then w.discounted_value_cents
              when w.status = 'restored' then w.full_value_cents
              else i.amount_cents end,
         case when w.status in ('pending_link', 'active')
              then greatest(w.discount_months - coalesce(w.payments_counted, 0), 0) end
    from public.signup_intents i
    left join lateral (
      select pw.status, pw.discounted_value_cents, pw.full_value_cents,
             pw.discount_months, pw.payments_counted
        from public.promo_subscription_windows pw
       where pw.signup_intent_id = i.id
       order by pw.created_at desc
       limit 1
    ) w on true
   where i.tenant_id = private.current_tenant_id()
     and private.current_app_role() = 'admin'::public.user_role
     and i.status = 'provisioned'
     and i.environment = 'production'
     and i.amount_cents > 0
   order by i.provisioned_at desc nulls last, i.created_at desc
   limit 1
$fn$;

revoke all on function public.valor_contratado() from public, anon;
grant execute on function public.valor_contratado() to authenticated;
