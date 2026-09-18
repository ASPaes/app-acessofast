-- AcessoFast, 18/09/2026: o status de presença passa a ser decidido no BANCO.
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- O status "Online / Offline" já quebrou várias vezes, sempre do mesmo jeito: a
-- regra vivia espalhada, e cada mudança acertava uma cópia e deixava as outras
-- para trás. O histórico, medido:
--
--   28/08  a janela passou de 2 para 7 min no painel porque o agente ia afrouxar
--          o `presence` de 60s para 180s. Duas mudanças, dois repositórios, e a
--          ordem entre elas importava — se invertesse, a frota inteira aparecia
--          morta.
--   06/09  o `session-ingest` passou a DESCARTAR o `presence` de parte da frota
--          para poupar escrita. A partir daí `last_online` deixou de significar
--          "visto agora" para essas máquinas — e nenhuma tela ficou sabendo.
--   16/09  a lista dizia "Offline · há 10 min" para máquina ligada com o técnico
--          conectado nela. A tela decidia "silenciada" por `agent_version is
--          null`, um PROXY do `ignorar_presenca`, e o proxy falhava justamente
--          nas máquinas marcadas no cadastro que reportam versão.
--          No mesmo dia: a lista usava janela de 7 min e o dashboard, 5. A visão
--          em cartões nunca teve o ramo "Sem status" e dizia "Offline" para tudo.
--
-- O padrão é sempre o mesmo, e não é falta de cuidado: a regra era DERIVADA em
-- TypeScript, longe dos dados, e nada obrigava as cópias a concordarem. Enquanto
-- existir mais de um lugar que responde "esta máquina está online?", elas voltam
-- a divergir na próxima otimização.
--
-- O QUE MUDA
--
-- Passa a existir UMA resposta, aqui, ao lado dos dados que a produzem:
-- `public.v_dispositivo_status.status_presenca`. O painel lê a coluna e desenha.
-- Ele não tem como inventar outra regra, e telas novas nascem certas.
--
-- Isto é aditivo: nada existente é alterado ou removido, e o painel antigo
-- continua funcionando enquanto não passar a ler a view.

-- ---------------------------------------------------------------------------
-- 1) As janelas, num lugar só.
--
-- Eram quatro números mágicos espalhados: 7 min na lista, 5 min no dashboard,
-- 90s para o heartbeat de sessão, e a cadência do `presence` do agente, que
-- dimensiona todos eles e vive no outro repositório. Tabela e não constante
-- porque a cadência do agente muda sem deploy do painel — e porque a sonda de
-- saúde (item 4) precisa comparar a janela configurada com a MEDIDA.
-- ---------------------------------------------------------------------------
create table if not exists private.presenca_config (
  id                boolean primary key default true check (id),
  -- Sem sinal por este tempo, a máquina deixa de contar como "online".
  -- Dimensionada pela cadência do `presence`: precisa caber dois batimentos
  -- perdidos mais atraso de rede.
  janela_online     interval not null default '7 minutes',
  -- Sessão viva: `connection_logs.status='active'` com heartbeat recente. O
  -- agente bate de 20 em 20s durante a sessão.
  janela_heartbeat  interval not null default '90 seconds',
  -- Cadência ESPERADA do `presence` do agente. Não decide nada sozinha: serve
  -- para a sonda acusar quando a janela ficou menor que a realidade.
  cadencia_presence interval not null default '3 minutes',
  atualizado_em     timestamptz not null default now()
);

insert into private.presenca_config (id) values (true)
on conflict (id) do nothing;

comment on table private.presenca_config is
  'Janelas da presença. Mexer AQUI, nunca numa tela: a view e a sonda leem daqui.';

-- Convenção do projeto: TODA tabela em `private` tem RLS ligada e ZERO policies
-- — só o dono e as funções `security definer` entram. Ligada aqui de propósito,
-- e não deixada para o botão do SQL Editor, porque a escolha tem consequência
-- (ver a função de acesso logo abaixo).
alter table private.presenca_config enable row level security;

-- A PORTA da config para quem não é dono.
--
-- A view abaixo é `security_invoker`, então ela lê a config com os direitos de
-- quem consultou — e `authenticated` não entra em `private`. Se a view fizesse
-- `cross join` direto na tabela, o join traria ZERO linhas e a view inteira
-- voltaria vazia: o painel mostraria "nenhum dispositivo", sem erro nenhum.
-- Medido: cross join direto devolve 0 linhas para `authenticated`, via esta
-- função devolve 1.
--
-- Por isso a config sai por uma função `security definer` em `public`: a tabela
-- continua selada (sem grant, sem policy) e existe uma única entrada conhecida.
create or replace function public.presenca_janelas()
returns table (janela_online interval, janela_heartbeat interval, cadencia_presence interval)
language sql
stable
security definer
set search_path = ''
as $$
  select janela_online, janela_heartbeat, cadencia_presence
    from private.presenca_config
   where id;
