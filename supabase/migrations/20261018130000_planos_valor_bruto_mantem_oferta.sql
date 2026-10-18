-- Correcao da decisao de 18/10/2026 sobre preco (substitui a escolha da
-- 20261018120000). La os valores de tabela foram gravados como LIQUIDO (ja com o
-- desconto embutido) e a oferta de lancamento foi desligada, para a vitrine nao
-- mostrar "139,90 riscado por 97,93".
--
-- Decisao nova do dono: a oferta de lancamento CONTINUA ligada. O numero que o
-- comercial fechou (139,90 / 209,30 / 377,30 ...) e o LIQUIDO que a pessoa paga
-- durante a oferta. Para a vitrine mostrar "DE <bruto> POR <liquido>" e o checkout
-- cobrar o liquido, o que vai em public.plans e o BRUTO (preco de tabela cheio);
-- o site e a create-checkout-prod aplicam os 30% por cima e chegam no liquido.
--
--   bruto = round(liquido / 0,70)   (0,70 = 1 - 30%)
--
--              liquido (paga)   bruto (tabela, vai em plans)
--   Team mes      R$ 139,90        R$ 199,86   (19986; round(19986*0,7)=13990)
--   Business mes  R$ 209,30        R$ 299,00   (29900; round(29900*0,7)=20930)
--   Scale mes     R$ 377,30        R$ 539,00   (53900; round(53900*0,7)=37730)
--   Team ano      R$ 1.343,04      R$ 1.918,63 (191863; ->134304)
--   Business ano  R$ 2.091,60      R$ 2.988,00 (298800; ->209160)
--   Scale ano     R$ 3.771,60      R$ 5.388,00 (538800; ->377160)
--
-- Depois que a oferta esgotar/expirar, a assinatura volta para o bruto — que e a
-- promessa do site ("preco de lancamento por 12 meses"). Limites nao mudam (ja
-- estao em 5/3, 10/5, 20/10 pela 20261018120000). Nenhuma empresa tem assinatura
-- no Asaas ainda, entao nada retroativo a migrar.

update public.plans set price_month_cents = 19986, price_year_cents = 191863 where code = 'team';
update public.plans set price_month_cents = 29900, price_year_cents = 298800 where code = 'business';
update public.plans set price_month_cents = 53900, price_year_cents = 538800 where code = 'scale';

-- Religa a oferta (a 20261018120000 a tinha desligado). launch_offer_status ja
-- combina is_active com "ainda ha vaga", entao e so o flag aqui.
update public.launch_offer set is_active = true where id;
