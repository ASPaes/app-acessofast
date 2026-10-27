-- AcessoFast, 27/10/2026: clique repetido no Conectar, parte 2 (cron e passado).
--
-- Continua 20261027170000_clique_repetido_no_conectar, que faz a create_access_grant
-- reaproveitar a ficha do clique anterior. Fica em arquivo separado porque apaga
-- fichas, e o conector do Supabase recusa DELETE sem uma confirmacao que o VS Code nao
-- mostra: este vai colado no SQL Editor do Supabase.
--
-- Por que apagar, e nao marcar: a ficha esquecida nao guarda nada que a sessao real
-- nao tenha (mesmo tecnico, mesma maquina, mesmo IP, segundos antes). Marcada, ela
-- continuaria contando como sessao na Auditoria.

-- ---------------------------------------------------------------------
-- 2. Cron: ficha esquecida de clique repetido e absorvida pela sessao real
-- ---------------------------------------------------------------------
-- Mesma funcao de 20260926120000_estorna_cobranca_sessao_nunca_confirmada, com o
-- desvio no comeco do Caso 2. A ficha irma e a 1a sessao CONFIRMADA (com sinal do
-- agente) do mesmo tecnico na mesma maquina, aberta ate 2 min depois da esquecida.
-- Ficha sem tecnico (acesso direto) nunca tem irma: ela ja nasce com sinal.
create or replace function public.close_stale_sessions()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_c1 integer;
  v_c2 integer;
  v_c3 integer;
  r record;
begin
  -- Caso 1: sessao real que perdeu heartbeat (crash/queda) -> fecha no ultimo sinal de vida.
  update public.connection_logs
     set status = 'ended',
         session_end = last_heartbeat_at,
         notes = coalesce(notes,'') || ' [auto-close: heartbeat perdido]'
   where status = 'active'
     and last_heartbeat_at is not null
     and last_heartbeat_at < now() - interval '90 seconds';
  get diagnostics v_c1 = row_count;

  -- Caso 2: clique no painel que nunca virou sessao -> ESTORNA e marca falha.
  v_c2 := 0;
  for r in
    select cl.id           as log_id,
           a.id            as atend_id,
           a.charged       as charged,
           a.source        as source,
           a.tenant_id     as tenant_id,
           a.started_at    as started_at,
           irma.id         as irma_id,
           irma.tem_atend  as irma_tem_atend
      from public.connection_logs cl
      left join public.atendimentos a on a.connection_log_id = cl.id
      left join lateral (
        select s.id,
               exists (select 1 from public.atendimentos x where x.connection_log_id = s.id) as tem_atend
          from public.connection_logs s
         where s.rustdesk_id = cl.rustdesk_id
           and s.tenant_id = cl.tenant_id
           and s.technician_id = cl.technician_id
           and s.id <> cl.id
           and s.last_heartbeat_at is not null
           and s.session_start >= cl.session_start
           and s.session_start <= cl.session_start + interval '2 minutes'
         order by s.session_start
         limit 1
      ) irma on true
     where cl.status = 'active'
       and cl.last_heartbeat_at is null
       and cl.session_start < now() - interval '5 minutes'
  loop
    -- Clique repetido: a conexao aconteceu na ficha irma. Nada a estornar (a sessao
    -- existiu) nem atendimento a encerrar (ele segue com a sessao). O atendimento passa
    -- para a irma e a ficha esquecida some, em vez de aparecer como falha.
    if r.irma_id is not null and (r.atend_id is null or not r.irma_tem_atend) then
      if r.atend_id is not null then
        update public.atendimentos
           set connection_log_id = r.irma_id
         where id = r.atend_id;
      end if;
      delete from public.connection_logs where id = r.log_id;
      v_c2 := v_c2 + 1;
      continue;
    end if;

    -- Estorno do que este grant cobrou (espelha revoke_access_grant, mas preserva
    -- o log para auditoria). Reconexao nao tem atendimento proprio -> atend_id null.
    if r.atend_id is not null and r.charged then
      if r.source = 'credit'::public.atendimento_source then
        insert into public.credit_ledger (tenant_id, entry_type, credits, atendimento_id, note)
          values (r.tenant_id, 'refund'::public.credit_entry_type, 1, r.atend_id,
                  'estorno: sessao nunca confirmada');
      elsif r.source = 'free'::public.atendimento_source then
        update public.daily_access
           set used = greatest(used - 1, 0), updated_at = now()
         where tenant_id = r.tenant_id
           and access_date = (r.started_at at time zone 'America/Sao_Paulo')::date;
      end if;
    end if;

    -- Encerra o atendimento: sem sessao nao ha janela de reconexao a preservar.
    if r.atend_id is not null then
      update public.atendimentos
         set ended_at = coalesce(ended_at, now())
       where id = r.atend_id;
    end if;

    -- Marca o log como falha (auditoria do no-show).
    update public.connection_logs
       set status = 'failed',
           session_end = session_start,
           notes = coalesce(notes,'') || ' [auto-close: sessao nunca confirmada, cobranca estornada]'
     where id = r.log_id;

    v_c2 := v_c2 + 1;
  end loop;

  -- Caso 3 (B6): atendimento cuja JANELA de reconexao ja venceu -> encerra.
  update public.atendimentos
     set ended_at = window_expires_at
   where ended_at is null
     and window_expires_at <= now();
  get diagnostics v_c3 = row_count;

  return coalesce(v_c1,0) + coalesce(v_c2,0) + coalesce(v_c3,0);
end;
$function$;

-- ---------------------------------------------------------------------
-- 3. Passado: tira da Auditoria as falhas que eram clique repetido
-- ---------------------------------------------------------------------
-- Mesma regra da irma no cron. Em 27/10/2026: 90 fichas, 29 com atendimento (todos de
-- plano, nenhum cobrado), nenhuma irma com atendimento proprio.
do $$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select f.id as log_id,
           (select s.id
              from public.connection_logs s
             where s.rustdesk_id = f.rustdesk_id
               and s.tenant_id = f.tenant_id
               and s.technician_id = f.technician_id
               and s.id <> f.id
               and s.last_heartbeat_at is not null
               and s.session_start >= f.session_start
               and s.session_start <= f.session_start + interval '2 minutes'
             order by s.session_start
             limit 1) as irma_id
      from public.connection_logs f
     where f.status = 'failed'
       and f.technician_id is not null
  loop
    continue when r.irma_id is null;
    update public.atendimentos a
       set connection_log_id = r.irma_id
     where a.connection_log_id = r.log_id
       and not exists (select 1 from public.atendimentos x where x.connection_log_id = r.irma_id);
    delete from public.connection_logs where id = r.log_id;
    v_n := v_n + 1;
  end loop;
  raise notice 'clique repetido: % fichas de falha removidas', v_n;
end;
$$;
