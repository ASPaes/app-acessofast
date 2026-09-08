-- AcessoFast, 08/09/2026: levar o aviso de "agente desatualizado" para quem
-- acessa DIRETO pelo cliente, sem passar pelo painel.
--
-- O painel ja barra: clicar em Conectar numa maquina atrasada abre um dialogo
-- sem saida, com o comando de atualizacao. Isso cobre 177 dos 188 acessos a
-- maquina desatualizada nos ultimos 30 dias. Os outros 11 vieram pelo acesso
-- direto — o tecnico abre o cliente, digita o ID e conecta, sem tela nossa no
-- caminho. E essa fatia tende a crescer: parte das empresas migrou pro painel
-- agora, e quem ainda usa o cliente direto nao ve aviso nenhum.
--
-- ONDE O AVISO APARECE, e por que nao na maquina acessada: quem desenharia uma
-- janela la seria o agente, e sao justamente as 82 desatualizadas que nao
-- recebem codigo novo — o mesmo impasse de sempre. Entao o aviso vai para a
-- MAQUINA DO TECNICO, cujo agente e atualizado. O servidor ja sabe quem e ele:
-- o agente da maquina acessada reporta `controller_rustdesk_id` no evento
-- 'start' (o mesmo dado que alimenta a auto-adocao).
--
-- O PRECO, declarado: o agente do tecnico so conversa com o servidor no
-- presence, de 3 em 3 minutos. Entao o aviso chega ATE 3 MIN depois de a sessao
-- comecar — o tecnico ja estara conectado quando ele aparecer. Nao da para
-- fazer melhor sem encurtar o presence, que e exatamente o custo que estamos
-- eliminando. Como a sessao tipica dura mais que isso, ele ainda tem a sessao
-- aberta para rodar o comando.

create table if not exists private.avisos_agente (
  id            uuid primary key default gen_random_uuid(),
  -- Para QUEM mostrar (a maquina do tecnico), nao sobre quem e o aviso.
  destino_rustdesk_id text not null,
  tipo          text not null,
  -- Texto ja pronto: quem monta a frase e o servidor, nao o agente. Assim
  -- melhorar a redacao nao exige rollout de binario.
  titulo        text not null,
  mensagem      text not null,
  criado_em     timestamptz not null default now(),
  entregue_em   timestamptz,
  constraint avisos_agente_destino_ck check (destino_rustdesk_id ~ '^[0-9]{6,12}$'),
  constraint avisos_agente_tipo_ck check (tipo in ('agente_desatualizado'))
);

-- A consulta quente e "tem aviso pendente pra este id?", em todo presence de
-- maquina atualizada. Indice parcial: entregue nao interessa mais.
create index if not exists avisos_agente_pendentes_idx
  on private.avisos_agente (destino_rustdesk_id)
  where entregue_em is null;

alter table private.avisos_agente enable row level security;
revoke all on table private.avisos_agente from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Registra o aviso quando um acesso direto cai numa maquina desatualizada.
--
-- Idempotente por (destino, alvo) enquanto pendente: se o tecnico reconectar
-- tres vezes na mesma maquina antes de ver o aviso, continua UM aviso. Sem
-- isso, uma tarde de reconexoes viraria uma fila de janelas na cara dele —
-- o caminho mais curto para o aviso ser ignorado.
-- ---------------------------------------------------------------------------
create or replace function private.registrar_aviso_desatualizado(
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
    -- SEM `powershell -Command` na frente: o texto e para colar DENTRO de um
    -- PowerShell ja aberto, e o aninhamento quebra. Testado na maquina do Ryan:
    -- colando a versao anterior, o shell de fora consumia as aspas e a expressao
    -- ($env:TEMP+'\...') chegava como texto literal, dando
    --   C:\Users\...\Temp+'\AcessoFastSetup.exe' : O termo ... nao e reconhecido
    'iwr -UseBasicParsing ' ||
    '''https://github.com/ASPaes/acessofast-agent/releases/latest/download/AcessoFastSetup.exe'' ' ||
    '-OutFile "$env:TEMP\AcessoFastSetup.exe"; Start-Process "$env:TEMP\AcessoFastSetup.exe"'
  );
end;
$fn$;

revoke all on function private.registrar_aviso_desatualizado(text, text, text) from public, anon, authenticated;
grant execute on function private.registrar_aviso_desatualizado(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Entrega: devolve o aviso pendente e JA marca como entregue, numa operacao so.
-- Duas chamadas (ler, depois marcar) abririam janela para o mesmo aviso sair
-- duas vezes se o agente reconectasse no meio.
-- ---------------------------------------------------------------------------
create or replace function private.puxar_aviso_agente(p_rustdesk_id text)
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

revoke all on function private.puxar_aviso_agente(text) from public, anon, authenticated;
grant execute on function private.puxar_aviso_agente(text) to service_role;

-- Faxina: aviso entregue vira historico inutil, e a tabela nao pode virar mais
-- uma que cresce sem freio (ja tivemos essa lição com rate_limit_counters).
create or replace function private.purge_avisos_agente()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.avisos_agente
   where entregue_em is not null and entregue_em < now() - interval '7 days';
$$;

revoke all on function private.purge_avisos_agente() from public, anon, authenticated;

select cron.schedule('acessofast_purge_avisos_agente', '55 3 * * *',
                     'select private.purge_avisos_agente();');
