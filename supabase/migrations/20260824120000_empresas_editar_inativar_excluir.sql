-- Empresas: editar cadastro, ligar/desligar a conta e excluir de vez.
--
-- Ate aqui a tela /empresas so sabia criar e trocar de plano. Corrigir um CNPJ
-- digitado errado, desligar um cliente que saiu ou apagar uma conta de teste
-- exigia ir ao banco na mao — e as tres coisas sao operacao normal de quem
-- administra a plataforma.
--
-- As tres entram como RPC em vez de UPDATE/DELETE direto pelo PostgREST: a
-- policy de tenants ja deixaria o super_admin escrever a linha inteira, e um
-- formulario com acesso a billing_status, plan_code e asaas_subscription_id e
-- convite para desfazer sem querer o que a cobranca combinou.

-- ---------------------------------------------------------------------------
-- 1) Cadastro: nome, documento e e-mail de cobranca.
-- ---------------------------------------------------------------------------
create or replace function public.update_tenant(
  p_tenant        uuid,
  p_name          text,
  p_cnpj          text default null,
  p_billing_email text default null
) returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_name  text := btrim(coalesce(p_name, ''));
  v_doc   text := nullif(regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g'), '');
  v_email text := lower(nullif(btrim(coalesce(p_billing_email, '')), ''));
begin
  if not private.is_super_admin() then
    raise exception 'forbidden: somente super_admin' using errcode = '42501';
  end if;

  if not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'empresa_nao_encontrada' using errcode = 'P0002';
  end if;

  if v_name = '' then
    raise exception 'nome_obrigatorio' using errcode = '22023';
  end if;

  -- So comprimento e unicidade. O digito verificador e conferido na tela, que
  -- sabe se o documento mudou nesta edicao; aqui uma regra mais dura travaria
  -- de vez as contas antigas que entraram com CNPJ invalido antes da checagem.
  if v_doc is not null and length(v_doc) not in (11, 14) then
    raise exception 'documento_invalido' using errcode = '22023',
      detail = 'informe 11 digitos (CPF) ou 14 (CNPJ)';
  end if;

  if v_doc is not null and exists (
    select 1 from public.tenants t where t.cnpj = v_doc and t.id <> p_tenant
  ) then
    raise exception 'documento_em_uso' using errcode = '23505',
      detail = 'outra empresa ja esta cadastrada com este documento';
  end if;

  if v_email is not null
     and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'email_invalido' using errcode = '22023';
  end if;

  update public.tenants
     set name          = v_name,
         cnpj          = v_doc,
         billing_email = v_email,
         updated_at    = now()
   where id = p_tenant;
end;
$$;

comment on function public.update_tenant(uuid, text, text, text) is
  'Super admin corrige o cadastro da empresa (nome, documento, e-mail de cobranca). Nao toca em plano nem em cobranca.';

revoke execute on function public.update_tenant(uuid, text, text, text) from public, anon;
grant  execute on function public.update_tenant(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Ligar/desligar a conta.
-- ---------------------------------------------------------------------------
create or replace function public.set_tenant_active(
  p_tenant uuid,
  p_active boolean
) returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not private.is_super_admin() then
    raise exception 'forbidden: somente super_admin' using errcode = '42501';
  end if;

  -- Desligar a propria empresa tirando o chao de quem esta logado e o mesmo
  -- erro que set_user_active ja nao deixa cometer.
  if p_active is false and p_tenant = private.current_tenant_id() then
    raise exception 'nao_pode_inativar_a_propria_empresa' using errcode = '42501';
  end if;

  if not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'empresa_nao_encontrada' using errcode = 'P0002';
  end if;

  update public.tenants
     set is_active = p_active, updated_at = now()
   where id = p_tenant;
end;
$$;

comment on function public.set_tenant_active(uuid, boolean) is
  'Liga/desliga a empresa. Conta inativa nao abre atendimento novo (ver create_access_grant).';

revoke execute on function public.set_tenant_active(uuid, boolean) from public, anon;
grant  execute on function public.set_tenant_active(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Conta inativa precisa impedir alguma coisa.
--
-- tenants.is_active existia so como rotulo na lista: quem bloqueava conexao era
-- billing_status. Um botao "Inativar" que nao inativa nada e pior que nao ter
-- botao, entao a trava entra no mesmo ponto em que a cobranca ja barra — e com
-- a mesma excecao, porque o super_admin precisa entrar para dar suporte
-- justamente na conta que ele acabou de desligar.
--
-- O resto do corpo e identico a versao anterior (20260728175223 em diante).
-- ---------------------------------------------------------------------------
create or replace function public.create_access_grant(
  p_device_id uuid,
  p_actor uuid,
  p_technician_email text default null::text,
  p_technician_ip text default null::text,
  p_source text default null::text
)
returns table(grant_id uuid, tenant_id uuid, rustdesk_id text, effective_limit integer,
              active_before integer, source text, atendimento_id uuid, charged boolean)
language plpgsql
security definer
set search_path to ''
as $function$
#variable_conflict use_column
declare
  v_tenant uuid; v_rid text; v_active boolean; v_role public.user_role;
  v_plan text; v_limit integer; v_count integer; v_ip inet;
  v_mode public.billing_mode; v_status public.billing_status;
  v_today date; v_free_used int; v_free_cap int; v_free_remaining int;
  v_balance int; v_atend public.atendimentos%rowtype;
  v_source public.atendimento_source; v_window interval; v_hardcap timestamptz;
  v_new_atend uuid; v_charged boolean := false; v_is_individual boolean;
  v_tenant_ativa boolean;
begin
  if p_actor is null then raise exception 'actor_obrigatorio'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_actor::text, 0));

  select ab.tenant_id, ab.rustdesk_id, ab.is_active
    into v_tenant, v_rid, v_active
    from public.address_book ab where ab.id = p_device_id;
  if v_tenant is null then raise exception 'device_not_found'; end if;
  if v_active is false then raise exception 'device_inativo'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text, 42));

  select pr.role into v_role from public.profiles pr where pr.id = p_actor;

  select t.max_concurrent_per_tech, t.plan_code, t.billing_mode, t.billing_status, t.is_active
    into v_limit, v_plan, v_mode, v_status, v_tenant_ativa
    from public.tenants t where t.id = v_tenant;
  if v_limit is null and v_plan is not null then
    select pl.max_concurrent_per_tech into v_limit
      from public.plans pl where pl.code = v_plan;
  end if;

  if v_role is distinct from 'super_admin'::public.user_role
     and v_tenant_ativa is false then
    raise exception 'conta_inativa'
      using errcode = 'P0001', detail = 'a empresa esta inativa';
  end if;

  if v_role is distinct from 'super_admin'::public.user_role
     and v_status in ('blocked_trial'::public.billing_status, 'blocked_billing'::public.billing_status) then
    raise exception 'billing_blocked'
      using errcode = 'P0001', detail = format('conta bloqueada (%s)', v_status);
  end if;

  select count(distinct cl.rustdesk_id)::int into v_count
    from public.connection_logs cl
   where cl.tenant_id = v_tenant
     and cl.status = 'active'::public.session_status
     and cl.rustdesk_id <> v_rid;

  begin v_ip := nullif(p_technician_ip, '')::inet; exception when others then v_ip := null; end;

  if v_role is distinct from 'super_admin'::public.user_role
     and v_limit is not null and v_count >= v_limit then
    raise exception 'quota_exceeded'
      using errcode = 'P0001',
            detail  = format('limite de %s sessao(oes) simultanea(s) do tenant atingido', v_limit);
  end if;

  select * into v_atend
    from public.atendimentos a
   where a.rustdesk_id = v_rid
     and a.ended_at is null and a.window_expires_at > now()
   order by a.started_at desc limit 1;
  if found then
    insert into public.connection_logs
      (tenant_id, address_book_id, rustdesk_id, technician_id, technician_email, technician_ip, status, session_start)
    values
      (v_tenant, p_device_id, v_rid, p_actor, p_technician_email, v_ip, 'active'::public.session_status, now())
    returning id into grant_id;
    tenant_id := v_tenant; rustdesk_id := v_rid; effective_limit := v_limit;
    active_before := v_count; source := v_atend.source::text;
    atendimento_id := v_atend.id; charged := false;
    return next; return;
  end if;

  if v_role = 'super_admin'::public.user_role then
    v_source := 'plan'::public.atendimento_source;
    v_window := interval '3 hours'; v_hardcap := null; v_charged := false;
  elsif v_mode = 'plan'::public.billing_mode then
    v_source := 'plan'::public.atendimento_source;
    v_window := interval '3 hours'; v_hardcap := null; v_charged := false;
  else
    v_today := (now() at time zone 'America/Sao_Paulo')::date;
    select da.used, da.cap into v_free_used, v_free_cap
      from public.daily_access da
     where da.tenant_id = v_tenant and da.access_date = v_today;
    v_free_remaining := greatest(coalesce(v_free_cap, 5) - coalesce(v_free_used, 0), 0);

    select coalesce(sum(c.credits), 0)::int into v_balance
      from public.credit_ledger c where c.tenant_id = v_tenant;

    v_is_individual := (v_count = 0);

    if p_source = 'free' then
      if not v_is_individual then raise exception 'free_requires_individual' using errcode = 'P0001'; end if;
      if v_free_remaining <= 0 then raise exception 'free_exhausted' using errcode = 'P0001'; end if;
      v_source := 'free'::public.atendimento_source;
    elsif p_source = 'credit' then
      if v_balance <= 0 then raise exception 'no_credits' using errcode = 'P0001'; end if;
      v_source := 'credit'::public.atendimento_source;
    else
      if v_is_individual and v_free_remaining > 0 and v_balance > 0 then
        raise exception 'choice_required' using errcode = 'P0001';
      elsif v_is_individual and v_free_remaining > 0 then
        v_source := 'free'::public.atendimento_source;
      elsif v_balance > 0 then
        v_source := 'credit'::public.atendimento_source;
      else
        raise exception 'no_credits' using errcode = 'P0001';
      end if;
    end if;

    if v_source = 'free'::public.atendimento_source then
      v_window := interval '2 hours'; v_hardcap := now() + interval '2 hours';
      insert into public.daily_access (tenant_id, access_date, used, cap)
        values (v_tenant, v_today, 1, coalesce(v_free_cap, 5))
        on conflict (tenant_id, access_date)
        do update set used = daily_access.used + 1, updated_at = now();
      v_charged := true;
    else
      v_window := interval '3 hours'; v_hardcap := null; v_charged := true;
    end if;
  end if;

  insert into public.connection_logs
    (tenant_id, address_book_id, rustdesk_id, technician_id, technician_email, technician_ip, status, session_start)
  values
    (v_tenant, p_device_id, v_rid, p_actor, p_technician_email, v_ip, 'active'::public.session_status, now())
  returning id into grant_id;

  insert into public.atendimentos
    (tenant_id, technician_id, address_book_id, rustdesk_id, source, connection_log_id,
     started_at, window_expires_at, hard_cap_at, charged)
  values
    (v_tenant, p_actor, p_device_id, v_rid, v_source, grant_id,
     now(), now() + v_window, v_hardcap, v_charged)
  returning id into v_new_atend;

  if v_source = 'credit'::public.atendimento_source then
    insert into public.credit_ledger (tenant_id, entry_type, credits, atendimento_id, note)
      values (v_tenant, 'consume'::public.credit_entry_type, -1, v_new_atend, 'consumo de atendimento');
  end if;

  tenant_id := v_tenant; rustdesk_id := v_rid; effective_limit := v_limit;
  active_before := v_count; source := v_source::text;
  atendimento_id := v_new_atend; charged := v_charged;
  return next;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4) Excluir a empresa.