$$;

revoke all on function public.presenca_janelas() from public, anon;
grant execute on function public.presenca_janelas() to authenticated;

-- ---------------------------------------------------------------------------
-- 2) A view que o painel lê.
--
-- `security_invoker = true` é obrigatório: sem isso a view roda com os direitos
-- do dono e ENTREGA A FROTA INTEIRA para qualquer autenticado, furando o
-- isolamento por empresa. Com ele, as policies do address_book continuam
-- valendo (verificado: `set role authenticated` sem JWT devolve 0 linhas).
--
-- Colunas explícitas, nunca `ab.*`: `agent_token_hash` mora nessa tabela e não
-- pode atravessar para uma view que o painel consulta.
--
-- Os nomes de cliente e empresa vêm resolvidos como COLUNA, e não por embedding
-- do PostgREST (`clients(name,...)`). Embedding sobre view depende de o
-- PostgREST inferir a FK através da view — funciona na maioria dos casos, mas é
-- uma dependência de comportamento que não dá para testar antes de a view
-- existir. Resolvendo aqui, o painel migra sem esse risco.
-- ---------------------------------------------------------------------------
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
    -- Ordem de precedência — é o que costuma quebrar quando alguém reescreve:
    --
    -- 1. Inativo é cadastro, não presença.
    when ab.is_active is false then 'inativo'
    -- 2. Sessão aberta ganha de tudo. É prova DIRETA de máquina viva, e os
    --    eventos de sessão (start/heartbeat/end) nunca são descartados pelo
    --    session-ingest — valem inclusive para máquina silenciada.
    when exists (
      select 1
        from public.connection_logs cl
       where cl.address_book_id = ab.id
         and cl.status = 'active'
         and cl.last_heartbeat_at > now() - cfg.janela_heartbeat
    ) then 'atendimento'
    -- 3. O servidor descarta o `presence` desta máquina, por um dos DOIS
    --    caminhos do session-ingest: a marca no cadastro (guarda depois da
    --    autenticação) ou a ausência de versão (descarte antecipado, binário
    --    anterior a 10/08/2026). Nos dois casos `last_online` só anda durante
    --    sessão e congela quando ela fecha: chamar isso de "Offline" é afirmar
    --    o que não se sabe e mandar o técnico procurar defeito onde não há.
    --
    --    Vem ANTES de "online" de propósito: logo depois de um atendimento o
    --    carimbo está fresco, mas é resto da sessão que fechou, não prova de
    --    máquina ociosa e viva. Deixar "online" na frente faria a máquina
    --    piscar Online por alguns minutos após cada acesso e só então sumir.
    when ab.ignorar_presenca or ab.agent_version is null then 'sem_status'
    when ab.last_online > now() - cfg.janela_online then 'online'
    else 'offline'
  end as status_presenca
from public.address_book ab
-- Pela FUNÇÃO, nunca pela tabela: ver presenca_janelas() acima.
cross join public.presenca_janelas() cfg
left join public.clients c on c.id = ab.client_id
left join public.tenants t on t.id = ab.tenant_id;

comment on view public.v_dispositivo_status is
  'Fonte ÚNICA do status de presença. Nenhuma tela recalcula isto: quem precisa '
  'de online/offline lê status_presenca daqui. Ver migration 20260918120000.';

grant select on public.v_dispositivo_status to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Diagnóstico sob demanda: a tela está mentindo agora?
--
-- Devolve as incoerências que já causaram problema. Vazio = coerente.
-- ---------------------------------------------------------------------------
create or replace function public.presenca_diagnostico()
returns table (problema text, quantidade bigint, detalhe text)
language sql
stable
security definer
set search_path = ''
as $$
  -- O bug de 16/09: marcada no cadastro E reportando versão. O cron das 03:50
  -- solta essas máquinas, então aparecer aqui significa que alguém marcou hoje.
  select 'silenciada_mas_reporta_versao'::text,
         count(*),
         'presence descartado numa maquina que se atualiza e responde; o cron acessofast_reavaliar_presenca solta as 03:50 UTC'::text
    from public.address_book
   where ignorar_presenca and agent_version is not null
     and is_active is distinct from false
  having count(*) > 0

  union all

  -- A janela ficou menor que a realidade: é o que aconteceria se o agente
  -- afrouxasse o `presence` de novo sem alguém mexer aqui.
  select 'janela_menor_que_a_cadencia'::text,
         count(*),
         'janela_online precisa ser maior que cadencia_presence, senao a maquina pisca offline entre dois batimentos'::text
    from private.presenca_config
   where janela_online <= cadencia_presence * 2
  having count(*) > 0

  union all

  -- Sessão marcada como viva numa máquina que o painel considera desligada.
  -- É a assinatura da sessão fantasma.
  select 'sessao_ativa_em_maquina_sem_sinal'::text,
         count(*),
         'connection_logs active com heartbeat velho: sessao que nunca foi encerrada'::text
    from public.connection_logs cl
   where cl.status = 'active'
     and (cl.last_heartbeat_at is null or cl.last_heartbeat_at < now() - interval '30 minutes')
  having count(*) > 0;
