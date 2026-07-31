-- Billing B3 — seed do catálogo de pacotes de crédito.
-- VALORES PLACEHOLDER (definidos 2026-07-27, a ajustar antes de vender): curva de
-- desconto por volume ~R$2,00/cr -> R$1,20/cr. Ajustar em painel/SQL depois.
-- Idempotente e NÃO-destrutivo: `on conflict do nothing` NÃO sobrescreve preços
-- já editados manualmente; para reprecificar, faça UPDATE explícito.

insert into public.credit_packages (code, credits, price_cents, is_active, sort_order) values
  ('cr20',   20,    4000, true, 1),   -- R$ 40,00  (R$2,00/cr)
  ('cr50',   50,    9000, true, 2),   -- R$ 90,00  (R$1,80/cr)
  ('cr200',  200,  30000, true, 3),   -- R$ 300,00 (R$1,50/cr)
  ('cr1000', 1000, 120000, true, 4)   -- R$ 1.200,00 (R$1,20/cr)
on conflict (code) do nothing;