--
-- Exclusao de verdade: a FK de tenants leva junto dispositivos, logs,
-- atendimentos, clientes, creditos e integracoes. O que ela NAO levaria e o que
-- esta funcao resolve na mao:
--
--   * profiles fica com tenant_id = NULL (ON DELETE SET NULL), o que deixaria
--     um usuario orfao ainda capaz de entrar no painel. Some junto com a conta
--     de login em auth.users, que e de onde profiles cascateia.
--   * private.trial_documents tambem e SET NULL e o hash do documento continua
--     reservado — o CNPJ da empresa apagada nunca mais conseguiria se cadastrar.
--   * signup_intents e NO ACTION e barraria o DELETE com erro de FK.
--
-- A porta e estreita de proposito: so empresa ja inativa, nome digitado igual,
-- e nunca a propria empresa nem uma que abrigue super_admin.
-- ---------------------------------------------------------------------------
create or replace function public.delete_tenant(
  p_tenant       uuid,
  p_confirm_name text
) returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_name    text;
  v_active  boolean;
  v_logins  uuid[];
begin
  if not private.is_super_admin() then
    raise exception 'forbidden: somente super_admin' using errcode = '42501';
  end if;

  if p_tenant = private.current_tenant_id() then
    raise exception 'nao_pode_excluir_a_propria_empresa' using errcode = '42501';
  end if;

  select t.name, t.is_active into v_name, v_active
    from public.tenants t where t.id = p_tenant;
  if v_name is null then
    raise exception 'empresa_nao_encontrada' using errcode = 'P0002';
  end if;

  -- Inativar primeiro nao e burocracia: e a chance de perceber que a conta
  -- errada foi escolhida, com o sistema ainda inteiro para desfazer.
  if v_active then
    raise exception 'empresa_ativa' using errcode = '42501',
      detail = 'inative a empresa antes de excluir';
  end if;

  if btrim(coalesce(p_confirm_name, '')) is distinct from btrim(v_name) then
    raise exception 'confirmacao_nao_confere' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.profiles p
     where p.tenant_id = p_tenant
       and p.role = 'super_admin'::public.user_role
  ) then
    raise exception 'empresa_com_super_admin' using errcode = '42501',
      detail = 'mova o super admin para outra empresa antes de excluir';
  end if;

  -- Guardado antes do DELETE: depois dele profiles.tenant_id ja e NULL e nao ha
  -- mais como saber quem era desta empresa.
  select coalesce(array_agg(p.id), '{}') into v_logins
    from public.profiles p where p.tenant_id = p_tenant;

  delete from private.trial_documents td where td.tenant_id = p_tenant;
  delete from public.signup_intents  si where si.tenant_id = p_tenant;

  -- A empresa sai primeiro: apagar o tecnico antes esbarraria em
  -- atendimentos.technician_id, que e NO ACTION e so some junto com o tenant.
  delete from public.tenants t where t.id = p_tenant;

  begin
    delete from auth.users u where u.id = any(v_logins);
  exception when foreign_key_violation then
    -- Acontece quando o usuario assinou algo fora da propria empresa (criou um
    -- cupom, lancou credito): esses registros sao NO ACTION de proposito, para
    -- nao apagar historico alheio. Levantar aqui desfaz a funcao inteira — a
    -- empresa continua de pe, que e melhor que sumir pela metade.
    raise exception 'usuario_com_historico' using errcode = '23503',
      detail = 'um dos logins tem registro em historico compartilhado (cupom, credito) e precisa ser tratado a mao; nada foi excluido';
  end;
end;
$$;

comment on function public.delete_tenant(uuid, text) is
  'Exclui a empresa inativa, os logins dela e a reserva de documento. Exige o nome digitado igual.';

revoke execute on function public.delete_tenant(uuid, text) from public, anon;
grant  execute on function public.delete_tenant(uuid, text) to authenticated;
