-- AcessoFast, 23/10/2026: a receita da Plataforma (Financeiro do super admin) somava o
-- preco de TABELA de quem tinha assinatura no Asaas. Dois erros com o mesmo efeito de
-- numero falso:
--   * quem contratou com a oferta de lancamento ou com cupom paga menos que a tabela;
--   * o plano ANUAL e cobranca unica (DETACHED/INSTALLMENT), nao cria assinatura, entao
--     quem pagou o ano inteiro caia em "Sem cobranca" e ficava fora da receita.
--
-- O valor de verdade sai da ultima contratacao paga (signup_intents) e da janela de
-- desconto (promo_subscription_windows). A regra fica num lugar so, usada pelas duas
-- telas: o Financeiro da empresa (valor_contratado, so o admin dela) e o da Plataforma
-- (valores_contratados_plataforma, so super_admin).
--
-- valor_cents: mensal = a mensalidade atual; anual = o total cobrado no ano.
--   Janela aberta (pending_link/active) -> valor com desconto; restaurada -> valor
--   cheio. Sem janela, ou se a restauracao falhou no Asaas, vale o que foi cobrado.
-- cobrancas_com_desconto: mensalidades que ainda saem com desconto (null = nenhuma
--   janela aberta).

create or replace function private.valores_contratados()
returns table(tenant_id uuid, billing_cycle text, valor_cents integer, cobrancas_com_desconto integer)
language sql
stable
security definer
set search_path to ''
as $fn$
  select distinct on (i.tenant_id)
         i.tenant_id,
         i.billing_cycle,
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
   where i.tenant_id is not null
     and i.status = 'provisioned'
     and i.environment = 'production'
     and i.amount_cents > 0
   order by i.tenant_id, i.provisioned_at desc nulls last, i.created_at desc
$fn$;

revoke all on function private.valores_contratados() from public, anon, authenticated;

-- Mesma assinatura da versao de 20261023140000: so passa a ler da funcao comum.
create or replace function public.valor_contratado()
returns table(billing_cycle text, valor_cents integer, cobrancas_com_desconto integer)
language sql
stable
security definer
set search_path to ''
as $fn$
  select v.billing_cycle, v.valor_cents, v.cobrancas_com_desconto
    from private.valores_contratados() v
   where v.tenant_id = private.current_tenant_id()
     and private.current_app_role() = 'admin'::public.user_role
$fn$;

create or replace function public.valores_contratados_plataforma()
returns table(tenant_id uuid, billing_cycle text, valor_cents integer, cobrancas_com_desconto integer)
language sql
stable
security definer
set search_path to ''
as $fn$
  select v.tenant_id, v.billing_cycle, v.valor_cents, v.cobrancas_com_desconto
    from private.valores_contratados() v
   where private.is_super_admin()
$fn$;

revoke all on function public.valores_contratados_plataforma() from public, anon;
grant execute on function public.valores_contratados_plataforma() to authenticated;
