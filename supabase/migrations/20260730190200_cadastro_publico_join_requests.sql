-- Cadastro publico (auto-servico) a partir da tela de login.
--
-- Dois caminhos, decididos pelo CPF/CNPJ informado:
--   1. Documento desconhecido -> cria uma conta nova no plano individual
--      (mesmo caminho que o site comercial ja usa: signup_intents +
--      provision_from_intent + attach_trial_tenant).
--   2. Documento ja pertence a uma empresa -> cria o usuario SEM tenant e abre
--      uma solicitacao para o admin daquela empresa aprovar. Enquanto pendente
--      o usuario loga mas nao enxerga nada (profiles.tenant_id continua null).
--
-- PRIVACIDADE (LGPD): o documento em si nunca e gravado por este fluxo. A
-- identificacao usa o HMAC ja existente em private.trial_documents, a mesma
-- trava de "1 conta por documento" do site comercial. CNPJ tambem casa por
-- tenants.cnpj, para contas provisionadas antes dessa trava existir.
--
-- Toda escrita aqui e service_role-only: quem chama e a edge function, que ja
-- validou o solicitante. Isso tambem e o que permite mexer em
-- profiles.tenant_id/role sem esbarrar em private.guard_profile_privileges(),
-- que so libera super_admin e service_role (mesma razao da invite-user).

-- ---------------------------------------------------------------------------
-- 1. Tabela
-- ---------------------------------------------------------------------------

-- Guarda de idempotencia: esta migration foi aplicada direto no banco antes de
-- entrar no controle de migrations, entao o tipo e a tabela ja existem em prod.
-- Sem isto, o proximo `db push` morre aqui com "type already exists".
do $$
begin
  if not exists (select 1 from pg_type where typname = 'join_request_status') then
    create type public.join_request_status as enum ('pending', 'approved', 'rejected');
  end if;
end;
$$;

