-- tipo de documento
create type public.document_type as enum ('cnpj','cpf');

-- tabela de clientes (o "grupo" com identidade própria)
create table public.clients (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null,
  document      text,
  document_type public.document_type,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid default auth.uid()
);

-- documento coerente com o tipo
alter table public.clients add constraint clients_document_shape check (
  (document is null and document_type is null)
  or (document_type = 'cnpj' and document ~ '^[0-9]{14}$')
  or (document_type = 'cpf'  and document ~ '^[0-9]{11}$')
);

-- unicidade por tenant, só entre ativos
create unique index clients_tenant_name_uk
  on public.clients (tenant_id, lower(btrim(name))) where is_active;
create unique index clients_tenant_document_uk
  on public.clients (tenant_id, document) where document is not null and is_active;

-- updated_at automático (reusa a função existente)
create trigger trg_clients_updated_at before update on public.clients
  for each row execute function private.set_updated_at();

-- RLS espelhando address_book
alter table public.clients enable row level security;
create policy clients_select on public.clients for select to authenticated
  using (private.is_super_admin() or (tenant_id = private.current_tenant_id()));
create policy clients_insert on public.clients for insert to authenticated
  with check (private.is_super_admin() or (tenant_id = private.current_tenant_id()));
create policy clients_update on public.clients for update to authenticated
  using (private.is_super_admin() or (tenant_id = private.current_tenant_id()))
  with check (private.is_super_admin() or (tenant_id = private.current_tenant_id()));
create policy clients_delete on public.clients for delete to authenticated
  using (private.is_super_admin());
grant select, insert, update, delete on public.clients to authenticated;

-- vínculo no address_book (nullable; device sem cliente = null)
alter table public.address_book
  add column client_id uuid references public.clients(id) on delete set null;
create index address_book_client_id_idx on public.address_book (client_id);

-- backfill 1: 1 cliente por grupo distinto, por tenant
insert into public.clients (tenant_id, name)
select ab.tenant_id, btrim(ab.device_group)
from public.address_book ab
where ab.device_group is not null and btrim(ab.device_group) <> ''
group by ab.tenant_id, btrim(ab.device_group);

-- backfill 2: liga cada dispositivo ao seu cliente
update public.address_book ab
set client_id = c.id
from public.clients c
where c.tenant_id = ab.tenant_id
  and lower(btrim(c.name)) = lower(btrim(ab.device_group))
  and ab.device_group is not null and btrim(ab.device_group) <> '';
