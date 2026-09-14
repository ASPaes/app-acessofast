-- AcessoFast, 14/09/2026: dispositivo PRIVADO.
--
-- A REGRA (pedida pelo usuario). Admin da empresa ou super_admin pode marcar um
-- dispositivo como privado. Num dispositivo privado o TECNICO (e o head) nao recebe a
-- senha: o Conectar abre a conexao sem credencial, e ela so entra por aceite manual na
-- propria maquina — ou se o admin responsavel passar a senha a quem pediu. Admin e
-- super_admin seguem vendo a senha normalmente.
--
-- ONDE A REGRA E APLICADA. No servidor, nao na tela: a connect-device omite a senha e
-- a definir-senha-dispositivo recusa o tecnico (quem define a senha passa a conhece-la).
-- Sao os dois unicos caminhos por onde uma senha de dispositivo sai para um usuario.
--
-- POR QUE UM GATILHO. A politica address_book_update so confere o tenant, nao o papel
-- (buraco conhecido desde 11/09): sem guarda, o proprio tecnico desmarcaria o privado
-- pela API e voltaria a receber a senha. Mesmo desenho da private.guard_rotacao_modo,
-- ja com as licoes do incidente de 11/09: SECURITY DEFINER e cada checagem num IF
-- proprio, para o service_role nunca tocar em private.

alter table public.address_book
  add column privado     boolean not null default false,
  add column privado_por uuid references auth.users(id) on delete set null,
  add column privado_em  timestamptz;

comment on column public.address_book.privado is
  'Dispositivo privado: tecnico/head nao recebem a senha (connect-device omite; definir-senha-dispositivo recusa). So admin do tenant ou super_admin alteram (trg_address_book_guard_privado).';

create or replace function private.guard_dispositivo_privado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  claims  jsonb := auth.jwt();
  v_antes boolean := case when tg_op = 'UPDATE' then old.privado else false end;
begin
  -- Sem mudanca no privado: os campos de auditoria tambem nao mudam — ninguem forja
  -- quem marcou nem quando.
  if new.privado is not distinct from v_antes then
    if tg_op = 'UPDATE' then
      new.privado_por := old.privado_por;
      new.privado_em  := old.privado_em;
    else
      new.privado_por := null;
      new.privado_em  := null;
    end if;
    return new;
  end if;

  new.privado_por := auth.uid();
  new.privado_em  := now();

  -- SQL direto, sem JWT: migration, SQL editor.
  if claims is null then
    return new;
  end if;

  if coalesce(claims ->> 'role', '') = 'service_role' then
    return new;
  end if;

  if private.is_super_admin() then
    return new;
  end if;

  if private.current_app_role() = 'admin'::public.user_role
     and new.tenant_id = private.current_tenant_id() then
    return new;
  end if;

  raise exception
    'Somente o admin da empresa ou super_admin podem alterar a privacidade do dispositivo'
    using errcode = '42501';
end;
$fn$;

revoke all on function private.guard_dispositivo_privado() from public, anon, authenticated;

create trigger trg_address_book_guard_privado
  before insert or update of privado, privado_por, privado_em
  on public.address_book
  for each row execute function private.guard_dispositivo_privado();
