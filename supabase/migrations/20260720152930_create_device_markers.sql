-- Fase 1 — Marcadores (classificação filtrável). 100% aditivo.

-- Âncora p/ FK composta (integridade multi-tenant). (tenant_id, rustdesk_id) já existe; (tenant_id, id) não.
alter table public.address_book
  add constraint address_book_tenant_id_id_key unique (tenant_id, id);

-- 1) Vocabulário de marcadores, por tenant
create table public.device_markers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  label       text not null check (btrim(label) <> '' and char_length(label) <= 40),
  color       text check (color in ('slate','red','amber','green','blue','violet','pink','gray')),
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint device_markers_tenant_id_id_key unique (tenant_id, id)
);

-- dedup case-insensitive dentro do tenant
create unique index device_markers_tenant_label_uidx
  on public.device_markers (tenant_id, lower(label));

-- updated_at automático (mesma função do address_book)
create trigger trg_device_markers_updated_at
  before update on public.device_markers
  for each row execute function private.set_updated_at();

-- 2) Ligação N:N device <-> marcador
create table public.device_marker_assignments (
  tenant_id   uuid not null,
  device_id   uuid not null,
  marker_id   uuid not null,
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  primary key (device_id, marker_id),
  foreign key (tenant_id, device_id) references public.address_book(tenant_id, id)   on delete cascade,
  foreign key (tenant_id, marker_id) references public.device_markers(tenant_id, id) on delete cascade
);
create index device_marker_assignments_marker_idx on public.device_marker_assignments (marker_id);
create index device_marker_assignments_tenant_idx on public.device_marker_assignments (tenant_id);

-- RLS (mesmo padrão do address_book)
alter table public.device_markers            enable row level security;
alter table public.device_marker_assignments enable row level security;

revoke all on public.device_markers            from anon;
revoke all on public.device_marker_assignments from anon;
grant select, insert, update, delete on public.device_markers            to authenticated;
grant select, insert, delete         on public.device_marker_assignments to authenticated;

create policy device_markers_select on public.device_markers for select
  using (private.is_super_admin() or tenant_id = private.current_tenant_id());
create policy device_markers_insert on public.device_markers for insert
  with check (private.is_super_admin() or tenant_id = private.current_tenant_id());
create policy device_markers_update on public.device_markers for update
  using      (private.is_super_admin() or tenant_id = private.current_tenant_id())
  with check (private.is_super_admin() or tenant_id = private.current_tenant_id());
create policy device_markers_delete on public.device_markers for delete
  using (private.is_super_admin() or tenant_id = private.current_tenant_id());

create policy dma_select on public.device_marker_assignments for select
  using (private.is_super_admin() or tenant_id = private.current_tenant_id());
create policy dma_insert on public.device_marker_assignments for insert
  with check (private.is_super_admin() or tenant_id = private.current_tenant_id());
create policy dma_delete on public.device_marker_assignments for delete
  using (private.is_super_admin() or tenant_id = private.current_tenant_id());
