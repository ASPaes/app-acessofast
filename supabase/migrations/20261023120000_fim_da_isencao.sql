-- AcessoFast, 23/10/2026: o AcessoFast passa a ser pago. As contas que usavam sem
-- cobranca (parceiros em teste e early testers) perdem a isencao e ganham 30 dias
-- para contratar um plano.
--
-- O BLOQUEIO NAO E CODIGO NOVO: plan_expires_at = 22/11/2026 00:00 de Brasilia. O cron
-- acessofast_suspend_expired_plans (03:35 UTC = 00:35 de Brasilia) suspende quem passou
-- do prazo e nao e isento. Conta suspensa: connect-device recusa (billing_blocked) e o
-- acesso direto e cortado pelo agente (meter_external_session).
--
-- QUEM CONTRATA ANTES NAO E BLOQUEADO: apply_paid_plan zera plan_expires_at no mensal e
-- da 12 meses no anual. Por isso billing_exempt vai a false ja: a create-renewal-prod
-- recusa conta isenta (tenant_exempt), entao com a isencao ligada ninguem conseguiria
-- contratar dentro do prazo.
--
-- O AVISO: a faixa do topo (billing-banner, estado "contratar") conta os dias ate
-- plan_expires_at para conta com data de fim, fora do teste e sem cliente no Asaas.
--
-- FICA DE FORA: ASP SOFTWARES (ebd17e4e-...), o tenant interno.
--
-- Lista fechada de proposito: rodar de novo depois nao pega conta isentada mais tarde.

update public.tenants
   set billing_exempt        = false,
       billing_exempt_until  = null,
       billing_exempt_reason = 'Isencao encerrada em 23/10/2026; bloqueio em 22/11/2026 sem contratacao. Antes: '
                               || coalesce(billing_exempt_reason, '-'),
       plan_expires_at       = timestamptz '2026-11-22 00:00:00-03',
       is_trial              = false
 where id in (
         '3d3dbb49-832f-4049-a596-e94bfc16f33c',  -- Feax Informatica
         '04809fda-72ee-4dd2-bbc2-c30a6d3fb8fc',  -- DigiOffice
         '40a6d915-0251-4889-a93b-cf7210ef4b4e',  -- Consysa Informatica
         '32650391-d9fa-4ecd-b06d-e7993b34200e',  -- Athuz
         '3ad34465-a4e2-4a74-bc27-5198cdc8412f',  -- CTM Comercio de Maquinas
         '12c440a7-5314-4e6c-887e-eaeba0a3632c',  -- Delvale Tecnologia
         '966fbbdf-1468-40eb-aaff-e35b23494dc6'   -- Hiper Software
       )
   and billing_exempt
   and asaas_customer_id is null;

-- Conferencia: as 7 com billing_exempt = false e bloqueio em 22/11; a ASP segue isenta.
select name, billing_exempt, plan_expires_at at time zone 'America/Sao_Paulo' as bloqueio_brasilia,
       billing_status
  from public.tenants
 order by billing_exempt desc, name;
