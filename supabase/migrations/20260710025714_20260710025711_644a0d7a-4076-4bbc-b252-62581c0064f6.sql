-- =====================================================================
-- Acessofast — Migration 001 (base + site público)
-- =====================================================================
create extension if not exists pgcrypto;
create schema if not exists private;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('super_admin', 'admin', 'tech');
  end if;
end
$$;

create table if not exists public.tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  slug        text        unique,
  seat_limit  integer     not null default 1 check (seat_limit >= 0),
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  tenant_id   uuid        references public.tenants(id) on delete set null,
  role        public.user_role not null default 'tech',
  full_name   text,
  email       text,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_profiles_tenant_id on public.profiles(tenant_id);

create table if not exists public.address_book (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid        not null references public.tenants(id) on delete cascade,
  rustdesk_id   text        not null,
  alias         text,
  device_group  text,
  os            text,
  last_online   timestamptz,
  created_by    uuid        references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, rustdesk_id)
);
create index if not exists idx_address_book_tenant_id on public.address_book(tenant_id);

create or replace function private.current_tenant_id()
returns uuid language sql stable security definer set search_path = ''
as $$ select tenant_id from public.profiles where id = (select auth.uid()) $$;

create or replace function private.current_app_role()
returns public.user_role language sql stable security definer set search_path = ''
as $$ select role from public.profiles where id = (select auth.uid()) $$;

create or replace function private.is_super_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'super_admin'::public.user_role
  )
$$;

grant usage on schema private to authenticated;
grant execute on function private.current_tenant_id() to authenticated;
grant execute on function private.current_app_role() to authenticated;
grant execute on function private.is_super_admin()   to authenticated;

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'tech'::public.user_role)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.guard_profile_privileges()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  claims jsonb := auth.jwt();
begin
  if (new.role is distinct from old.role)
     or (new.tenant_id is distinct from old.tenant_id) then
    if claims is not null
       and coalesce(claims ->> 'role', '') <> 'service_role'
       and not private.is_super_admin() then
      raise exception
        'Somente super_admin ou o backend (service_role) podem alterar role/tenant_id';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_profile_privileges on public.profiles;
create trigger trg_guard_profile_privileges
  before update on public.profiles
  for each row execute function private.guard_profile_privileges();

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end; $$;

drop trigger if exists trg_tenants_updated_at on public.tenants;
create trigger trg_tenants_updated_at before update on public.tenants
  for each row execute function private.set_updated_at();

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

drop trigger if exists trg_address_book_updated_at on public.address_book;
create trigger trg_address_book_updated_at before update on public.address_book
  for each row execute function private.set_updated_at();

alter table public.tenants      enable row level security;
alter table public.profiles     enable row level security;
alter table public.address_book enable row level security;

drop policy if exists tenants_select on public.tenants;
create policy tenants_select on public.tenants for select to authenticated
using ( private.is_super_admin() or id = private.current_tenant_id() );

drop policy if exists tenants_insert on public.tenants;
create policy tenants_insert on public.tenants for insert to authenticated
with check ( private.is_super_admin() );

drop policy if exists tenants_update on public.tenants;
create policy tenants_update on public.tenants for update to authenticated
using ( private.is_super_admin() ) with check ( private.is_super_admin() );

drop policy if exists tenants_delete on public.tenants;
create policy tenants_delete on public.tenants for delete to authenticated
using ( private.is_super_admin() );

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using (
  private.is_super_admin()
  or id = (select auth.uid())
  or (private.current_app_role() = 'admin'::public.user_role
      and tenant_id = private.current_tenant_id())
);

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated
with check ( private.is_super_admin() );

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
using (
  private.is_super_admin()
  or id = (select auth.uid())
  or (private.current_app_role() = 'admin'::public.user_role
      and tenant_id = private.current_tenant_id())
)
with check (
  private.is_super_admin()
  or id = (select auth.uid())
  or (private.current_app_role() = 'admin'::public.user_role
      and tenant_id = private.current_tenant_id())
);

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles for delete to authenticated
using ( private.is_super_admin() );