create table if not exists public.join_requests (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  -- Copia do nome da empresa no momento do pedido. O solicitante pendente tem
  -- profiles.tenant_id null, entao a RLS de tenants nao o deixa ler a linha da
  -- empresa — e abrir essa leitura exporia billing junto. Copiar o nome resolve
  -- a tela de espera sem alargar superficie.
  tenant_name   text,
  user_id       uuid not null references auth.users(id) on delete cascade,
  full_name     text,
  email         text not null,
  status        public.join_request_status not null default 'pending',
  decided_by    uuid references auth.users(id) on delete set null,
  decided_at    timestamptz,
  decided_role  public.user_role,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.join_requests is
  'Pedidos de acesso vindos do cadastro publico: alguem se cadastrou com o CPF/CNPJ de uma empresa que ja existe e espera aprovacao do admin dela.';

-- Um usuario nunca tem duas solicitacoes em aberto. Recusadas/aprovadas ficam
-- como historico e nao disputam esse indice.
create unique index if not exists uq_join_requests_pendente on public.join_requests (user_id)
  where status = 'pending';

create index if not exists ix_join_requests_tenant_status on public.join_requests (tenant_id, status);

alter table public.join_requests enable row level security;

-- Leitura: super_admin ve tudo; admin ve as da propria empresa; o solicitante
-- ve a dele (e ele quem precisa da tela "aguardando autorizacao"). O
-- solicitante pendente tem tenant_id null, entao so casa pelo user_id.
drop policy if exists join_requests_select on public.join_requests;
create policy join_requests_select on public.join_requests
  for select to authenticated
  using (
    private.is_super_admin()
    or user_id = (select auth.uid())
    or (
      tenant_id = private.current_tenant_id()
      and private.current_app_role() = 'admin'::public.user_role
    )
  );

-- Escrita so pelo backend. As RPCs abaixo sao a unica porta.
revoke all on public.join_requests from anon;
revoke all on public.join_requests from authenticated;
grant select on public.join_requests to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Guarda: "quem chama e o backend?"
-- ---------------------------------------------------------------------------

-- service_role (edge function) ou conexao sem JWT. Um usuario logado comum
-- nunca satisfaz isso.
create or replace function private.is_backend()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select (select auth.uid()) is null
      or coalesce(auth.jwt() ->> 'role', '') = 'service_role';
$$;

revoke all on function private.is_backend() from public;

-- ---------------------------------------------------------------------------
-- 3. Consulta do documento (usada pelo cadastro publico)
-- ---------------------------------------------------------------------------

-- Recebe o HMAC do documento e, quando for CNPJ, o CNPJ em digitos (o CNPJ e
-- dado publico da Receita e ja vive em tenants.cnpj; CPF jamais e passado
-- aqui). Devolve a empresa dona do documento, se houver.
--
-- doc_reservado = o HMAC ja esta em private.trial_documents porem sem tenant
-- associado (provisionamento que falhou no meio). Nesse caso nao da para criar
-- conta nova nem vincular: o cadastro devolve erro e o caso vira suporte.
create or replace function public.find_tenant_by_document(
  p_doc_hash text,
  p_cnpj     text default null
)
returns table (
  tenant_id     uuid,
  tenant_name   text,
  seat_limit    integer,
  active_users  integer,
  doc_reservado boolean
)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_tenant_id uuid;
  v_doc_existe boolean := false;
begin
  if not private.is_backend() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_doc_hash is null or length(p_doc_hash) < 32 then
    raise exception 'invalid_doc_hash' using errcode = '22023';
  end if;

  select true, td.tenant_id
    into v_doc_existe, v_tenant_id
    from private.trial_documents td
   where td.doc_hash = p_doc_hash
   limit 1;

  -- Contas antigas: o CNPJ foi gravado em tenants antes da trava por HMAC.
  if v_tenant_id is null and nullif(p_cnpj, '') is not null then
    select t.id into v_tenant_id
      from public.tenants t
     where t.cnpj = p_cnpj
     order by t.created_at
     limit 1;
  end if;

  if v_tenant_id is null then
    return query select null::uuid, null::text, null::integer, null::integer,
                        coalesce(v_doc_existe, false);
    return;
  end if;

  return query
    select t.id,
           t.name,
           t.seat_limit,
           (select count(*)::integer
              from public.profiles p
             where p.tenant_id = t.id and p.is_active),
           false
      from public.tenants t
     where t.id = v_tenant_id;
end;
$$;

revoke all on function public.find_tenant_by_document(text, text) from public;
revoke all on function public.find_tenant_by_document(text, text) from anon;
revoke all on function public.find_tenant_by_document(text, text) from authenticated;
grant execute on function public.find_tenant_by_document(text, text) to service_role;

-- Devolve um documento reservado que nunca virou empresa. Existe porque
-- claim_trial_document() e irreversivel: se o cadastro morre entre o claim e o
-- provisionamento (e-mail duplicado, por exemplo), sem isso o CPF/CNPJ ficaria
-- travado para sempre e a pessoa nunca mais conseguiria abrir conta. So apaga
-- reserva orfa — documento com empresa associada nunca e liberado.
create or replace function public.release_trial_document(p_doc_hash text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_n integer;
begin
  if not private.is_backend() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  delete from private.trial_documents
   where doc_hash = p_doc_hash and tenant_id is null;

  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

revoke all on function public.release_trial_document(text) from public;
revoke all on function public.release_trial_document(text) from anon;
revoke all on function public.release_trial_document(text) from authenticated;
grant execute on function public.release_trial_document(text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Abrir solicitacao
-- ---------------------------------------------------------------------------

-- Chamada logo apos a edge function criar o usuario. Refaz a checagem de vagas
-- dentro da transacao: entre o lookup e o submit alguem pode ter ocupado a
-- ultima cadeira.
create or replace function public.create_join_request(
  p_user_id   uuid,
  p_tenant_id uuid,
  p_full_name text default null,
  p_email     text default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_id     uuid;
  v_email  text;
  v_nome   text;
  v_seats  integer;
  v_usados integer;
begin
  if not private.is_backend() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select p.email into v_email from public.profiles p where p.id = p_user_id;
  if not found then
    raise exception 'perfil_inexistente' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.profiles p
              where p.id = p_user_id and p.tenant_id is not null) then
    raise exception 'usuario_ja_tem_empresa' using errcode = '42501';
  end if;

  select t.seat_limit, t.name into v_seats, v_nome
    from public.tenants t where t.id = p_tenant_id for update;
  if not found then
    raise exception 'empresa_inexistente' using errcode = 'P0002';
  end if;

  select count(*)::integer into v_usados
    from public.profiles p where p.tenant_id = p_tenant_id and p.is_active;
  if v_seats is not null and v_usados >= v_seats then
    raise exception 'sem_vagas' using errcode = 'P0001';
  end if;

  insert into public.join_requests (tenant_id, tenant_name, user_id, full_name, email)
  values (p_tenant_id, v_nome, p_user_id, nullif(p_full_name, ''),
          coalesce(nullif(p_email, ''), v_email))
  on conflict (user_id) where status = 'pending' do nothing
  returning id into v_id;

  if v_id is null then
    select jr.id into v_id from public.join_requests jr
     where jr.user_id = p_user_id and jr.status = 'pending';
  end if;

  return v_id;
end;
$$;

revoke all on function public.create_join_request(uuid, uuid, text, text) from public;
revoke all on function public.create_join_request(uuid, uuid, text, text) from anon;
revoke all on function public.create_join_request(uuid, uuid, text, text) from authenticated;
grant execute on function public.create_join_request(uuid, uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Aprovar / recusar
-- ---------------------------------------------------------------------------

-- p_actor e o admin que decidiu. Quem confere se ele pode decidir e a edge
-- function join-request (mesmo desenho da invite-user); aqui a checagem e
-- refeita para que a RPC nao dependa disso.
create or replace function public.approve_join_request(
  p_request_id uuid,
  p_role       public.user_role,
  p_actor      uuid
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_req    public.join_requests%rowtype;
  v_seats  integer;
  v_usados integer;
begin
  if not private.is_backend() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_role not in ('admin'::public.user_role, 'head'::public.user_role,
                    'tech'::public.user_role) then
    raise exception 'papel_invalido' using errcode = '22023';
  end if;

  select * into v_req from public.join_requests
   where id = p_request_id for update;
  if not found then
    raise exception 'solicitacao_inexistente' using errcode = 'P0002';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'solicitacao_ja_decidida' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.profiles p
     where p.id = p_actor
       and (p.role = 'super_admin'::public.user_role
            or (p.role = 'admin'::public.user_role and p.tenant_id = v_req.tenant_id))
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select t.seat_limit into v_seats
    from public.tenants t where t.id = v_req.tenant_id for update;
  select count(*)::integer into v_usados
    from public.profiles p where p.tenant_id = v_req.tenant_id and p.is_active;
  if v_seats is not null and v_usados >= v_seats then
    raise exception 'sem_vagas' using errcode = 'P0001';
  end if;

  update public.profiles
     set tenant_id = v_req.tenant_id,
         role = p_role,
         is_active = true,
         updated_at = now()
   where id = v_req.user_id;

  update public.join_requests
     set status = 'approved',
         decided_by = p_actor,
         decided_at = now(),
         decided_role = p_role,
         updated_at = now()
   where id = p_request_id;
end;
$$;

revoke all on function public.approve_join_request(uuid, public.user_role, uuid) from public;
revoke all on function public.approve_join_request(uuid, public.user_role, uuid) from anon;
revoke all on function public.approve_join_request(uuid, public.user_role, uuid) from authenticated;
grant execute on function public.approve_join_request(uuid, public.user_role, uuid) to service_role;

-- Recusar nao apaga o usuario: a conta fica sem empresa (portanto sem acesso) e
-- a pessoa pode pedir de novo pela propria tela de espera. Apagar liberaria o
-- e-mail para recadastro, mas perderia o rastro da recusa.
create or replace function public.reject_join_request(
  p_request_id uuid,
  p_actor      uuid
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_req public.join_requests%rowtype;
begin
  if not private.is_backend() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_req from public.join_requests
   where id = p_request_id for update;
  if not found then
    raise exception 'solicitacao_inexistente' using errcode = 'P0002';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'solicitacao_ja_decidida' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.profiles p
     where p.id = p_actor
       and (p.role = 'super_admin'::public.user_role
            or (p.role = 'admin'::public.user_role and p.tenant_id = v_req.tenant_id))
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.join_requests
     set status = 'rejected',
         decided_by = p_actor,
         decided_at = now(),
         updated_at = now()
   where id = p_request_id;
end;
$$;

revoke all on function public.reject_join_request(uuid, uuid) from public;
revoke all on function public.reject_join_request(uuid, uuid) from anon;
revoke all on function public.reject_join_request(uuid, uuid) from authenticated;
grant execute on function public.reject_join_request(uuid, uuid) to service_role;

-- Reabrir: o proprio usuario recusado pede de novo, para a mesma empresa da
-- ultima solicitacao. Nao aceita se a empresa estiver lotada.
create or replace function public.reopen_join_request(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_tenant uuid;
begin
  if not private.is_backend() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles p
              where p.id = p_user_id and p.tenant_id is not null) then
    raise exception 'usuario_ja_tem_empresa' using errcode = '42501';
  end if;
  if exists (select 1 from public.join_requests jr
              where jr.user_id = p_user_id and jr.status = 'pending') then
    raise exception 'solicitacao_ja_pendente' using errcode = 'P0001';
  end if;

  select jr.tenant_id into v_tenant
    from public.join_requests jr
   where jr.user_id = p_user_id
   order by jr.created_at desc
   limit 1;
  if v_tenant is null then
    raise exception 'sem_solicitacao_anterior' using errcode = 'P0002';
  end if;

  return public.create_join_request(p_user_id, v_tenant, null, null);
end;
$$;

revoke all on function public.reopen_join_request(uuid) from public;
revoke all on function public.reopen_join_request(uuid) from anon;
revoke all on function public.reopen_join_request(uuid) from authenticated;
grant execute on function public.reopen_join_request(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Limpeza
-- ---------------------------------------------------------------------------

-- Solicitacoes decididas ha mais de 90 dias viram ruido. A conta do usuario
-- recusado continua existindo (sem empresa, sem acesso) — some so o registro
-- do pedido.
create or replace function public.purge_old_join_requests()
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_n integer;
begin
  delete from public.join_requests
   where status <> 'pending'
     and decided_at < now() - interval '90 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.purge_old_join_requests() from public;
revoke all on function public.purge_old_join_requests() from anon;
revoke all on function public.purge_old_join_requests() from authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'purge-join-requests',
      '17 4 * * *',
      $cron$select public.purge_old_join_requests();$cron$
    );
  else
    raise notice 'pg_cron ausente: agende public.purge_old_join_requests() manualmente.';
  end if;
end;
$$;
