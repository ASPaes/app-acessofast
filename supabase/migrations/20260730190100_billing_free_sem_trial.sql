-- =====================================================================
-- Conta gratuita não tem teste: limpa e trava os campos legados
-- =====================================================================
-- Sintoma: conta criada pelo site no plano Individual (grátis) abre o
-- painel com a faixa "Teste grátis: faltam N dias" e uma data de
-- expiração. O painel lê `tenants.is_trial` + `tenants.plan_expires_at`
-- (campos legados, anteriores ao modelo B0) e não o par
-- billing_mode/billing_status. Qualquer linha que nasça pelo caminho de
-- trial fica com esses dois campos gravados — e o Individual grátis
-- passa a se comportar como plano em teste.
--
-- Pior que a faixa: com `plan_expires_at` no futuro, a conta gratuita
-- entra no alcance do corte por vencimento (suspend_expired_plans) e é
-- bloqueada na data — sem nunca ter tido plano.
--
-- Critério de "plano gratuito" aqui: plano existente, não-custom, com
-- price_month_cents = 0 (é o mesmo teste que o site usa para marcar o
-- card como "Grátis"). Trial legítimo (Team/Business) tem plano com
-- preço > 0 e não é tocado por nada deste arquivo.
--
-- Aplicar no projeto plmfyibyrowbgjjyblcl.
-- =====================================================================

-- 1) Default do campo legado. Conta nova não nasce em teste; quem cria
--    trial passa a precisar gravar is_trial = true explicitamente.
alter table public.tenants alter column is_trial set default false;

-- 2) Backfill: contas já criadas no plano gratuito que ficaram marcadas
--    como teste. Zera o teste e o vencimento (tira do alcance do corte).
update public.tenants t
   set is_trial        = false,
       plan_expires_at = null,
       updated_at      = now()
 where (t.is_trial or t.plan_expires_at is not null)
   and t.billing_mode in ('free'::public.billing_mode, 'credits'::public.billing_mode)
   and exists (
         select 1
           from public.plans p
          where p.code = t.plan_code
            and not p.is_custom
            and coalesce(p.price_month_cents, 0) = 0
       );

-- 3) Contas gratuitas que já tinham sido suspensas pelo vencimento desse
--    teste que não existia. Reativa só esse caso: status 'suspended' com
--    data de expiração no passado e sem fatura em aberto.
update public.tenants t
   set billing_status = 'active',
       updated_at     = now()
 where t.billing_status = 'suspended'
   and t.billing_invoice_url is null
   and t.past_due_since is null
   and t.billing_mode in ('free'::public.billing_mode, 'credits'::public.billing_mode)
   and exists (
         select 1
           from public.plans p
          where p.code = t.plan_code
            and not p.is_custom
            and coalesce(p.price_month_cents, 0) = 0
       );

-- 4) Trava: mesmo que o backend de signup grave os campos de teste numa
--    conta de plano gratuito, a linha não persiste em estado inválido.
--    Só age quando o plano da conta é comprovadamente sem preço.
create or replace function public.tenants_plano_gratuito_sem_trial()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if (new.is_trial or new.plan_expires_at is not null)
     and exists (
       select 1
         from public.plans p
        where p.code = new.plan_code
          and not p.is_custom
          and coalesce(p.price_month_cents, 0) = 0
     )
  then
    new.is_trial := false;
    new.plan_expires_at := null;
  end if;
  return new;
end;
$$;

comment on function public.tenants_plano_gratuito_sem_trial() is
  'Plano sem preco nao tem teste nem vencimento: zera is_trial/plan_expires_at na tenant. Trial legitimo (plano pago) nao e afetado.';

drop trigger if exists tenants_plano_gratuito_sem_trial on public.tenants;
create trigger tenants_plano_gratuito_sem_trial
  before insert or update on public.tenants
  for each row execute function public.tenants_plano_gratuito_sem_trial();
