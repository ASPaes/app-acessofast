-- AcessoFast, 08/09/2026: o aviso do acesso direto nunca saiu — conserto.
--
-- O DEFEITO. A migration de hoje (20260908120000) criou as duas RPCs em
-- `private`, e a session-ingest as chama assim:
--
--     await db.rpc("puxar_aviso_agente", { p_rustdesk_id })
--
-- Esse `.rpc()` nao e uma chamada SQL: e um POST para /rest/v1/rpc/<nome>, e o
-- PostgREST so resolve nome em schema EXPOSTO. Sondado na producao hoje:
--
--     POST /rest/v1/rpc/puxar_aviso_agente     -> 404
--     POST /rest/v1/rpc/resolve_agent_update   -> 401   (existe, so barra o anon)
--     Content-Profile: private                 -> PGRST106
--       "Only the following schemas are exposed: public, graphql_public"
--
-- Ou seja: as duas chamadas erram sempre. E os dois `try/catch` fail-open da
-- session-ingest engolem o erro — a funcao responde 200, a presenca segue
-- normal, e o aviso simplesmente nao existe. `private.avisos_agente` estava com
-- ZERO linhas com a v59 ja no ar. Falha calada, que e o pior modo de falhar.
--
-- `.schema("private")` nao resolveria: o PGRST106 acima e justamente a recusa
-- do profile `private`. Expor o schema seria pior — ele existe para NAO ser
-- alcancavel de fora.
--
-- O CONSERTO: mover as duas para `public`, que e onde ja moram todas as RPCs
-- que a session-ingest chama (resolve_agent_update, resolve_agent_update_global,
-- auto_adopt_direct, meter_external_session). Um lar so, e a convencao do repo.
--
-- Mover em vez de embrulhar de proposito: um wrapper deixaria a implementacao em
-- `private` e a porta em `public`, e a proxima pessoa editaria a metade errada —
-- e exatamente a armadilha que ja temos com a copia velha da session-ingest no
-- repo do agente.
--
-- A TABELA CONTINUA EM `private`. Ela e que nao pode ser exposta; as funcoes,
-- sendo `security definer` com grant so para service_role, sao a unica porta.
--
-- NAO PRECISA DE REDEPLOY. Os nomes e as assinaturas sao identicos aos que a
-- session-ingest v59 ja chama — assim que esta migration aplica, o codigo que ja
-- esta no ar passa a funcionar.

-- ---------------------------------------------------------------------------
-- 1. Registra o aviso quando um acesso direto cai numa maquina desatualizada.
--    Corpo identico ao de private; muda so o schema onde vive.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_aviso_desatualizado(
  p_destino_rustdesk_id text,
  p_alvo_rustdesk_id    text,
  p_alvo_nome           text
) returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_nome text := coalesce(nullif(trim(p_alvo_nome), ''), p_alvo_rustdesk_id);
begin
  if p_destino_rustdesk_id !~ '^[0-9]{6,12}$' then return; end if;
  if p_alvo_rustdesk_id    !~ '^[0-9]{6,12}$' then return; end if;
  -- Nao avisa sobre si mesmo (tecnico acessando a propria maquina).
  if p_destino_rustdesk_id = p_alvo_rustdesk_id then return; end if;

  if exists (
    select 1 from private.avisos_agente
     where destino_rustdesk_id = p_destino_rustdesk_id
       and tipo = 'agente_desatualizado'
       and entregue_em is null
       and mensagem like '%' || p_alvo_rustdesk_id || '%'
  ) then
    return;
  end if;

  insert into private.avisos_agente (destino_rustdesk_id, tipo, titulo, mensagem)
  values (
    p_destino_rustdesk_id,
    'agente_desatualizado',
    'AcessoFast desatualizado neste computador',
    'O computador ' || v_nome || ' (ID ' || p_alvo_rustdesk_id || ') esta com uma ' ||
    'versao antiga do AcessoFast: nao reporta status e nao se atualiza sozinha.' || chr(10) || chr(10) ||
    'Enquanto estiver conectado nele, abra o PowerShell E COLE o comando abaixo. ' ||
    'Ele baixa e instala a versao nova por cima, sem desinstalar nada e sem reiniciar:' || chr(10) || chr(10) ||
    'powershell -Command "iwr -UseBasicParsing ' ||
    '''https://github.com/ASPaes/acessofast-agent/releases/latest/download/AcessoFastSetup.exe'' ' ||
    '-OutFile ($env:TEMP+''\AcessoFastSetup.exe''); Start-Process ($env:TEMP+''\AcessoFastSetup.exe'')"'
  );
end;
$fn$;

-- O default privilege do Supabase da EXECUTE a PUBLIC em funcao nova: revogar e
-- obrigatorio, nao higiene. Sem isto, `anon` poderia enfileirar aviso na tela de
-- qualquer maquina da frota so sabendo o rustdesk_id, que aparece na propria tela
-- do cliente.
revoke all on function public.registrar_aviso_desatualizado(text, text, text) from public, anon, authenticated;
grant execute on function public.registrar_aviso_desatualizado(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Entrega: devolve o aviso pendente e JA marca como entregue, numa operacao so.
-- ---------------------------------------------------------------------------
create or replace function public.puxar_aviso_agente(p_rustdesk_id text)
returns table (titulo text, mensagem text)
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if p_rustdesk_id !~ '^[0-9]{6,12}$' then return; end if;

  return query
  with alvo as (
    select a.id from private.avisos_agente a
     where a.destino_rustdesk_id = p_rustdesk_id
       and a.entregue_em is null
     order by a.criado_em
     limit 1
     for update skip locked
  ), marcado as (
    update private.avisos_agente a
       set entregue_em = now()
      from alvo
     where a.id = alvo.id
    returning a.titulo, a.mensagem
  )
  select m.titulo, m.mensagem from marcado m;
end;
$fn$;

-- Aqui a revogacao vale ainda mais: esta funcao CONSOME o aviso. Aberta ao anon,
-- daria para drenar o aviso de qualquer maquina antes de o agente dela buscar —
-- o aviso sumiria sem nunca aparecer na tela.
revoke all on function public.puxar_aviso_agente(text) from public, anon, authenticated;
grant execute on function public.puxar_aviso_agente(text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Some com as versoes de private, para nao sobrar a metade errada para editar.
--    A purge_avisos_agente CONTINUA em private: quem a chama e o cron, por SQL
--    direto, e esse caminho nunca passou pelo PostgREST.
-- ---------------------------------------------------------------------------
drop function if exists private.puxar_aviso_agente(text);
drop function if exists private.registrar_aviso_desatualizado(text, text, text);
