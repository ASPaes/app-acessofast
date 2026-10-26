-- AcessoFast, 26/10/2026: o prazo das 7 contas que perderam a isencao em 23/10 cai de
-- 22/11 para 30/10. Pedido do Ryan: algumas ja querem fechar.
--
-- 30/10 (sexta) e o ULTIMO DIA para contratar: plan_expires_at = 31/10 00:00 de Brasilia,
-- e o cron acessofast_suspend_expired_plans (00:35 de Brasilia) bloqueia na madrugada de
-- sabado. A faixa do topo e o Financeiro leem a data daqui: passam a mostrar a contagem
-- nova e "bloqueado em 31/10/2026" sem codigo novo.
--
-- So mexe em quem segue no prazo antigo sem contratar. Quem pagou antes tem plan_expires_at
-- zerado (mensal) ou de 12 meses (anual) pelo apply_paid_plan, e o filtro pela data de
-- 22/11 deixa essas contas de fora.
--
-- ATENCAO: o suspend_expired_plans nao poupa pagamento pendente. Quem contratar por boleto
-- perto do prazo fica bloqueado de 31/10 ate a compensacao.
--
-- Aplicada em 26/10/2026 via apply_migration (prazo_isencao_30_10): as 7 conferidas com
-- bloqueio em 31/10, nenhuma ficou em 22/11, a ASP segue isenta.

update public.tenants
   set plan_expires_at       = timestamptz '2026-10-31 00:00:00-03',
       billing_exempt_reason = replace(billing_exempt_reason,
                                       'bloqueio em 22/11/2026',
                                       'bloqueio em 31/10/2026 (prazo encurtado em 26/10)'),
       updated_at            = now()
 where id in (
         '3d3dbb49-832f-4049-a596-e94bfc16f33c',  -- Feax Informatica
         '04809fda-72ee-4dd2-bbc2-c30a6d3fb8fc',  -- DigiOffice
         '40a6d915-0251-4889-a93b-cf7210ef4b4e',  -- Consysa Informatica
         '32650391-d9fa-4ecd-b06d-e7993b34200e',  -- Athuz
         '3ad34465-a4e2-4a74-bc27-5198cdc8412f',  -- CTM Comercio de Maquinas
         '12c440a7-5314-4e6c-887e-eaeba0a3632c',  -- Delvale Tecnologia
         '966fbbdf-1468-40eb-aaff-e35b23494dc6'   -- Hiper Software
       )
   and plan_expires_at = timestamptz '2026-11-22 00:00:00-03'
   and not billing_exempt
   and asaas_customer_id is null;

-- Conferencia: as 7 com bloqueio em 31/10; a ASP segue isenta.
select name, billing_exempt, plan_expires_at at time zone 'America/Sao_Paulo' as bloqueio_brasilia,
       billing_status
  from public.tenants
 order by billing_exempt desc, name;