drop policy if exists address_book_select on public.address_book;
create policy address_book_select on public.address_book for select to authenticated
using ( private.is_super_admin() or tenant_id = private.current_tenant_id() );

drop policy if exists address_book_insert on public.address_book;
create policy address_book_insert on public.address_book for insert to authenticated
with check ( private.is_super_admin() or tenant_id = private.current_tenant_id() );

drop policy if exists address_book_update on public.address_book;
create policy address_book_update on public.address_book for update to authenticated
using ( private.is_super_admin() or tenant_id = private.current_tenant_id() )
with check ( private.is_super_admin() or tenant_id = private.current_tenant_id() );

drop policy if exists address_book_delete on public.address_book;
create policy address_book_delete on public.address_book for delete to authenticated
using ( private.is_super_admin() or tenant_id = private.current_tenant_id() );

grant select, insert, update, delete on public.tenants      to authenticated;
grant select, insert, update, delete on public.profiles     to authenticated;
grant select, insert, update, delete on public.address_book to authenticated;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'lead_status') then
    create type public.lead_status as enum
      ('novo', 'em_contato', 'qualificado', 'ganho', 'perdido');
  end if;
end
$$;

create table if not exists public.leads (
  id           uuid primary key default gen_random_uuid(),
  name         text        not null,
  company      text,
  email        text        not null,
  phone        text,
  team_size    text,
  segment      text,
  message      text,
  consent      boolean     not null default false,
  status       public.lead_status not null default 'novo',
  source       text        not null default 'site',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint leads_email_format check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint leads_name_len     check (char_length(name) between 1 and 120),
  constraint leads_company_len  check (company is null or char_length(company) <= 160),
  constraint leads_message_len  check (message is null or char_length(message) <= 2000),
  constraint leads_consent_required check (consent is true)
);
create index if not exists idx_leads_created on public.leads(created_at desc);
create index if not exists idx_leads_status  on public.leads(status);

drop trigger if exists trg_leads_updated_at on public.leads;
create trigger trg_leads_updated_at before update on public.leads
  for each row execute function private.set_updated_at();

alter table public.leads enable row level security;

drop policy if exists leads_insert_public on public.leads;
create policy leads_insert_public on public.leads for insert to anon, authenticated
with check ( status = 'novo'::public.lead_status );

drop policy if exists leads_select_admin on public.leads;
create policy leads_select_admin on public.leads for select to authenticated
using ( private.is_super_admin() );

drop policy if exists leads_update_admin on public.leads;
create policy leads_update_admin on public.leads for update to authenticated
using ( private.is_super_admin() ) with check ( private.is_super_admin() );

drop policy if exists leads_delete_admin on public.leads;
create policy leads_delete_admin on public.leads for delete to authenticated
using ( private.is_super_admin() );

grant usage  on schema public to anon;
grant insert on public.leads   to anon;
grant select, insert, update, delete on public.leads to authenticated;

do $$
declare t text;
begin
  foreach t in array array['tenants','profiles','address_book','connection_logs'] loop
    if to_regclass('public.'||t) is not null then
      execute format('revoke all on public.%I from anon',   t);
      execute format('revoke all on public.%I from public', t);
    end if;
  end loop;
end
$$;

revoke all on schema private from anon;
revoke all on all functions in schema private from anon;

-- =====================================================================
-- Migration 002 — connection_logs
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'session_status') then
    create type public.session_status as enum ('active', 'ended', 'failed');
  end if;
end
$$;

create table if not exists public.connection_logs (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  address_book_id    uuid references public.address_book(id) on delete set null,
  rustdesk_id        text not null,
  technician_id      uuid references public.profiles(id) on delete set null,
  technician_email   text,
  status             public.session_status not null default 'active',
  session_start      timestamptz not null default now(),
  session_end        timestamptz,
  duration_seconds   integer generated always as (
                       case when session_end is not null
                         then extract(epoch from (session_end - session_start))::integer
                       end
                     ) stored,
  technician_ip      inet,
  notes              text,
  created_at         timestamptz not null default now()
);

