-- 1. Alinha o constraint de environment com asaas_events: aceita 'production' (nao 'prod').
--    Causa raiz do HTTP 500 nas funcoes -prod: elas gravam 'production', mas o constraint
--    antigo so aceitava 'sandbox'/'prod'. Intents existentes sao todos 'sandbox' (seguros).
alter table public.signup_intents drop constraint signup_intents_environment_check;
alter table public.signup_intents add constraint signup_intents_environment_check
  check (environment in ('sandbox', 'production'));

-- 2. Limpa SO as 2 travas orfas (tenant_id null) das ultimas 2h — os CNPJs dos testes que
--    falharam com o 500. NAO toca em documentos com tenant (KAEFER/teste/TESTE INDIVIDUAL)
--    nem em contas billing_exempt (ASP/Feax/DigiOffice nunca entram nesta tabela).
delete from private.trial_documents
where tenant_id is null and created_at > now() - interval '2 hours';
