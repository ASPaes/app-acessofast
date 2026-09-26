-- Anuncio tambem quando o cap de 2h do free e atingido.
--
-- Ate aqui o anuncio da superficie do agente so disparava no no_credits (saldo
-- zerado). Decisao de 26/09: disparar TAMBEM quando uma sessao free e cortada por
-- ter atingido as 2 horas — e o momento exato da mensagem "Precisa de mais que
-- 2h? Com credito, sem limite de tempo". Mesma superficie, mesmo pool de pecas
-- (placement agent_exhausted); quem escolhe a peca continua sendo o rodizio.
--
-- Este helper diz se a maquina tem uma sessao free cujo cap de 2h JA venceu — o
-- sinal do corte por tempo. NAO confunde com corte por concorrencia (aquele nao
-- vence o atendimento; comprar credito nao resolveria simultaneidade). A
-- session-ingest chama isto no heartbeat e, se true e o controlador e conhecido,
-- enfileira o anuncio (registrar_anuncio_esgotado, que ja deduplica).

create or replace function public.atingiu_cap_2h(p_rustdesk_id text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
      from public.atendimentos a
     where a.rustdesk_id = p_rustdesk_id
       and a.ended_at is null
       and a.source = 'free'::public.atendimento_source
       and a.hard_cap_at is not null
       and a.hard_cap_at <= now()
  );
$function$;

revoke all on function public.atingiu_cap_2h(text) from public, anon, authenticated;
grant execute on function public.atingiu_cap_2h(text) to service_role;