create index if not exists idx_conn_logs_tenant       on public.connection_logs(tenant_id, session_start desc);
create index if not exists idx_conn_logs_technician   on public.connection_logs(technician_id);
create index if not exists idx_conn_logs_address_book on public.connection_logs(address_book_id);

alter table public.connection_logs enable row level security;

drop policy if exists conn_logs_select on public.connection_logs;
create policy conn_logs_select on public.connection_logs for select to authenticated
using (
  private.is_super_admin()
  or (private.current_app_role() = 'admin'::public.user_role
      and tenant_id = private.current_tenant_id())
  or technician_id = (select auth.uid())
);

drop policy if exists conn_logs_insert on public.connection_logs;
create policy conn_logs_insert on public.connection_logs for insert to authenticated
with check ( private.is_super_admin() );

grant select, insert on public.connection_logs to authenticated;

create or replace function private.purge_old_connection_logs(retention_days integer)
returns integer language plpgsql security definer set search_path = ''
as $$
declare removed integer;
begin
  delete from public.connection_logs
  where created_at < now() - make_interval(days => retention_days);
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on public.connection_logs from anon;
revoke all on public.connection_logs from public;

-- =====================================================================
-- Migration 003 — tabelas do SISTEMA
-- =====================================================================
alter table public.tenants
  add column if not exists relay_quota_gb integer not null default 0
  check (relay_quota_gb >= 0);

create table if not exists public.tenant_settings (
  tenant_id           uuid primary key references public.tenants(id) on delete cascade,
  display_name        text,
  timezone            text        not null default 'America/Sao_Paulo',
  log_retention_days  integer     not null default 180 check (log_retention_days between 1 and 3650),
  alert_email         text,
  notify_relay_quota  boolean     not null default true,
  prefs               jsonb       not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint tenant_settings_alert_email_fmt
    check (alert_email is null or alert_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);
drop trigger if exists trg_tenant_settings_updated_at on public.tenant_settings;
create trigger trg_tenant_settings_updated_at before update on public.tenant_settings
  for each row execute function private.set_updated_at();

create table if not exists public.features (
  key         text        primary key,
  name        text        not null,
  description text,
  is_default  boolean     not null default false,
  created_at  timestamptz not null default now()
);

insert into public.features (key, name, description, is_default) values
  ('session_recording',     'Gravação de sessão',        'Grava as sessões de suporte para auditoria.', false),
  ('advanced_address_book', 'Address book avançado',     'Grupos, tags e busca no address book.',       true),
  ('reports',               'Relatórios',                'Relatórios de sessões e produtividade.',      true),
  ('file_transfer',         'Transferência de arquivos', 'Envio/recebimento de arquivos na sessão.',    true)
on conflict (key) do nothing;

create table if not exists public.tenant_features (
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  feature_key text        not null references public.features(key) on delete cascade,
  enabled     boolean     not null default true,
  enabled_by  uuid        references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, feature_key)
);
drop trigger if exists trg_tenant_features_updated_at on public.tenant_features;
create trigger trg_tenant_features_updated_at before update on public.tenant_features
  for each row execute function private.set_updated_at();

create table if not exists public.vps_metrics (
  id               uuid        primary key default gen_random_uuid(),
  host             text        not null default 'relay-1',
  captured_at      timestamptz not null default now(),
  cpu_pct          numeric(5,2) check (cpu_pct  between 0 and 100),
  mem_pct          numeric(5,2) check (mem_pct  between 0 and 100),
  disk_pct         numeric(5,2) check (disk_pct between 0 and 100),
  net_rx_bytes     bigint,
  net_tx_bytes     bigint,
  active_sessions  integer     check (active_sessions >= 0),
  relay_mbps       numeric(10,2)
);
create index if not exists idx_vps_metrics_captured on public.vps_metrics(captured_at desc);

