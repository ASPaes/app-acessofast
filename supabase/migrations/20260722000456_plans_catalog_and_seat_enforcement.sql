-- ===== CATÁLOGO DE PLANOS =====
create table public.plans (
  code                     text primary key,
  name                     text not null,
  price_month_cents        integer,
  price_year_cents         integer,
  max_users                integer,                 -- null = sob medida
  max_concurrent_per_tech  integer,                 -- null = ilimitado
  is_custom                boolean not null default false,
  is_active                boolean not null default true,
  sort_order               integer not null default 0,
  created_at               timestamptz not null default now()
);
alter table public.plans enable row level security;
create policy plans_select_authenticated on public.plans
  for select to authenticated using (true);          -- catálogo global explícito
create policy plans_write_superadmin on public.plans
  for all to authenticated
  using (private.is_super_admin()) with check (private.is_super_admin());

insert into public.plans (code,name,price_month_cents,price_year_cents,max_users,max_concurrent_per_tech,is_custom,sort_order) values
  ('team',      'AcessoFast Team',      24900,  298800,  10,   5,    false, 1),
  ('business',  'AcessoFast Business',  44900,  538800,  20,   10,   false, 2),
  ('scale',     'AcessoFast Scale',     89900,  1078800, 50,   null, false, 3),
  ('enterprise','AcessoFast Enterprise',null,   null,    null, null, true,  4);

-- ===== TENANT ↔ PLANO (valores efetivos) =====
alter table public.tenants
  add column plan_code               text references public.plans(code),
  add column max_concurrent_per_tech integer;        -- efetivo; null = ilimitado

-- ===== BACKSTOP: TETO DE USUÁRIOS =====
create or replace function public.enforce_seat_limit()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare v_limit integer; v_count integer;
begin
  if new.tenant_id is null or new.is_active = false then
    return new;                                       -- super_admin e inativos não contam
  end if;
  if tg_op = 'UPDATE' and old.is_active = true and old.tenant_id = new.tenant_id then
    return new;                                       -- update que não adiciona vaga
  end if;
  select seat_limit into v_limit from public.tenants where id = new.tenant_id;
  if v_limit is null then return new; end if;         -- ilimitado (enterprise)
  select count(*) into v_count from public.profiles
    where tenant_id = new.tenant_id and is_active = true and id <> new.id;
  if v_count >= v_limit then
    raise exception 'seat_limit_exceeded'
      using errcode='P0001',
            detail=format('tenant %s em %s/%s usuarios', new.tenant_id, v_count, v_limit);
  end if;
  return new;
end; $fn$;
revoke all on function public.enforce_seat_limit() from public, anon, authenticated;
create trigger trg_enforce_seat_limit
  before insert or update on public.profiles
  for each row execute function public.enforce_seat_limit();

-- ===== HELPER DE USO (painel) =====
create or replace function public.tenant_seat_usage(p_tenant uuid)
returns table(used integer, limit_users integer, can_add boolean)
language plpgsql security definer set search_path = '' as $fn$
begin
  if not private.is_super_admin() and (private.current_tenant_id() is distinct from p_tenant) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  return query
    select coalesce(count(p.id) filter (where p.is_active),0)::int,
           t.seat_limit,
           (t.seat_limit is null or coalesce(count(p.id) filter (where p.is_active),0) < t.seat_limit)
    from public.tenants t
    left join public.profiles p on p.tenant_id = t.id
    where t.id = p_tenant group by t.id, t.seat_limit;
end; $fn$;
revoke all on function public.tenant_seat_usage(uuid) from public, anon;
grant execute on function public.tenant_seat_usage(uuid) to authenticated;
