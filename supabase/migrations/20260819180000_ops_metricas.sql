-- ---------------------------------------------------------------------------
-- Metricas de operacao — a visao que a EMPRESA tem do proprio atendimento.
--
-- Ate aqui o painel respondia "quantas sessoes" e "quem conectou" (Dashboard e
-- Auditoria), mas nao respondia "quanto tempo", "quantas maquinas distintas",
-- "quanto do plano eu uso no pico" nem "esse computador volta sempre". Sao
-- perguntas de gestao, e todas ja tem resposta nos dados que existem.
--
-- ESCOPO E PERMISSAO — o desenho que se repete nas quatro funcoes:
--   p_tenant nulo   + super_admin -> plataforma inteira
--   p_tenant nulo   + admin/tech  -> a propria empresa
--   p_tenant dado   + super_admin -> aquela empresa
--   p_tenant dado   + outra pessoa-> zero linhas se nao for a dela
-- A checagem NAO fica na tela. Uma tela que escolhe o tenant e um seletor que,
-- adulterado no navegador, viraria leitura de dado de outra empresa.
--
-- Fuso: tudo em America/Sao_Paulo, igual ao metering (ver billing_eligibility).
-- "Fora do horario" e "fim de semana" leem errado em UTC — as 21h de Brasilia
-- ja sao o dia seguinte la.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Resumo do periodo
-- ---------------------------------------------------------------------------
create or replace function public.ops_resumo(p_tenant uuid default null, p_dias int default 30)
returns table (
  acessos                bigint,
  em_andamento           bigint,
  horas                  numeric,
  duracao_media_s        numeric,
  duracao_mediana_s      numeric,
  duracao_p90_s          numeric,
  tecnicos               bigint,
  dispositivos_acessados bigint,
  dispositivos_novos     bigint,
  dispositivos_ativos    bigint,
  clientes_atendidos     bigint,
  fora_horario           bigint,
  pico_simultaneo        bigint,
  limite_plano           int,
  reacessos_24h          bigint,
  acessos_anterior       bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with escopo as (
    select
      case when private.is_super_admin() then p_tenant else private.current_tenant_id() end as tid,
      (private.is_super_admin() and p_tenant is null) as todos,
      (private.is_super_admin() or p_tenant is null or p_tenant = private.current_tenant_id()) as ok
  ),
  janela as (
    select (now() at time zone 'America/Sao_Paulo')::date - (greatest(p_dias, 1) - 1) as ini_d,
           greatest(p_dias, 1) as n
  ),
  lim as (
    select date_trunc('day', j.ini_d::timestamp) at time zone 'America/Sao_Paulo' as ini,
           (date_trunc('day', j.ini_d::timestamp) at time zone 'America/Sao_Paulo')
             - (j.n || ' days')::interval                                          as ini_ant
      from janela j
  ),
  base as (
    select cl.*
      from public.connection_logs cl
     cross join escopo e
     where e.ok
       and (e.todos or cl.tenant_id = e.tid)
  ),
  periodo as (
    select b.* from base b cross join lim l where b.session_start >= l.ini
  ),
  anterior as (
    select b.* from base b cross join lim l
     where b.session_start >= l.ini_ant and b.session_start < l.ini
  ),
  -- Pico de simultaneidade por varredura de eventos: +1 ao abrir, -1 ao fechar,
  -- e o maior acumulado e o pico. Empate de instante ordena a ABERTURA primeiro
  -- (d desc), senao uma sessao que fecha no exato momento em que outra abre
  -- esconderia o pico real de 1.
  eventos as (
    select p.session_start as t, 1 as d from periodo p
    union all
    select coalesce(p.session_end, now()) as t, -1 as d from periodo p
  ),
  pico as (
    select coalesce(max(soma), 0) as v
      from (select sum(d) over (order by t, d desc) as soma from eventos) x
  ),
  -- Reacesso: sessao que comeca ate 24h depois da anterior NA MESMA MAQUINA.
  -- Nao e "problema nao resolvido" — e o sinal mais proximo disso que os dados
  -- sustentam, e o nome na tela diz exatamente isso.
  reacesso as (
    select count(*) as v from (
      select p.session_start,
             lag(p.session_start) over (partition by p.rustdesk_id order by p.session_start) as ant
        from periodo p
    ) x
     where x.ant is not null and x.session_start - x.ant <= interval '24 hours'
  ),
  -- Dispositivo NOVO = a primeira sessao dele em toda a historia caiu na janela.
  novos as (
    select count(*) as v from (
      select b.address_book_id, min(b.session_start) as primeira
        from base b
       where b.address_book_id is not null
       group by b.address_book_id
    ) x cross join lim l
     where x.primeira >= l.ini
  ),
  ativos as (
    select count(*) as v
      from public.address_book ab cross join escopo e
     where e.ok and (e.todos or ab.tenant_id = e.tid)
       and ab.is_active
       and ab.last_online > now() - interval '5 minutes'
  ),
  -- So faz sentido com UMA empresa em foco: o limite e por contrato, e um
  -- "minimo entre todos os planos" nao seria comparavel com nada. No escopo
  -- plataforma sai null, e a tela esconde a comparacao.
  plano as (
    select min(coalesce(t.max_concurrent_per_tech, pl.max_concurrent_per_tech)) as v
      from public.tenants t
      left join public.plans pl on pl.code = t.plan_code
     cross join escopo e
     where e.ok and not e.todos and t.id = e.tid
  )
  select
    count(*),
    count(*) filter (where p.status = 'active'),
    round(coalesce(sum(p.duration_seconds), 0) / 3600.0, 1),
    round(avg(p.duration_seconds)::numeric, 0),
    round(percentile_cont(0.5) within group (order by p.duration_seconds)::numeric, 0),
    round(percentile_cont(0.9) within group (order by p.duration_seconds)::numeric, 0),
    count(distinct p.technician_id),
    count(distinct p.address_book_id),
    (select v from novos),
    (select v from ativos),
    count(distinct ab.client_id),
    -- Fora do horario comercial: antes das 8h, das 18h em diante, ou fim de
    -- semana. Nao e alarme por si — e o numero que sustenta conversa sobre
    -- plantao, hora extra e risco de acesso indevido.
    count(*) filter (
      where extract(hour  from p.session_start at time zone 'America/Sao_Paulo') < 8
         or extract(hour  from p.session_start at time zone 'America/Sao_Paulo') >= 18
         or extract(isodow from p.session_start at time zone 'America/Sao_Paulo') >= 6
    ),
    (select v from pico),
    (select v from plano),
    (select v from reacesso),
    (select count(*) from anterior)
  from periodo p
  left join public.address_book ab on ab.id = p.address_book_id;
$$;

comment on function public.ops_resumo(uuid, int) is
  'Resumo de operacao do periodo, com escopo por empresa resolvido no banco. '
  'Query agregada sem group by sempre devolve UMA linha: para quem pede empresa '
  'que nao e a dele, essa linha vem zerada — nunca com dado de outra empresa.';

-- ---------------------------------------------------------------------------
-- 2. Por tecnico
-- ---------------------------------------------------------------------------
-- Deliberadamente SEM score, ranking de eficiencia ou "produtividade": os dados
-- medem tempo CONECTADO, nao trabalho feito. Sessao longa tanto pode ser
-- problema dificil quanto atendimento caprichado, e um numero unico de 0 a 100
-- apagaria essa diferenca fingindo objetividade. O que sai aqui e distribuicao
-- comparavel — quem lê tira a conclusao, com contexto que a tabela nao tem.
create or replace function public.ops_por_tecnico(p_tenant uuid default null, p_dias int default 30)
returns table (
  tecnico         text,
  acessos         bigint,
  horas           numeric,
  duracao_media_s numeric,
  dispositivos    bigint,
  clientes        bigint,
  fora_horario    bigint,
  ultimo          timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with escopo as (
    select
      case when private.is_super_admin() then p_tenant else private.current_tenant_id() end as tid,
      (private.is_super_admin() and p_tenant is null) as todos,
      (private.is_super_admin() or p_tenant is null or p_tenant = private.current_tenant_id()) as ok
  ),
  lim as (
    select date_trunc('day',
             ((now() at time zone 'America/Sao_Paulo')::date - (greatest(p_dias,1) - 1))::timestamp
           ) at time zone 'America/Sao_Paulo' as ini
  )
  select
    -- Sessao sem tecnico e acesso iniciado fora do painel (pelo executavel):
    -- nao ha usuario a quem atribuir. Some-la seria esconder justamente o que o
    -- controle de acesso existe para enxergar.
    coalesce(pr.full_name, cl.technician_email, 'Fora do painel'),
    count(*),
    round(coalesce(sum(cl.duration_seconds), 0) / 3600.0, 1),
    round(avg(cl.duration_seconds)::numeric, 0),
    count(distinct cl.address_book_id),
    count(distinct ab.client_id),
    count(*) filter (
      where extract(hour  from cl.session_start at time zone 'America/Sao_Paulo') < 8
         or extract(hour  from cl.session_start at time zone 'America/Sao_Paulo') >= 18
         or extract(isodow from cl.session_start at time zone 'America/Sao_Paulo') >= 6
    ),
    max(cl.session_start)
  from public.connection_logs cl
  cross join escopo e
  cross join lim l
  left join public.profiles pr    on pr.id = cl.technician_id
  left join public.address_book ab on ab.id = cl.address_book_id
  where e.ok
    and (e.todos or cl.tenant_id = e.tid)
    and cl.session_start >= l.ini
  group by 1
  order by count(*) desc;
$$;

comment on function public.ops_por_tecnico(uuid, int) is
  'Volume, horas e alcance por tecnico. Sem score sintetico: os dados medem '
  'tempo conectado, nao trabalho feito.';

-- ---------------------------------------------------------------------------
-- 3. Por computador
-- ---------------------------------------------------------------------------
create or replace function public.ops_por_dispositivo(p_tenant uuid default null, p_dias int default 30)
returns table (
  dispositivo text,
  rustdesk_id text,
  cliente     text,
  acessos     bigint,
  horas       numeric,
  tecnicos    bigint,
  reacessos   bigint,
  ultimo      timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with escopo as (
    select
      case when private.is_super_admin() then p_tenant else private.current_tenant_id() end as tid,
      (private.is_super_admin() and p_tenant is null) as todos,
      (private.is_super_admin() or p_tenant is null or p_tenant = private.current_tenant_id()) as ok
  ),
  lim as (
    select date_trunc('day',
             ((now() at time zone 'America/Sao_Paulo')::date - (greatest(p_dias,1) - 1))::timestamp
           ) at time zone 'America/Sao_Paulo' as ini
  ),
  periodo as (
    select cl.*
      from public.connection_logs cl
     cross join escopo e
     cross join lim l
     where e.ok and (e.todos or cl.tenant_id = e.tid) and cl.session_start >= l.ini
  ),
  com_gap as (
    select p.*,
           p.session_start
             - lag(p.session_start) over (partition by p.rustdesk_id order by p.session_start) as gap
      from periodo p
  )
  select
    coalesce(ab.alias, g.rustdesk_id),
    g.rustdesk_id,
    c.name,
    count(*),
    round(coalesce(sum(g.duration_seconds), 0) / 3600.0, 1),
    count(distinct g.technician_id),
    count(*) filter (where g.gap is not null and g.gap <= interval '24 hours'),
    max(g.session_start)
  from com_gap g
  left join public.address_book ab on ab.id = g.address_book_id
  left join public.clients c       on c.id = ab.client_id
  group by g.rustdesk_id, ab.alias, c.name
  order by count(*) desc;
$$;

comment on function public.ops_por_dispositivo(uuid, int) is
  'Volume, horas e reacessos por computador. reacessos = sessoes que comecaram '
  'ate 24h depois da anterior na mesma maquina.';

-- ---------------------------------------------------------------------------
-- 4. Serie diaria
-- ---------------------------------------------------------------------------
create or replace function public.ops_por_dia(p_tenant uuid default null, p_dias int default 30)
returns table (
  dia          date,
  acessos      bigint,
  horas        numeric,
  tecnicos     bigint,
  dispositivos bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with escopo as (
    select
      case when private.is_super_admin() then p_tenant else private.current_tenant_id() end as tid,
      (private.is_super_admin() and p_tenant is null) as todos,
      (private.is_super_admin() or p_tenant is null or p_tenant = private.current_tenant_id()) as ok
  ),
  dias as (
    select generate_series(
             (now() at time zone 'America/Sao_Paulo')::date - (greatest(p_dias,1) - 1),
             (now() at time zone 'America/Sao_Paulo')::date,
             interval '1 day')::date as dia
  ),
  agg as (
    select (cl.session_start at time zone 'America/Sao_Paulo')::date as dia,
           count(*) as acessos,
           round(coalesce(sum(cl.duration_seconds), 0) / 3600.0, 1) as horas,
           count(distinct cl.technician_id) as tecnicos,
           count(distinct cl.address_book_id) as dispositivos
      from public.connection_logs cl
     cross join escopo e
     where e.ok and (e.todos or cl.tenant_id = e.tid)
     group by 1
  )
  select d.dia,
         coalesce(a.acessos, 0),
         coalesce(a.horas, 0),
         coalesce(a.tecnicos, 0),
         coalesce(a.dispositivos, 0)
    from dias d
    left join agg a on a.dia = d.dia
   where (select ok from escopo)
   order by d.dia desc;
$$;

comment on function public.ops_por_dia(uuid, int) is
  'Serie diaria densa de acessos e horas. Dia sem acesso aparece com zero.';

-- ---------------------------------------------------------------------------
-- 5. Empresas que o chamador pode escolher no seletor
-- ---------------------------------------------------------------------------
-- Existe para a tela nao precisar ler `tenants` direto so para montar um combo.
create or replace function public.ops_empresas()
returns table (id uuid, nome text, acessos_30d bigint)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.name, count(cl.id)
    from public.tenants t
    left join public.connection_logs cl
      on cl.tenant_id = t.id
     and cl.session_start >= now() - interval '30 days'
   where private.is_super_admin() and t.is_active
   group by t.id, t.name
   order by count(cl.id) desc, t.name;
$$;

comment on function public.ops_empresas() is
  'Empresas para o seletor do painel. So super_admin — para os demais o escopo '
  'ja e a propria empresa e nao ha o que escolher.';

-- ---------------------------------------------------------------------------
-- Grants — `anon` nominalmente no revoke (default privilege do Supabase concede
-- EXECUTE a ele no create function, e `revoke from public` nao desfaz grant
-- nominal). Ver 20260812162229_resolve_agent_update_revoke_anon.
-- ---------------------------------------------------------------------------
revoke all on function public.ops_resumo(uuid, int)          from public, anon, authenticated;
revoke all on function public.ops_por_tecnico(uuid, int)     from public, anon, authenticated;
revoke all on function public.ops_por_dispositivo(uuid, int) from public, anon, authenticated;
revoke all on function public.ops_por_dia(uuid, int)         from public, anon, authenticated;
revoke all on function public.ops_empresas()                 from public, anon, authenticated;

grant execute on function public.ops_resumo(uuid, int)          to authenticated;
grant execute on function public.ops_por_tecnico(uuid, int)     to authenticated;
grant execute on function public.ops_por_dispositivo(uuid, int) to authenticated;
grant execute on function public.ops_por_dia(uuid, int)         to authenticated;
grant execute on function public.ops_empresas()                 to authenticated;