create or replace function private.purge_old_vps_metrics(retention_days integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  delete from public.vps_metrics where captured_at < now() - make_interval(days => retention_days);
  get diagnostics removed = row_count;
  return removed;
end;
$$;

alter table public.tenant_settings enable row level security;
alter table public.features        enable row level security;
alter table public.tenant_features enable row level security;
alter table public.vps_metrics     enable row level security;

drop policy if exists tenant_settings_select on public.tenant_settings;
create policy tenant_settings_select on public.tenant_settings for select to authenticated
using ( private.is_super_admin() or tenant_id = private.current_tenant_id() );

drop policy if exists tenant_settings_insert on public.tenant_settings;
create policy tenant_settings_insert on public.tenant_settings for insert to authenticated
with check (
  private.is_super_admin()
  or (private.current_app_role() = 'admin'::public.user_role
      and tenant_id = private.current_tenant_id())
);

drop policy if exists tenant_settings_update on public.tenant_settings;
create policy tenant_settings_update on public.tenant_settings for update to authenticated
using (
  private.is_super_admin()
  or (private.current_app_role() = 'admin'::public.user_role
      and tenant_id = private.current_tenant_id())
)
with check (
  private.is_super_admin()
  or (private.current_app_role() = 'admin'::public.user_role
      and tenant_id = private.current_tenant_id())
);

drop policy if exists tenant_settings_delete on public.tenant_settings;
create policy tenant_settings_delete on public.tenant_settings for delete to authenticated
using ( private.is_super_admin() );

drop policy if exists features_select on public.features;
create policy features_select on public.features for select to authenticated
using ( true );

drop policy if exists features_insert on public.features;
create policy features_insert on public.features for insert to authenticated
with check ( private.is_super_admin() );

drop policy if exists features_update on public.features;
create policy features_update on public.features for update to authenticated
using ( private.is_super_admin() ) with check ( private.is_super_admin() );

drop policy if exists features_delete on public.features;
create policy features_delete on public.features for delete to authenticated
using ( private.is_super_admin() );

drop policy if exists tenant_features_select on public.tenant_features;
create policy tenant_features_select on public.tenant_features for select to authenticated
using ( private.is_super_admin() or tenant_id = private.current_tenant_id() );

drop policy if exists tenant_features_insert on public.tenant_features;
create policy tenant_features_insert on public.tenant_features for insert to authenticated
with check ( private.is_super_admin() );

drop policy if exists tenant_features_update on public.tenant_features;
create policy tenant_features_update on public.tenant_features for update to authenticated
using ( private.is_super_admin() ) with check ( private.is_super_admin() );

drop policy if exists tenant_features_delete on public.tenant_features;
create policy tenant_features_delete on public.tenant_features for delete to authenticated
using ( private.is_super_admin() );

drop policy if exists vps_metrics_select on public.vps_metrics;
create policy vps_metrics_select on public.vps_metrics for select to authenticated
using ( private.is_super_admin() );

drop policy if exists vps_metrics_insert on public.vps_metrics;
create policy vps_metrics_insert on public.vps_metrics for insert to authenticated
with check ( private.is_super_admin() );

grant select, insert, update, delete on public.tenant_settings to authenticated;
grant select, insert, update, delete on public.features         to authenticated;
grant select, insert, update, delete on public.tenant_features  to authenticated;
grant select, insert                 on public.vps_metrics      to authenticated;

do $$
declare t text;
begin
  foreach t in array array['tenant_settings','features','tenant_features','vps_metrics'] loop
    execute format('revoke all on public.%I from anon',   t);
    execute format('revoke all on public.%I from public', t);
  end loop;
end $$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname='supabase_realtime' and schemaname='public' and tablename='vps_metrics'
     ) then
    execute 'alter publication supabase_realtime add table public.vps_metrics';
  end if;
end $$;