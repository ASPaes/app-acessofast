-- AcessoFast, 28/10/2026: clique sem conexao sai da Auditoria, parte 2 (cron e passado).
--
-- Continua 20261028120000_cliques_sem_conexao, que cria a tabela. Fica em arquivo
-- separado porque apaga fichas de connection_logs, e o conector do Supabase recusa
-- DELETE sem uma confirmacao que o VS Code nao mostra: este vai colado no SQL Editor do
-- Supabase, depois da parte 1.

-- ---------------------------------------------------------------------
-- 1. Cron: o clique sem conexao vai para cliques_sem_conexao
-- ---------------------------------------------------------------------
-- Mesma funcao de 20261027170100_clique_repetido_limpeza; muda so o fim do Caso 2, que
-- marcava a ficha 'failed' e agora a move. O estorno e o fim do atendimento continuam
-- iguais. Apagar a ficha deixa atendimentos.connection_log_id nulo (on delete set null);
-- o atendimento ja esta encerrado e o vinculo fica guardado em atendimento_id.
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

  -- Caso 2: clique no painel que nunca virou sessao -> ESTORNA e tira da Auditoria.
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

    -- Estorno do que este grant cobrou (espelha revoke_access_grant, mas guarda o
    -- clique em cliques_sem_conexao). Reconexao nao tem atendimento proprio -> atend_id null.
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

    -- O clique nao foi sessao: sai de connection_logs (Auditoria) e fica guardado a parte.
    insert into public.cliques_sem_conexao
      (id, tenant_id, address_book_id, rustdesk_id, technician_id, technician_email,
       technician_ip, clicado_em, atendimento_id, estornado)
    select cl.id, cl.tenant_id, cl.address_book_id, cl.rustdesk_id, cl.technician_id,
           cl.technician_email, cl.technician_ip, cl.session_start, r.atend_id,
           coalesce(r.atend_id is not null and r.charged, false)
      from public.connection_logs cl
     where cl.id = r.log_id
    on conflict (id) do nothing;
    delete from public.connection_logs where id = r.log_id;

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
-- 2. Retencao: os cliques seguem a mesma retencao dos logs da empresa
-- ---------------------------------------------------------------------
-- Mesma funcao de 20260715230337_retention_cron_jobs, com o segundo delete.
create or replace function private.purge_connection_logs_por_tenant()
returns integer language plpgsql security definer set search_path to '' as $fn$
declare removed integer; removed_cliques integer;
begin
  delete from public.connection_logs cl
  using (
    select t.id as tenant_id, coalesce(ts.log_retention_days, 180) as dias
      from public.tenants t
      left join public.tenant_settings ts on ts.tenant_id = t.id
  ) cfg
  where cl.tenant_id = cfg.tenant_id
    and cl.created_at < now() - make_interval(days => cfg.dias);
  get diagnostics removed = row_count;

  delete from public.cliques_sem_conexao c
  using (
    select t.id as tenant_id, coalesce(ts.log_retention_days, 180) as dias
      from public.tenants t
      left join public.tenant_settings ts on ts.tenant_id = t.id
  ) cfg
  where c.tenant_id = cfg.tenant_id
    and c.clicado_em < now() - make_interval(days => cfg.dias);
  get diagnostics removed_cliques = row_count;

  return removed + removed_cliques;
end; $fn$;

-- ---------------------------------------------------------------------
-- 3. Passado: as fichas "falhou" que ainda estao em connection_logs
-- ---------------------------------------------------------------------
-- Em 28/10/2026: 325, todas de clique no painel, 114 com atendimento (4 cobrados). So
-- as fichas a partir de 26/09 (nota "cobranca estornada") tiveram o estorno; as
-- anteriores ficam com estornado = false.
do $$
declare
  v_n integer;
begin
  insert into public.cliques_sem_conexao
    (id, tenant_id, address_book_id, rustdesk_id, technician_id, technician_email,
     technician_ip, clicado_em, atendimento_id, estornado)
  select distinct on (cl.id)
         cl.id, cl.tenant_id, cl.address_book_id, cl.rustdesk_id, cl.technician_id,
         cl.technician_email, cl.technician_ip, cl.session_start, a.id,
         coalesce(a.charged and cl.notes like '%cobranca estornada%', false)
    from public.connection_logs cl
    left join public.atendimentos a on a.connection_log_id = cl.id
   where cl.status = 'failed'
   order by cl.id, a.started_at
  on conflict (id) do nothing;

  delete from public.connection_logs cl
   where cl.status = 'failed'
     and exists (select 1 from public.cliques_sem_conexao c where c.id = cl.id);
  get diagnostics v_n = row_count;
  raise notice 'clique sem conexao: % fichas movidas para cliques_sem_conexao', v_n;
end;
$$;
