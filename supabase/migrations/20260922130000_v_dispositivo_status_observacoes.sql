-- AcessoFast, 22/09/2026: a view do status passa a expor `observacoes`.
--
-- A 20260922120000 criou address_book.observacoes; a lista de Dispositivos, desde
-- a 20260918120000, não lê mais a TABELA e sim a view v_dispositivo_status. A view
-- lista coluna por coluna — então coluna nova que o painel precise LER tem de
-- entrar aqui também, senão o select da tela responde "column does not exist".
-- (A ESCRITA continua indo direto no address_book: a view é só de leitura.)
--
-- `create or replace` em vez de `drop`/`create`: replace preserva grants e as
-- dependências (v_dispositivo_status_resumo lê desta view), mas em troca exige
-- que as colunas existentes venham na MESMA ordem — coluna nova só entra no fim.
-- Por isso `observacoes` aparece depois de `status_presenca`, e não ao lado de
-- `privado`, onde a leitura pediria. Trocar a ordem custaria um drop cascade.
--
-- O corpo abaixo é cópia do da 20260918120000, com UMA linha acrescentada. Os
-- comentários da regra de precedência ficaram lá: são daquela decisão, não desta.

create or replace view public.v_dispositivo_status
with (security_invoker = true) as
select
  ab.id,
  ab.tenant_id,
  ab.rustdesk_id,
  ab.alias,
  ab.device_group,
  ab.os,
  ab.last_online,
  ab.agent_version,
  ab.agent_target_version,
  ab.created_at,
  ab.updated_at,
  ab.is_active,
  ab.ignorar_presenca,
  ab.privado,
  ab.client_id,
  ab.enrollment_status,
  ab.rotacao_modo,
  ab.rotacao_modo_efetivo,
  c.name          as cliente_nome,
  c.document      as cliente_documento,
  c.document_type as cliente_documento_tipo,
  c.phone         as cliente_telefone,
  t.name          as empresa_nome,
  case
    when ab.is_active is false then 'inativo'
    when exists (
      select 1
        from public.connection_logs cl
       where cl.address_book_id = ab.id
         and cl.status = 'active'
         and cl.last_heartbeat_at > now() - cfg.janela_heartbeat
    ) then 'atendimento'
    when ab.ignorar_presenca or ab.agent_version is null then 'sem_status'
    when ab.last_online > now() - cfg.janela_online then 'online'
    else 'offline'
  end as status_presenca,
  ab.observacoes
from public.address_book ab
cross join public.presenca_janelas() cfg
left join public.clients c on c.id = ab.client_id
left join public.tenants t on t.id = ab.tenant_id;

comment on view public.v_dispositivo_status is
  'Fonte ÚNICA do status de presença. Nenhuma tela recalcula isto: quem precisa '
  'de online/offline lê status_presenca daqui. Ver migration 20260918120000.';
