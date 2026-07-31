-- Favoritos por usuário (preferência pessoal; 1 favorito por par user+device)
create table public.device_favorites (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  device_id  uuid not null references public.address_book(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

-- Índice para o CASCADE quando um device é apagado (busca por device_id)
create index device_favorites_device_id_idx on public.device_favorites (device_id);

-- RLS: cada usuário só vê e mexe nos PRÓPRIOS favoritos
alter table public.device_favorites enable row level security;

create policy "device_favorites_select_own" on public.device_favorites
  for select using (user_id = auth.uid());

create policy "device_favorites_insert_own" on public.device_favorites
  for insert with check (user_id = auth.uid());

create policy "device_favorites_delete_own" on public.device_favorites
  for delete using (user_id = auth.uid());

-- Privilégios: só authenticated opera; anon nunca
revoke all on public.device_favorites from anon;
grant select, insert, delete on public.device_favorites to authenticated;
