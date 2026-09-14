-- AcessoFast, 14/09/2026: Passo 3 do plano "Aposentar a Senha Rotativa" — fronteira
-- pela identidade do controlador, ETAPA SHADOW (so observa, nao corta nada).
--
-- A IDEIA. Hoje a fronteira e a senha: quem sabe entra. O Passo 3 pergunta outra
-- coisa — DE QUE COMPUTADOR vem a conexao? Se o computador que controla e da frota da
-- empresa, e o esperado; se nao e, a senha pode ter vazado.
--
-- O DADO JA EXISTIA E ERA JOGADO FORA. O agente (Windows e Android) le a linha
-- `#N peer_id <id>` que o cliente loga depois do login aceito e reenvia o 'start' com
-- controller_rustdesk_id. A session-ingest so usava isso para auto-adotar maquina nova
-- e para o aviso de agente desatualizado. Nenhum lugar guardava. Por isso nao ha
-- historico: a medicao comeca a partir desta migration.
--
-- O QUE ESTA ETAPA FAZ. Guarda o controlador na sessao (connection_logs) e o classifica
-- em relacao a empresa DONA da maquina acessada:
--   mesma_empresa  computador cadastrado e ativo na mesma empresa — o esperado
--   outra_empresa  cadastrado, mas em outra empresa (ex.: suporte da ASP)
--   inativo        cadastrado, mas inativado no painel
--   desconhecido   nao esta no cadastro de ninguem — o caso que a fronteira existe
--                  para pegar
-- Sessao sem controlador fica com as colunas nulas: agente antigo que nao manda o
-- campo, ou conexao que nunca passou do login.
--
-- O QUE ELA NAO FAZ. Nao corta, nao avisa ninguem, nao muda a resposta ao agente.
-- Algumas semanas disto dizem quantos casos legitimos cairiam num corte (tecnico com
-- notebook novo, computador de casa) antes de qualquer enforcement.
--
-- LIMITES CONHECIDOS.
--   * So o PRIMEIRO controlador da sessao e gravado. Uma segunda pessoa entrando na
--     mesma sessao (piggyback) e o Passo 4.
--   * O ID do controlador e o que o cliente dele declara. Um cliente adulterado pode
--     declarar o ID de outra maquina — a fronteira sobe muito a barra (e preciso
--     conhecer um ID da frota E a senha), mas nao e prova criptografica.

alter table public.connection_logs
  add column controller_rustdesk_id text,
  add column controlador_status     text
    check (controlador_status in ('mesma_empresa', 'outra_empresa', 'inativo', 'desconhecido')),
  add column controlador_device_id  uuid references public.address_book(id) on delete set null,
  add column controlador_visto_em   timestamptz;

comment on column public.connection_logs.controlador_status is
  'Passo 3 (shadow): classificacao do computador que controlou a sessao em relacao a empresa da maquina acessada. Nulo = agente nao informou o controlador.';

create index connection_logs_controlador_idx
  on public.connection_logs (controlador_status, session_start)
  where controlador_status is not null;

-- Chamada pela session-ingest no 'start' que traz o controlador. Grava so se a sessao
-- ainda nao tem controlador (o 'start' pode chegar repetido), e devolve a
-- classificacao gravada — ou null se nao gravou.
create or replace function public.registrar_controlador(
  p_connection_log_id      uuid,
  p_controller_rustdesk_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_ctrl      text := nullif(regexp_replace(coalesce(p_controller_rustdesk_id, ''), '\s', '', 'g'), '');
  v_tenant    uuid;
  v_dev       uuid;
  v_dev_ten   uuid;
  v_dev_ativo boolean;
  v_status    text;
begin
  -- ID do RustDesk sao digitos. Qualquer outra coisa nao e classificada.
  if v_ctrl is null or v_ctrl !~ '^[0-9]{6,20}$' then
    return null;
  end if;

  select cl.tenant_id into v_tenant
    from public.connection_logs cl
   where cl.id = p_connection_log_id
     and cl.controller_rustdesk_id is null;
  if not found then
    return null;
  end if;

  select ab.id, ab.tenant_id, ab.is_active
    into v_dev, v_dev_ten, v_dev_ativo
    from public.address_book ab
   where ab.rustdesk_id = v_ctrl
   limit 1;

  v_status := case
    when v_dev is null            then 'desconhecido'
    when v_dev_ativo is false     then 'inativo'
    when v_dev_ten = v_tenant     then 'mesma_empresa'
    else                               'outra_empresa'
  end;

  update public.connection_logs
     set controller_rustdesk_id = v_ctrl,
         controlador_status     = v_status,
         controlador_device_id  = v_dev,
         controlador_visto_em   = now()
   where id = p_connection_log_id
     and controller_rustdesk_id is null;

  return v_status;
end;
$fn$;

revoke all on function public.registrar_controlador(uuid, text) from public, anon, authenticated;
grant execute on function public.registrar_controlador(uuid, text) to service_role;
