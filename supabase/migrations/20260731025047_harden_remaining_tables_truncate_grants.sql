-- Estende as 10 tabelas que ficaram de fora da 20260714002937.
--
-- Aquela migration ja tinha estabelecido o padrao ("MEDIO: remove privilegios que
-- o PostgREST nao usa — defesa em profundidade") e revogou truncate/references/
-- trigger de address_book, leads, tenant_features e tenant_settings. As demais
-- nasceram depois e nunca foram alcancadas.
--
-- POR QUE IMPORTA: TRUNCATE nao passa por RLS. A politica que separa um tenant do
-- outro protege SELECT/INSERT/UPDATE/DELETE, mas nao esse comando — quem tiver o
-- privilegio limpa a tabela inteira, de todos os tenants, de uma vez. Nao ha rota
-- pelo PostgREST que emita TRUNCATE, entao isto e a segunda tranca de uma porta
-- ja trancada; e exatamente por isso que e barato fechar.
--
-- REFERENCES e TRIGGER acompanham pelo mesmo motivo da migration original:
-- authenticated nunca cria FK nem trigger, entao o privilegio so aumenta a
-- superficie sem servir a nada.

revoke truncate, references, trigger on
  public.asaas_events,
  public.clients,
  public.connection_logs,
  public.device_marker_assignments,
  public.device_markers,
  public.features,
  public.plans,
  public.profiles,
  public.signup_intents,
  public.tenants
  from authenticated;
