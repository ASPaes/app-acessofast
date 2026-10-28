-- AcessoFast, 28/10/2026: clique em Conectar que nao virou conexao sai da Auditoria.
--
-- O que acontecia: cada clique em Conectar grava uma ficha em connection_logs antes de a
-- conexao existir. Se a maquina nao manda sinal em 5 min, a close_stale_sessions marca a
-- ficha "falhou" e ela fica na Auditoria como se fosse uma sessao. Em 30 dias (ate
-- 28/10): 72 de 300 cliques, 67 sem conexao nenhuma na maquina depois, 50 em maquina sem
-- sessao nenhuma em 12h (desligada). A conexao real ja e reconhecida pelo sinal do agente
-- (session-ingest); o clique sem sinal e tentativa, nao sessao, e enchia o historico da
-- maquina e a contagem de falhas da empresa. A nota "cobranca estornada" ainda saia em
-- todas, cobradas ou nao.
--
-- Aqui: tabela propria para esses cliques, e a v_agent_health (Monitoramento) passa a
-- contar as falhas dela. O cron que move os cliques e a mudanca do passado ficam em
-- 20261028120100_cliques_sem_conexao_cron, que apaga fichas e vai colado no SQL Editor
-- (o conector do Supabase recusa DELETE).
--
-- O clique repetido do mesmo tecnico continua como em 20261027170000/170100: e absorvido
-- pela sessao real e nao chega aqui.

create table if not exists public.cliques_sem_conexao (
  -- O mesmo id da ficha em connection_logs (o grant_id da connect-device).
  id                uuid primary key,
  tenant_id         uuid not null references public.tenants (id) on delete cascade,
  address_book_id   uuid references public.address_book (id) on delete set null,
  rustdesk_id       text not null,
  technician_id     uuid references public.profiles (id) on delete set null,
  technician_email  text,
  technician_ip     inet,
  -- Hora do clique (do ultimo, quando o tecnico repetiu antes de a conexao chegar).
  clicado_em        timestamptz not null,
  atendimento_id    uuid references public.atendimentos (id) on delete set null,
  -- O clique tinha cobrado (gratuito do dia ou credito) e o cron devolveu.
  estornado         boolean not null default false
);

create index if not exists cliques_sem_conexao_tenant_idx
  on public.cliques_sem_conexao (tenant_id, clicado_em desc);
create index if not exists cliques_sem_conexao_maquina_idx
  on public.cliques_sem_conexao (rustdesk_id, clicado_em desc);

-- Mesma leitura que a ficha tinha em connection_logs (conn_logs_select). So o cron grava.
alter table public.cliques_sem_conexao enable row level security;
revoke all on public.cliques_sem_conexao from public, anon, authenticated;
grant select on public.cliques_sem_conexao to authenticated;
create policy cliques_sem_conexao_select on public.cliques_sem_conexao
  for select to authenticated
  using (
    private.is_super_admin()
    or (private.current_app_role() = 'admin'::public.user_role
        and tenant_id = private.current_tenant_id())
    or technician_id = (select auth.uid())
  );

-- Monitoramento: "Falhas" por maquina continua sendo o clique que nao virou conexao,
-- agora lido da tabela nova. Mesmas colunas, na mesma ordem (o replace exige). Enquanto
-- a parte 2 nao roda, as falhas antigas ainda estao em connection_logs e a tabela nova
-- esta vazia: nada conta duas vezes.
create or replace view public.v_agent_health
with (security_invoker = on) as
select
  tenant_id,
  rustdesk_id,
  address_book_id,
  count(*)                                   as tentativas_totais,
  count(*) filter (where status = 'ended')   as sessoes_reais,
  count(*) filter (where status = 'failed')  as falhas,
  count(*) filter (where status = 'active')  as abertas_agora,
  max(last_heartbeat_at)                     as ultimo_heartbeat,
  max(created_at)                            as ultima_atividade,
  coalesce(max(last_heartbeat_at) > now() - interval '24 hours', false) as agente_vivo_24h
from (
  select cl.tenant_id, cl.rustdesk_id, cl.address_book_id, cl.status,
         cl.last_heartbeat_at, cl.created_at
    from public.connection_logs cl
  union all
  select c.tenant_id, c.rustdesk_id, c.address_book_id, 'failed'::public.session_status,
         null::timestamptz, c.clicado_em
    from public.cliques_sem_conexao c
) s
group by tenant_id, rustdesk_id, address_book_id;
