-- AcessoFast, 28/09/2026: HORARIO DE ACESSO por empresa.
--
-- Pedido do usuario: cada empresa decide de que hora ate que hora os acessos as
-- maquinas dela sao permitidos. Fora do horario:
--   * PAINEL: o Conectar do tecnico e recusado (connect-device -> 403 fora_do_horario).
--     Admin da empresa e super_admin ficam fora da regra no painel (decisao do usuario,
--     28/09): a regra e para o tecnico, e quem e dono dela precisa atender uma emergencia
--     sem desligar a regra — desligar para abrir uma excecao e o jeito mais facil de
--     esquecer a regra desligada.
--   * ACESSO DIRETO pelo programa (ID + senha, ou aceite na maquina): a session-ingest
--     devolve hard_cap_at no passado ja no 'start', e o agente derruba a conexao no
--     proximo tick (~3s). Aqui NINGUEM e isento: o servidor nao sabe quem esta do outro
--     lado.
--
-- NAO PRECISA DE AGENTE NOVO. O corte reaproveita o hard_cap_at que o agente obedece
-- desde o Billing B2 (26/07): le o campo em todo start/heartbeat e corta quando vence.
-- Corte antes do login (conexao ainda pedindo senha ou aceite) nem gira a senha — o
-- checkHardCap so rotaciona se alguma conexao chegou a autenticar.
--
-- SESSAO EM ANDAMENTO QUANDO O HORARIO ACABA: a empresa escolhe (decisao do usuario),
-- em horario_acesso_encerra_sessoes:
--   false (padrao) deixa terminar: so conexao NOVA e barrada;
--   true           derruba tudo no fim do horario (no primeiro heartbeat depois, ~20s).
--
-- POR QUE O CORTE SO SAI QUANDO JA ESTA FORA, e nunca "armado" para o fim da janela: o
-- agente nunca desarma um corte com null (o heartbeat so re-arma quando vem valor). Um
-- corte armado para as 18:00 sobreviveria a empresa desligar a regra ou esticar o
-- horario. Decidindo a cada heartbeat, mudar a configuracao vale na hora, nos dois
-- sentidos.
--
-- O VALOR devolvido e o instante em que a janela FECHOU (sempre no passado), e nao
-- now(): maquina com o relogio atrasado alguns minutos atrasaria o corte na mesma medida.
--
-- FORMATO de horario_acesso: array de 7 posicoes indexado pelo dia da semana do
-- Postgres e do JS (0 = domingo ... 6 = sabado). Cada posicao e null (fechado o dia
-- todo) ou {"inicio":"HH:MM","fim":"HH:MM"}, janela [inicio, fim). fim "24:00" = ate a
-- meia-noite. Janela que atravessa a meia-noite (22:00-06:00) NAO e suportada:
-- fim > inicio. O fuso e o de tenant_settings.timezone (ja existia, padrao
-- America/Sao_Paulo).
--
-- QUEM EDITA: a politica tenant_settings_update ja deixa o admin da empresa (e o
-- super_admin) gravar a propria linha — e e ele mesmo quem deve decidir isto, entao nao
-- ha gatilho de guarda como o da fronteira_modo. Tecnico so le.


-- ---------------------------------------------------------------------------
-- 1) Funcoes puras (nao leem tabela nenhuma).
--
-- Ficam em public, e com o EXECUTE padrao, porque o CHECK da coluna as executa com o
-- papel de QUEM grava a linha: admin pelo painel (authenticated), backend (service_role)
-- e as RPCs de provisionamento (postgres). O service_role nao tem USAGE em private — em
-- private, o CHECK derrubaria qualquer gravacao do backend (a licao de 11/09 com a
-- guard_rotacao_modo). Por serem puras, expor nao entrega dado nenhum.
-- ---------------------------------------------------------------------------

-- 'HH:MM' -> minutos desde a meia-noite; '24:00' -> 1440; qualquer outra coisa -> null.
create or replace function public.horario_minutos(p text)
returns integer
language sql
immutable
set search_path = ''
as $fn$
  select case
    when p ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then substr(p, 1, 2)::int * 60 + substr(p, 4, 2)::int
    when p = '24:00' then 1440
  end;
$fn$;

