-- Novos valores e limites dos planos (tabela comercial de 18/10/2026).
--
--              usuarios  acessos simult.  mensal      anual (total)  anual (por mes)
--   Team          5           3           R$ 139,90   R$ 1.343,04    R$ 111,92
--   Business     10           5           R$ 209,30   R$ 2.091,60    R$ 174,30
--   Scale        20          10           R$ 377,30   R$ 3.771,60    R$ 314,30
--   Enterprise  21+       sob consulta    sob consulta
--
-- "Acessos" = sessoes simultaneas POR TECNICO (max_concurrent_per_tech). A contagem por
-- tecnico entra na migration seguinte (20261018120100_simultaneo_por_tecnico).
--
-- Precos: o painel, o site e os checkouts do Asaas (create-checkout-prod,
-- create-renewal-prod) leem public.plans na hora de cobrar, entao este update e o
-- que muda o valor cobrado. price_year_cents e o TOTAL do ano (cobrado a vista,
-- parcelavel em ate 3x no cartao). Nenhuma empresa tem assinatura no Asaas ainda
-- (asaas_subscription_id vazio), entao nao ha cobranca recorrente antiga a migrar.
--
-- Decisao do dono (18/10/2026): os novos limites valem TAMBEM para quem ja esta
-- em Team/Business/Scale, inclusive quem tinha numero ajustado a mao em Empresas.
-- Empresa que ficar com mais usuarios ativos que o novo teto nao perde ninguem: o
-- gatilho enforce_seat_limit so impede adicionar.

update public.plans set
  price_month_cents = 13990, price_year_cents = 134304,
  max_users = 5,  max_concurrent_per_tech = 3
where code = 'team';

update public.plans set
  price_month_cents = 20930, price_year_cents = 209160,
  max_users = 10, max_concurrent_per_tech = 5
where code = 'business';

-- Scale deixa de ser ilimitado em simultaneos.
update public.plans set
  price_month_cents = 37730, price_year_cents = 377160,
  max_users = 20, max_concurrent_per_tech = 10
where code = 'scale';

-- Enterprise segue sob medida (null = combinado com o cliente).

-- Valores efetivos das empresas ja nesses planos (mesma copia que assign_plan faz).
update public.tenants t
   set seat_limit = p.max_users,
       max_concurrent_per_tech = p.max_concurrent_per_tech,
       updated_at = now()
  from public.plans p
 where p.code = t.plan_code
   and t.plan_code in ('team', 'business', 'scale');

-- Os valores acima JA SAO o preco final (liquido), com os descontos embutidos.
-- Decisao do dono (18/10/2026): nenhum desconto automatico por cima deles. A oferta de
-- lancamento (30% por 12 meses, aplicada pelo site e pela create-checkout-prod via
-- launch_offer_status) e desligada aqui, junto com a troca de preco — senao a vitrine
-- mostraria R$ 139,90 riscado por R$ 97,93 e o Asaas cobraria o menor.
-- Quem ja contratou com o desconto de lancamento mantem o que foi combinado (as janelas
-- de desconto ja criadas nao sao tocadas). Cupom manual do comercial continua valendo.
update public.launch_offer set is_active = false;
