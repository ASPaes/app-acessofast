-- device_claims: pedidos de adoção (handshake por nonce). Vive em private:
-- inacessível por anon/authenticated; toque só via service_role / RPCs SECURITY DEFINER.
create table if not exists private.device_claims (
  id                uuid primary key default gen_random_uuid(),
  rustdesk_id       text not null,
  nonce_hash        text not null,          -- SHA-256 hex do nonce (prova de posse do agente)
  agent_token_hash  text not null,          -- SHA-256 hex do token que o AGENTE gerou (token nunca vem)
  hostname          text,
  os                text,
  status            text not null default 'waiting'
                      check (status in ('waiting','approved','consumed','expired','rejected')),
  tenant_id         uuid references public.tenants(id)      on delete cascade,
  device_id         uuid references public.address_book(id) on delete set null,
  approved_by       uuid references public.profiles(id)     on delete set null,
  created_at        timestamptz not null default now(),
  approved_at       timestamptz,
  consumed_at       timestamptz,
  expires_at        timestamptz not null default (now() + interval '2 hours')
);

alter table private.device_claims enable row level security;   -- sem policies: private + RLS = fechado

create unique index if not exists device_claims_active_uk
  on private.device_claims (rustdesk_id, nonce_hash) where status in ('waiting','approved');
create index if not exists device_claims_lookup_idx  on private.device_claims (rustdesk_id, status);
create index if not exists device_claims_waiting_idx on private.device_claims (status, created_at desc);

-- claim_register: check-in do agente. Idempotente por (rustdesk_id, nonce_hash).
create or replace function public.claim_register(
  p_rustdesk_id text, p_nonce_hash text, p_agent_token_hash text,
  p_hostname text default null, p_os text default null
) returns uuid language plpgsql security definer set search_path = '' as $fn$
declare v_id uuid;
begin
  if p_rustdesk_id      !~ '^[0-9]{6,12}$'  then raise exception 'bad_rustdesk_id'; end if;
  if p_nonce_hash       !~ '^[0-9a-f]{64}$' then raise exception 'bad_nonce_hash';  end if;
  if p_agent_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'bad_token_hash';  end if;

  update private.device_claims set status='expired'
   where rustdesk_id=p_rustdesk_id and status in ('waiting','approved') and expires_at < now();

  select id into v_id from private.device_claims
   where rustdesk_id=p_rustdesk_id and nonce_hash=p_nonce_hash and status in ('waiting','approved') limit 1;
  if v_id is not null then return v_id; end if;

  insert into private.device_claims (rustdesk_id, nonce_hash, agent_token_hash, hostname, os)
  values (p_rustdesk_id, p_nonce_hash, p_agent_token_hash, left(p_hostname,120), left(p_os,60))
  returning id into v_id;
  return v_id;
end; $fn$;

-- claim_poll: o agente prova o nonce (hash já calculado no Edge) e descobre o estado.
-- approved -> consumed atômico (um vencedor). Não devolve segredo nenhum.
create or replace function public.claim_poll(
  p_rustdesk_id text, p_nonce_hash text
) returns text language plpgsql security definer set search_path = '' as $fn$
declare v_id uuid; v_status text; v_exp timestamptz;
begin
  if p_rustdesk_id !~ '^[0-9]{6,12}$' then return 'unknown'; end if;

  select id, status, expires_at into v_id, v_status, v_exp from private.device_claims
   where rustdesk_id=p_rustdesk_id and nonce_hash=p_nonce_hash order by created_at desc limit 1;
  if v_id is null then return 'unknown'; end if;

  if v_status in ('waiting','approved') and v_exp < now() then
    update private.device_claims set status='expired' where id=v_id;
    return 'expired';
  end if;

  if v_status = 'approved' then
    update private.device_claims set status='consumed', consumed_at=now()
     where id=v_id and status='approved';
    return 'approved';
  end if;
  return v_status;
end; $fn$;

-- Supabase auto-concede EXECUTE a anon em função nova -> revoga e tranca no service_role.
revoke all on function public.claim_register(text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.claim_poll(text,text)                     from public, anon, authenticated;
grant execute on function public.claim_register(text,text,text,text,text) to service_role;
grant execute on function public.claim_poll(text,text)                     to service_role;
