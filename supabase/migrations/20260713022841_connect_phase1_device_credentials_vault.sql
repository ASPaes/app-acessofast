-- Fase 1 do connect: armazenamento seguro da senha do dispositivo via Supabase Vault.
-- device_credentials guarda apenas a REFERENCIA (UUID) do segredo no Vault; a senha em claro
-- so e acessivel por funcoes SECURITY DEFINER (dono=postgres). Frontend nunca le.

create table if not exists public.device_credentials (
  address_book_id uuid primary key references public.address_book(id) on delete cascade,
  secret_id       uuid not null,
  updated_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.device_credentials is
  'Referencia (UUID) do segredo no Vault com a senha permanente do dispositivo. Acesso apenas via RPC SECURITY DEFINER; frontend nao le.';

-- Trava total: RLS ligado, sem policies, revoke de todos os roles de API.
alter table public.device_credentials enable row level security;
revoke all on public.device_credentials from anon, authenticated, public;

-- Limpeza do segredo no Vault quando o vinculo e removido (ex.: dispositivo deletado via CASCADE).
create or replace function public.tg_device_credentials_cleanup_vault()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    delete from vault.secrets where id = old.secret_id;
  exception when others then
    null; -- best-effort: nunca bloquear a remocao do dispositivo por falha de limpeza
  end;
  return old;
end;
$$;

drop trigger if exists device_credentials_cleanup_vault on public.device_credentials;
create trigger device_credentials_cleanup_vault
  before delete on public.device_credentials
  for each row execute function public.tg_device_credentials_cleanup_vault();

-- Grava/atualiza a senha do dispositivo no Vault.
-- Autz: super_admin OU (admin/head do MESMO tenant do dispositivo). Tecnico nao gerencia credencial.
create or replace function public.set_device_credential(p_address_book_id uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_tenant uuid;
  v_caller_tenant uuid;
  v_caller_role   public.user_role;
  v_secret_id     uuid;
begin
  if p_password is null or length(trim(p_password)) = 0 then
    raise exception 'senha vazia';
  end if;

  select tenant_id into v_device_tenant from public.address_book where id = p_address_book_id;
  if v_device_tenant is null then
    raise exception 'dispositivo nao encontrado';
  end if;

  select tenant_id, role into v_caller_tenant, v_caller_role
    from public.profiles where id = auth.uid();
  if v_caller_role is null then
    raise exception 'perfil do chamador nao encontrado';
  end if;

  if not (
    v_caller_role = 'super_admin'
    or (v_caller_tenant = v_device_tenant and v_caller_role in ('admin','head'))
  ) then
    raise exception 'sem permissao para gerenciar a credencial deste dispositivo';
  end if;

  select secret_id into v_secret_id
    from public.device_credentials where address_book_id = p_address_book_id;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(p_password);
    insert into public.device_credentials(address_book_id, secret_id, updated_by)
      values (p_address_book_id, v_secret_id, auth.uid());
  else
    perform vault.update_secret(v_secret_id, p_password);
    update public.device_credentials
      set updated_by = auth.uid(), updated_at = now()
      where address_book_id = p_address_book_id;
  end if;
end;
$$;

revoke all on function public.set_device_credential(uuid, text) from public, anon;
grant execute on function public.set_device_credential(uuid, text) to authenticated;