-- Um IF por checagem de proposito: a ordem de avaliacao de um OR em SQL nao e
-- garantida, e jsonb_array_length num valor que nao e array levanta erro — o CHECK
-- precisa responder false, nao explodir.
create or replace function public.horario_acesso_valido(p_horario jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_dia jsonb;
  v_ini integer;
  v_fim integer;
begin
  if p_horario is null then
    return false;
  end if;
  if jsonb_typeof(p_horario) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(p_horario) <> 7 then
    return false;
  end if;

  for i in 0..6 loop
    v_dia := p_horario -> i;
    continue when jsonb_typeof(v_dia) = 'null';
    if jsonb_typeof(v_dia) <> 'object' then
      return false;
    end if;
    v_ini := public.horario_minutos(v_dia ->> 'inicio');
    v_fim := public.horario_minutos(v_dia ->> 'fim');
    if v_ini is null or v_fim is null then
      return false;
    end if;
    if v_ini >= v_fim then
      return false;
    end if;
  end loop;

  return true;
end;
$fn$;

-- Situacao de um horario num instante:
--   fora      o instante esta fora de qualquer janela
--   fecha_em  (dentro) quando a janela corrente fecha
--   abre_em   (fora) a proxima abertura nos proximos 7 dias; null = nenhum dia aberto
--   fechou_em (fora) quando a ultima janela fechou; null = nenhum dia aberto
-- Regra desligada, instante nulo ou horario invalido -> nunca fora. O CHECK impede
-- gravar horario invalido; se um dia escapar, errar para o lado de deixar trabalhar e o
-- menos pior. Fuso invalido cai no de Sao Paulo pelo mesmo motivo.
create or replace function public.horario_acesso_situacao(
  p_ativo    boolean,
  p_horario  jsonb,
  p_timezone text,
  p_em       timestamptz default now()
)
returns table (fora boolean, fecha_em timestamptz, abre_em timestamptz, fechou_em timestamptz)
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_tz    text := coalesce(nullif(p_timezone, ''), 'America/Sao_Paulo');
  v_local timestamp;
  v_hoje  date;
  v_dia   date;
  v_d     jsonb;
  v_ini   timestamp;
  v_fim   timestamp;
begin
  fora := false;
  fecha_em := null;
  abre_em := null;
  fechou_em := null;

  if p_ativo is not true or p_em is null then
    return next;
    return;
  end if;
  if not public.horario_acesso_valido(p_horario) then
    return next;
    return;
  end if;

  begin
    v_local := p_em at time zone v_tz;
  exception when others then
    v_tz := 'America/Sao_Paulo';
    v_local := p_em at time zone v_tz;
  end;
  v_hoje := v_local::date;

  -- Dentro da janela de hoje? Como nenhuma janela atravessa a meia-noite, so a de hoje
  -- pode conter o instante.
  v_d := p_horario -> extract(dow from v_hoje)::int;
  if jsonb_typeof(v_d) = 'object' then
    v_ini := v_hoje + make_interval(mins => public.horario_minutos(v_d ->> 'inicio'));
    v_fim := v_hoje + make_interval(mins => public.horario_minutos(v_d ->> 'fim'));
    if v_local >= v_ini and v_local < v_fim then
      fecha_em := v_fim at time zone v_tz;
      return next;
      return;
    end if;
  end if;

  fora := true;

  -- Proxima abertura: hoje mais tarde, ou num dos 7 dias seguintes (o 7o e o mesmo dia
  -- da semana, para a empresa que so abre um dia).
  for k in 0..7 loop
    v_dia := v_hoje + k;
    v_d := p_horario -> extract(dow from v_dia)::int;
    continue when jsonb_typeof(v_d) is distinct from 'object';
    v_ini := v_dia + make_interval(mins => public.horario_minutos(v_d ->> 'inicio'));
    if v_ini > v_local then
      abre_em := v_ini at time zone v_tz;
      exit;
    end if;
  end loop;

  -- Ultimo fechamento: hoje mais cedo, ou num dos 7 dias anteriores.
  for k in 0..7 loop
    v_dia := v_hoje - k;
    v_d := p_horario -> extract(dow from v_dia)::int;
    continue when jsonb_typeof(v_d) is distinct from 'object';
    v_fim := v_dia + make_interval(mins => public.horario_minutos(v_d ->> 'fim'));
    if v_fim <= v_local then
      fechou_em := v_fim at time zone v_tz;
      exit;
    end if;
  end loop;

  return next;
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 2) Configuracao por empresa.
-- ---------------------------------------------------------------------------
alter table public.tenant_settings
  add column horario_acesso_ativo boolean not null default false,
  add column horario_acesso jsonb not null default
    '[null,{"inicio":"08:00","fim":"18:00"},{"inicio":"08:00","fim":"18:00"},{"inicio":"08:00","fim":"18:00"},{"inicio":"08:00","fim":"18:00"},{"inicio":"08:00","fim":"18:00"},null]'::jsonb,
  add column horario_acesso_encerra_sessoes boolean not null default false;

