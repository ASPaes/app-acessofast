-- AcessoFast, 11/09/2026: a guarda do modo de rotacao barrava o proprio backend.
--
-- O DEFEITO. A 20260911120000 criou private.guard_rotacao_modo() SEM security
-- definer. Rodando com o papel de quem dispara, ela chamava private.is_super_admin()
-- — e o service_role NAO tem USAGE no schema private (conferido: authenticated tem,
-- service_role nao). Resultado, a cada sinal do agente novo:
--
--   42501: permission denied for schema private
--   CONTEXT: PL/pgSQL function private.guard_rotacao_modo() line 9 at IF
--
-- O `and` do IF nao salva: o PL/pgSQL resolve os nomes ao PREPARAR a expressao, antes
-- de avaliar qualquer operando. A checagem de papel vir primeiro nao impedia a
-- referencia a private de ser resolvida.
--
-- COMO APARECEU. Os dois canarios do Passo 1 (208146940 e 307871329) baixaram o
-- agente 2026.09.11-a90c001, que manda rotacao_modo em todo POST. A session-ingest
-- passou a incluir rotacao_modo_efetivo no UPDATE do address_book, o gatilho acordou,
-- e o UPDATE inteiro falhou:
--   * presence -> 500, last_online congelado -> as duas maquinas "offline" no painel;
--   * heartbeat seguiu gravando em connection_logs (ali o erro do address_book e
--     ignorado de proposito), entao cobranca e acesso NAO foram afetados;
--   * o modo nunca chegou ao agente (o 500 sai antes de resolve_rotacao_modo), entao
--     os canarios seguiram girando como antes — o comportamento de seguranca ficou
--     intacto.
-- No rollout global, isso teria posto como offline toda maquina atualizada.
--
-- POR QUE O TESTE DA GUARDA NAO PEGOU. Ele foi feito como `authenticated` (o
-- suporte4, admin da ASP) — e authenticated TEM usage em private, porque as
-- politicas de RLS usam private.is_super_admin(). Testou-se a porta que nao ia
-- falhar. A guarda precisa ser testada tambem como service_role.
--
-- O CONSERTO, em duas camadas:
--   1. security definer, como a private.guard_profile_privileges — que era o
--      precedente declarado na migration original e que, esse sim, e definer. As
--      chamadas internas passam a rodar com o dono (postgres). auth.jwt() e
--      auth.uid() leem request.jwt.claims da SESSAO, nao do papel, entao continuam
--      enxergando quem chamou de verdade.
--   2. checagens em ordem, cada uma num IF proprio com retorno antecipado. Cada
--      comando PL/pgSQL so e preparado quando alcancado: service_role e SQL direto
--      saem antes de qualquer referencia a private. Fica robusto mesmo que alguem
--      tire o definer um dia.
--
-- Os gatilhos nao precisam ser recriados: apontam para a funcao pelo OID, e o
-- create or replace o preserva.

create or replace function private.guard_rotacao_modo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  claims jsonb := auth.jwt();
  -- to_jsonb para servir as duas tabelas com uma funcao so: tenant_settings nao tem
  -- rotacao_modo_efetivo, e o campo ausente vira NULL dos dois lados (sem mudanca).
  v_new  jsonb := to_jsonb(new);
  v_old  jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
begin
  -- Nada mudou nas colunas guardadas: nao ha o que conferir.
  if (v_new ->> 'rotacao_modo') is not distinct from (v_old ->> 'rotacao_modo')
     and (v_new ->> 'rotacao_modo_efetivo') is not distinct from (v_old ->> 'rotacao_modo_efetivo') then
    return new;
  end if;

  -- SQL direto, sem JWT: migration, SQL editor, cron.
  if claims is null then
    return new;
  end if;

  -- O backend. E a session-ingest que grava rotacao_modo_efetivo.
  if coalesce(claims ->> 'role', '') = 'service_role' then
    return new;
  end if;

  if private.is_super_admin() then
    return new;
  end if;

  raise exception
    'Somente super_admin ou o backend (service_role) podem alterar o modo de rotacao'
    using errcode = '42501';
end;
$fn$;

revoke all on function private.guard_rotacao_modo() from public, anon, authenticated;
