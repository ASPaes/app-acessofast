-- Fundacao de rate limit: contador de janela fixa (private) + hit RPC atomico (public).
-- Consumido pelas Edge Functions publicas via db.rpc('rl_hit', ...).

create table if not exists private.rate_limit_counters (
  bucket_key   text        not null,
  window_start timestamptz not null,
  count        integer     not null default 0,
  primary key (bucket_key, window_start)
);

alter table private.rate_limit_counters enable row level security;
-- Sem policies = deny-all via PostgREST. rl_hit (SECURITY DEFINER, owner) bypassa.
revoke all on table private.rate_limit_counters from anon, authenticated;

create or replace function public.rl_hit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  -- Parametro invalido -> fail-open (permite). Rate limit e controle secundario; o nonce e a fronteira real.
  if p_key is null or p_key = '' or p_limit is null
     or p_window_seconds is null or p_window_seconds <= 0 then
    return true;
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into private.rate_limit_counters as rl (bucket_key, window_start, count)
  values (p_key, v_window_start, 1)
  on conflict (bucket_key, window_start)
  do update set count = rl.count + 1
  returning rl.count into v_count;

  return v_count <= p_limit;
end;
$fn$;

revoke all on function public.rl_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rl_hit(text, integer, integer) to service_role;