alter table public.tenant_settings
  add constraint tenant_settings_horario_acesso_valido
  check (public.horario_acesso_valido(horario_acesso));

comment on column public.tenant_settings.horario_acesso_ativo is
  'Horario de acesso: fora dele o tecnico nao conecta pelo painel e o acesso direto pelo programa e derrubado. Desligado = sem restricao.';
comment on column public.tenant_settings.horario_acesso is
  'Horario de acesso: 7 posicoes por dia da semana (0 = domingo). null = fechado; {"inicio":"HH:MM","fim":"HH:MM"} = janela [inicio, fim), fim "24:00" = ate a meia-noite. Fuso: tenant_settings.timezone.';
comment on column public.tenant_settings.horario_acesso_encerra_sessoes is
  'Horario de acesso: true = derruba as sessoes em andamento quando o horario acaba; false (padrao) = deixa terminar e barra so conexao nova.';


-- ---------------------------------------------------------------------------
-- 3) Quando a conexao pedida pelo Conectar chegou de fato.
--
-- A ficha do Conectar (create_access_grant) nasce 'active' com o horario do CLIQUE, e
-- a session-ingest amarra a ela o primeiro sinal que a maquina mandar, sem saber de
-- quem e a conexao. Se ninguem usa o clique, a ficha fica aberta 5 min ate o
-- close_stale_sessions desistir dela — e quem entrasse pelo .exe naquela maquina
-- nesse meio-tempo herdava a ficha: a isencao de um admin que clicou, ou o horario do
-- clique no modo "deixar terminar" (pedido do usuario em 28/09: fechar isso).
--
-- A session-ingest grava aqui o instante do primeiro sinal de cada ficha. A conexao do
-- painel chega em segundos; a que chega mais de 2 min depois do clique e tratada pela
-- horario_acesso_corte como conexao nova. Guardar o instante, e nao so decidir no
-- primeiro sinal, e o que faz a decisao valer para os sinais seguintes tambem — senao
-- bastaria a resposta com o corte se perder no caminho.
--
-- De quebra, passa a existir o "tempo ate o primeiro sinal" de cada clique, que nao era
-- guardado em lugar nenhum. Fica nula na sessao direta (nasce pela propria
-- session-ingest, ja no primeiro sinal) e nas fichas anteriores a esta migration.
--
-- Ninguem logado escreve aqui: connection_logs tem RLS sem politica de UPDATE, e o
-- INSERT e so do super_admin — a mesma razao que torna confiavel o technician_id, em
-- que a isencao se apoia.
-- ---------------------------------------------------------------------------
alter table public.connection_logs
  add column primeiro_sinal_em timestamptz;

comment on column public.connection_logs.primeiro_sinal_em is
  'Primeiro sinal do agente numa ficha do Conectar (session-ingest). Menos session_start = quanto a conexao demorou a chegar; mais de 2 min e tratada como outra conexao pelo horario de acesso. Nula na sessao direta e nas fichas anteriores a 28/09/2026.';


