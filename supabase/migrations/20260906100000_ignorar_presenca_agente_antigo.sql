-- AcessoFast, 06/09/2026: parar de GRAVAR o que o agente antigo manda.
--
-- O QUE ESTAVA ACONTECENDO, medido:
--   public.address_book         2.977.214 updates  (numa tabela de 177 linhas)
--   private.rate_limit_counters 2.677.760 updates + 794.977 inserts
--   public.connection_logs        101.016 updates
--
-- Cada `presence` faz um UPDATE em address_book para carimbar last_online. No
-- Postgres todo UPDATE escreve uma versao nova da linha e deixa a anterior morta,
-- que o autovacuum precisa recolher depois. A tabela parece pequena porque o
-- autovacuum da conta — o custo nao esta no tamanho final, esta no volume de
-- escrita: WAL, inchaco de indice e autovacuum permanente.
--
-- ~80 maquinas rodam binario anterior a 10/08/2026, quando o reporte de versao
-- entrou. Elas batem a cada 60s (o dobro da cadencia atual), nao se atualizam
-- sozinhas e NAO HA COMO alcanca-las: sao maquinas de parceiro, sem acesso
-- fisico nem remoto para reinstalar. O servidor ate oferece a atualizacao
-- (confirmado: o `os` delas resolve como 'windows' e o manifesto sai), mas a
-- versao instalada nao tem o codigo que le esse campo.
--
-- A invocacao em si nao da para evitar — foi testado: chamada a rota inexistente
-- conta igual. O que da para evitar e o TRABALHO: a chamada chega e morre na
-- porta, sem escrever nada.
--
-- O QUE SE PERDE, declarado: essas maquinas param de ter status no painel. Ficam
-- marcadas como "agente desatualizado", nao como offline — a diferenca importa,
-- porque elas continuam acessiveis normalmente pelo RustDesk (o relay e outro
-- caminho e nao passa por aqui). Perde-se a visao de status, nao o acesso.

alter table public.address_book
  add column if not exists ignorar_presenca boolean not null default false;

comment on column public.address_book.ignorar_presenca is
  'Quando true, o session-ingest descarta o presence desta maquina sem gravar nada. '
  'Usado para binario antigo que nao se atualiza e nao pode ser alcancado: a chamada '
  'ainda chega (nao ha como evitar), mas para de custar escrita no banco. O painel '
  'mostra "agente desatualizado" em vez de online/offline.';

-- Marca as que ja estao nesse estado: sem agent_version = binario anterior a
-- 10/08/2026. A checagem e por coluna e nao por regra automatica no codigo de
-- proposito — assim da para religar uma maquina especifica sem novo deploy, e
-- uma que volte a reportar versao (foi reinstalada) sai daqui pelo cron abaixo.
update public.address_book
   set ignorar_presenca = true
 where agent_version is null
   and is_active is distinct from false;

-- Rede de seguranca: se a maquina voltar a reportar versao, ela foi reinstalada
-- ou atualizada — e volta a ter status. Sem isto, uma maquina consertada ficaria
-- silenciada para sempre por uma decisao tomada hoje.
create or replace function private.reavaliar_ignorar_presenca()
returns integer
language sql
security definer
set search_path = ''
as $$
  with religadas as (
    update public.address_book
       set ignorar_presenca = false
     where ignorar_presenca = true
       and agent_version is not null
    returning 1
  )
  select count(*)::integer from religadas;
$$;

revoke all on function private.reavaliar_ignorar_presenca() from public, anon, authenticated;

select cron.schedule('acessofast_reavaliar_presenca', '50 3 * * *',
                     'select private.reavaliar_ignorar_presenca();');