$$;

-- Sem grant para `authenticated` de propósito: sendo `security definer`, esta
-- função conta a frota INTEIRA, atravessando o isolamento por empresa. São só
-- contagens de incoerência, mas um admin de uma empresa não tem por que ver o
-- tamanho do problema nas outras. Fica como ferramenta de SQL Editor. Quando
-- alguma tela precisar, entra a checagem de papel do chamador junto com o grant.
revoke all on function public.presenca_diagnostico() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) Sonda: mede a cadência REAL e guarda a série.
--
-- É esta parte que faz a correção durar. A janela do item 1 é um palpite sobre
-- o comportamento do agente, que mora em outro repositório e já mudou uma vez
-- (60s -> 180s) sem que o painel soubesse. A sonda mede a idade p95 do sinal
-- entre as máquinas demonstravelmente vivas: se essa idade se aproximar da
-- janela, a janela ficou apertada e a frota vai começar a piscar — e dá para
-- ver isso ANTES do cliente reclamar.
--
-- Custo: UMA linha a cada 5 min (288/dia). Comparar com os ~85 mil updates/dia
-- que o descarte do presence eliminou — é ruído, não volume.
-- ---------------------------------------------------------------------------
create table if not exists private.presenca_saude (
  colhido_em      timestamptz primary key default now(),
  online          integer not null,
  offline         integer not null,
  sem_status      integer not null,
  atendimento     integer not null,
  -- Idade do sinal, em segundos, entre as máquinas vivas. É a cadência real do
  -- `presence` vista pelo servidor: p50 ~ a cadência, p95 ~ o pior caso.
  idade_p50_seg   integer,
  idade_p95_seg   integer,
  janela_seg      integer not null
);

comment on table private.presenca_saude is
  'Serie da saude da presenca, 1 linha/5min. idade_p95_seg encostando em '
  'janela_seg = a janela ficou menor que a cadencia real do agente.';

-- Mesma convenção: RLS ligada, zero policies. Aqui não há a armadilha da config
-- — quem escreve e lê é o cron, como dono, e dono não é barrado por RLS.
alter table private.presenca_saude enable row level security;

create or replace function private.presenca_amostrar()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.presenca_saude
    (online, offline, sem_status, atendimento, idade_p50_seg, idade_p95_seg, janela_seg)
  select
    count(*) filter (where v.status_presenca = 'online')::int,
    count(*) filter (where v.status_presenca = 'offline')::int,
    count(*) filter (where v.status_presenca = 'sem_status')::int,
    count(*) filter (where v.status_presenca = 'atendimento')::int,
    -- p50/p95 só entre as que estão falando: incluir máquina desligada mediria
    -- "há quanto tempo o cliente foi embora", não a cadência do agente.
    percentile_disc(0.50) within group (
      order by extract(epoch from (now() - v.last_online))
    ) filter (where v.status_presenca = 'online')::int,
    percentile_disc(0.95) within group (
      order by extract(epoch from (now() - v.last_online))
    ) filter (where v.status_presenca = 'online')::int,
    (select extract(epoch from janela_online)::int from private.presenca_config)
  from public.v_dispositivo_status v
  on conflict (colhido_em) do nothing;
$$;

revoke all on function private.presenca_amostrar() from public, anon, authenticated;

-- A sonda roda como postgres pelo cron, e a view é security_invoker — como
-- postgres ela enxerga a frota inteira, que é o que a métrica precisa.
select cron.schedule('acessofast_presenca_amostra', '*/5 * * * *',
                     'select private.presenca_amostrar();');

-- Purga junto com as outras, às 3:47 (entre rate_limit 3:40 e cron_history 3:45
-- não cabe; 3:47 fica livre). 30 dias é o bastante para ver uma tendência.
create or replace function private.purge_presenca_saude()
returns integer
language sql
security definer
set search_path = ''
as $$
  with apagadas as (
    delete from private.presenca_saude
     where colhido_em < now() - interval '30 days'
    returning 1
  )
  select count(*)::integer from apagadas;
$$;

revoke all on function private.purge_presenca_saude() from public, anon, authenticated;

select cron.schedule('acessofast_purge_presenca_saude', '47 3 * * *',
                     'select private.purge_presenca_saude();');