-- ---------------------------------------------------------------------------
-- 4) Decisao de corte da session-ingest.
--
-- Devolve null (nao corta) ou o instante a mandar como hard_cap_at (no passado).
-- p_connection_log_id e a sessao ABERTA que o sinal alimenta (heartbeat); nulo quando
-- o sinal vai criar uma sessao nova (start de acesso direto) — conexao nova fora do
-- horario e sempre cortada.
--
-- Com sessao aberta:
--   * sessao aberta PELO PAINEL por super_admin, ou por admin da empresa dona da
--     maquina, nao e cortada — mesma excecao do connect-device;
--   * no modo "deixar terminar", sessao que COMECOU dentro do horario segue;
--   * mas se a conexao chegou mais de 2 min depois do clique (secao 3), ela nao herda
--     a isencao de quem clicou, e "comecou" passa a contar da chegada dela. Quem
--     demorou a conectar dentro do horario continua protegido no "deixar terminar".
--
-- Limite que continua: enquanto uma sessao legitima estiver aberta numa maquina, outra
-- conexao nessa MESMA maquina vira parte dela — o agente reporta a maquina, nao cada
-- conexao, e cortar derrubaria as duas.
--
-- SECURITY DEFINER em public: e chamada pela edge via PostgREST (so enxerga public) e
-- le connection_logs/profiles/tenant_settings, que o service_role le mas outros nao.
-- ---------------------------------------------------------------------------
create or replace function public.horario_acesso_corte(
  p_tenant_id         uuid,
  p_connection_log_id uuid default null
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_ativo    boolean;
  v_horario  jsonb;
  v_tz       text;
  v_encerra  boolean;
  v_fora     boolean;
  v_fechou   timestamptz;
  v_tecnico  uuid;
  v_inicio   timestamptz;
  v_primeiro timestamptz;
  v_papel    text;
  v_ten_tec  uuid;
begin
  select ts.horario_acesso_ativo, ts.horario_acesso, ts.timezone, ts.horario_acesso_encerra_sessoes
    into v_ativo, v_horario, v_tz, v_encerra
    from public.tenant_settings ts
   where ts.tenant_id = p_tenant_id;
  if v_ativo is not true then
    return null;
  end if;

  select s.fora, s.fechou_em
    into v_fora, v_fechou
    from public.horario_acesso_situacao(v_ativo, v_horario, v_tz, now()) s;
  if v_fora is not true then
    return null;
  end if;

  if p_connection_log_id is not null then
    select cl.technician_id, cl.session_start, cl.primeiro_sinal_em
      into v_tecnico, v_inicio, v_primeiro
      from public.connection_logs cl
     where cl.id = p_connection_log_id;

    -- Conexao que chegou mais de 2 min depois do clique: e tratada como outra conexao.
    -- Perde a isencao de quem clicou, e o "comecou" passa a ser a chegada dela.
    if v_primeiro is not null and v_primeiro - v_inicio > interval '2 minutes' then
      v_tecnico := null;
      v_inicio := v_primeiro;
    end if;

    if v_tecnico is not null then
      select pr.role::text, pr.tenant_id
        into v_papel, v_ten_tec
        from public.profiles pr
       where pr.id = v_tecnico;
      if v_papel = 'super_admin' then
        return null;
      end if;
      if v_papel = 'admin' and v_ten_tec = p_tenant_id then
        return null;
      end if;
    end if;

    if v_encerra is not true and v_inicio is not null then
      if (select s.fora
            from public.horario_acesso_situacao(v_ativo, v_horario, v_tz, v_inicio) s) is false then
        return null;
      end if;
    end if;
  end if;

  return coalesce(v_fechou, now());
end;
$fn$;

revoke all on function public.horario_acesso_corte(uuid, uuid) from public, anon, authenticated;
grant execute on function public.horario_acesso_corte(uuid, uuid) to service_role;


-- ---------------------------------------------------------------------------
-- 5) O que o painel le: a situacao de AGORA de cada empresa que o usuario enxerga.
--
-- security_invoker: a RLS de tenant_settings decide as linhas — tecnico e admin veem a
-- da propria empresa, super_admin ve todas. A connect-device le a mesma view com o
-- service_role, e assim o painel e o servidor nunca discordam sobre o horario.
-- `timezone` vai junto para a tela escrever "libera amanha as 08:00" no horario da
-- empresa, e nao no do navegador de quem le.
-- ---------------------------------------------------------------------------
create or replace view public.v_horario_acesso
with (security_invoker = true)
as
select ts.tenant_id,
       ts.horario_acesso_ativo as ativo,
       s.fora,
       s.fecha_em,
       s.abre_em,
       ts.timezone
  from public.tenant_settings ts
  cross join lateral public.horario_acesso_situacao(
    ts.horario_acesso_ativo, ts.horario_acesso, ts.timezone, now()
  ) s;

revoke all on public.v_horario_acesso from anon, authenticated;
grant select on public.v_horario_acesso to authenticated, service_role;
