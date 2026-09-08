-- AcessoFast, 08/09/2026: restaurar o comando corrigido do PowerShell na versao
-- que foi para `public`.
--
-- O QUE ACONTECEU, em ordem, no mesmo dia:
--
--   1. A 20260908120000 criou `private.registrar_aviso_desatualizado` com um
--      comando montado para o CMD (`powershell -Command "..."`).
--   2. O Ryan colou esse comando num PowerShell ja aberto e ele QUEBROU: o shell
--      de fora consumiu as aspas e `($env:TEMP+'\...')` chegou como texto
--      literal. Corrigido no commit 129be98 — no arquivo E no banco, por um
--      script avulso.
--   3. A 20260908160000 (esta cadeia) moveu a funcao de `private` para `public`
--      porque o PostgREST nao enxerga `private`. Mas ela foi escrita ANTES do
--      passo 2 e copiou o texto ANTIGO do arquivo, dropando de quebra a versao
--      de `private` que ja estava certa.
--
-- Resultado: a correcao do passo 2 foi desfeita sem ninguem mexer nela. Esta
-- migration repoe o texto corrigido na funcao de `public`.
--
-- A licao, para a proxima vez que uma funcao mudar de schema: mover copia o
-- CORPO do arquivo, e o arquivo pode estar atras do banco. Conferir o `prosrc`
-- em producao antes de mover, nao so o .sql do repo.
--
-- Nenhum aviso errado chegou a ninguem: a fila esteve vazia o tempo todo (a
-- entrega so acontece no presence de uma maquina com o aviso.go, e nenhuma da
-- frota tem ainda).
--
-- O comando, e por que e assim: sem `powershell -Command` na frente, porque o
-- texto e para colar DENTRO de um PowerShell ja aberto. `"$env:TEMP\..."` com
-- aspas duplas resolve normal, inclusive quando o usuario do Windows tem espaco
-- no nome — testado de verdade, baixou os 27,1 MB em
-- "C:\Users\Ryan ASP\AppData\Local\Temp". E `-UseBasicParsing` porque Windows
-- Server com o IE nunca aberto quebra o Invoke-WebRequest sem ele, e servidor e
-- justamente onde mais se acha agente velho.

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
    'iwr -UseBasicParsing ' ||
    '''https://github.com/ASPaes/acessofast-agent/releases/latest/download/AcessoFastSetup.exe'' ' ||
    '-OutFile "$env:TEMP\AcessoFastSetup.exe"; Start-Process "$env:TEMP\AcessoFastSetup.exe"'
  );
end;
$fn$;

revoke all on function public.registrar_aviso_desatualizado(text, text, text) from public, anon, authenticated;
grant execute on function public.registrar_aviso_desatualizado(text, text, text) to service_role;
