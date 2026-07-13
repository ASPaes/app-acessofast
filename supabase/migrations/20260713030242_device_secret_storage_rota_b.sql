-- =====================================================================
-- MIGRATION: device_secret_storage_rota_b
-- Remove o subsistema Rota A (Vault) e cria o da Rota B (AES-GCM na Edge Function)
-- =====================================================================

-- ---------- 1. DEMOLICAO DO SUBSISTEMA ROTA A (tudo vazio, 0 linhas) ----------
drop table    if exists public.device_credentials;                    -- leva o trigger junto
drop function if exists public.tg_device_credentials_cleanup_vault(); -- funcao do trigger, agora orfa
drop function if exists public.set_device_credential(uuid, text);     -- RPC de escrita da Rota A

-- ---------- 2. TABELA (schema private, NAO exposto pelo PostgREST) ----------
create table private.device_secrets (
  device_id    uuid primary key
                 references public.address_book(id) on delete cascade,
  tenant_id    uuid not null
                 references public.tenants(id) on delete cascade,
  ciphertext   text not null,   -- AES-256-GCM em base64. Inclui o auth tag. NUNCA texto claro.
  iv           text not null,   -- nonce de 12 bytes, base64, unico por cifragem
  key_version  smallint not null default 1,   -- rotacao de chave: qual chave cifrou esta linha
  created_by   uuid references auth.users(id) on delete set null,
  updated_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table private.device_secrets is 'Rota B: senha do dispositivo cifrada em AES-256-GCM na Edge Function (Deno). O banco guarda apenas ciphertext/iv opacos - nunca texto claro, nunca a chave. Acesso so via RPCs SECURITY DEFINER public.set_device_secret / get_device_secret (service_role).';

-- RLS ligado, SEM policies (nega anon/authenticated) e grants revogados dos papeis de API.
-- Sem FORCE de proposito: o owner (postgres) fica isento, entao as RPCs SECURITY DEFINER leem/gravam.
alter table private.device_secrets enable row level security;
revoke all on private.device_secrets from anon, authenticated, public;

-- ---------- 3. RPC DE ESCRITA (chamada pela Edge Function via service_role) ----------
create or replace function public.set_device_secret(
  p_device_id   uuid,
  p_ciphertext  text,
  p_iv          text,
  p_key_version smallint,
  p_actor       uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
begin
  -- deriva o tenant do proprio dispositivo - nunca confia em tenant vindo de fora
  select ab.tenant_id into v_tenant_id
    from public.address_book ab
   where ab.id = p_device_id;

  if v_tenant_id is null then
    raise exception 'dispositivo % nao encontrado em address_book', p_device_id;
  end if;

  if p_ciphertext is null or length(p_ciphertext) = 0
     or p_iv is null or length(p_iv) = 0 then
    raise exception 'ciphertext/iv vazios';
  end if;

  insert into private.device_secrets
    (device_id, tenant_id, ciphertext, iv, key_version, created_by, updated_by)
  values
    (p_device_id, v_tenant_id, p_ciphertext, p_iv, coalesce(p_key_version, 1), p_actor, p_actor)
  on conflict (device_id) do update
    set ciphertext  = excluded.ciphertext,
        iv          = excluded.iv,
        key_version = excluded.key_version,
        updated_by  = excluded.updated_by,
        updated_at  = now();
end;
$$;

-- ---------- 4. RPC DE LEITURA (chamada pela Edge Function apos validar authz) ----------
create or replace function public.get_device_secret(p_device_id uuid)
returns table (ciphertext text, iv text, key_version smallint)
language sql
security definer
set search_path = ''
as $$
  select ds.ciphertext, ds.iv, ds.key_version
    from private.device_secrets ds
   where ds.device_id = p_device_id;
$$;

-- ---------- 5. GRANTS: so service_role executa. Nada de anon/authenticated. ----------
revoke all on function public.set_device_secret(uuid, text, text, smallint, uuid) from public;
revoke all on function public.get_device_secret(uuid) from public;
grant execute on function public.set_device_secret(uuid, text, text, smallint, uuid) to service_role;
grant execute on function public.get_device_secret(uuid) to service_role;