-- AcessoFast, 14/09/2026: Passo 2 do plano "Aposentar a Senha Rotativa" — senha
-- propria da maquina, definida pelo painel.
--
-- O QUE MUDA. Ate aqui so havia dois jeitos de a senha de uma maquina com agente
-- mudar: o agente sortear (rotacao) ou alguem gerar no painel e aplicar A MAO no
-- cliente (provision-device-secret). O segundo quebra a invariante da Fase 2 — o
-- painel passa a servir uma senha que o endpoint ainda nao tem, e ate alguem aplicar
-- todo Conectar falha.
--
-- O Passo 2 poe um terceiro jeito que preserva a invariante:
--   1. o super_admin digita a senha no painel (edge definir-senha-dispositivo);
--   2. ela fica AQUI, cifrada, como PEDIDO — nao em device_secrets. O Conectar
--      continua entregando a senha antiga, que e a que a maquina tem;
--   3. o proximo presence da maquina leva o pedido (session-ingest);
--   4. o agente aplica com --password e confirma pelo rotate-device-secret, com o
--      pedido_id. So nessa confirmacao a senha entra em device_secrets e o pedido some.
--
-- CANARIO. So super_admin pede (a edge confere), e so agente >= 2026.09.14 recebe
-- (a session-ingest confere). O resto da frota nem consulta esta tabela.
--
-- POR QUE UMA LINHA POR MAQUINA. Um pedido novo substitui o anterior: o que vale e a
-- ultima senha que alguem quis. Se o agente ja tinha aplicado o anterior, a
-- confirmacao dele ainda grava aquela senha em device_secrets (ela ESTA na maquina) —
-- so nao apaga o pedido novo, que sai no presence seguinte.

create table private.senha_pedida (
  device_id    uuid primary key
                 references public.address_book(id) on delete cascade,
  tenant_id    uuid not null
                 references public.tenants(id) on delete cascade,
  pedido_id    uuid not null,
  -- AES-256-GCM, mesmo contrato de device_secrets, com uma diferenca: AAD =
  -- 'senha_pedida:' || device_id. Assim um ciphertext de pedido copiado para
  -- device_secrets nao decifra — o Conectar nunca entregaria uma senha pedida como se
  -- ja estivesse na maquina.
  ciphertext   text not null,
  iv           text not null,
  key_version  smallint not null default 1,
  pedido_por   uuid references auth.users(id) on delete set null,
  pedido_em    timestamptz not null default now(),
  -- Maquina desligada recebe o pedido quando ligar, mas nao para sempre: uma senha
  -- que alguem digitou ha dias e ninguem lembra nao deve aparecer de surpresa.
  expira_em    timestamptz not null
);

comment on table private.senha_pedida is
  'Passo 2 (Aposentar a Senha Rotativa): senha pedida pelo painel e ainda NAO confirmada pela maquina. Cifrada (AAD senha_pedida:<device_id>). Acesso so pelas RPCs security definer em public, via service_role.';

alter table private.senha_pedida enable row level security;
revoke all on private.senha_pedida from public, anon, authenticated, service_role;

-- ---------- pedir (edge definir-senha-dispositivo) ----------
create or replace function public.pedir_senha_dispositivo(
  p_device_id   uuid,
  p_ciphertext  text,
  p_iv          text,
  p_key_version smallint,
  p_actor       uuid
)
returns table (pedido_id uuid, pedido_em timestamptz, expira_em timestamptz)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
begin
  select ab.tenant_id into v_tenant_id
    from public.address_book ab
   where ab.id = p_device_id;
  if v_tenant_id is null then
    raise exception 'dispositivo % nao encontrado em address_book', p_device_id;
  end if;
  if coalesce(p_ciphertext, '') = '' or coalesce(p_iv, '') = '' then
    raise exception 'ciphertext/iv vazios';
  end if;

  return query
  insert into private.senha_pedida as sp
    (device_id, tenant_id, pedido_id, ciphertext, iv, key_version, pedido_por, pedido_em, expira_em)
  values
    (p_device_id, v_tenant_id, gen_random_uuid(), p_ciphertext, p_iv,
     coalesce(p_key_version, 1), p_actor, now(), now() + interval '24 hours')
  on conflict (device_id) do update
    set pedido_id   = excluded.pedido_id,
        tenant_id   = excluded.tenant_id,
        ciphertext  = excluded.ciphertext,
        iv          = excluded.iv,
        key_version = excluded.key_version,
        pedido_por  = excluded.pedido_por,
        pedido_em   = excluded.pedido_em,
        expira_em   = excluded.expira_em
  returning sp.pedido_id, sp.pedido_em, sp.expira_em;
end;
$fn$;

-- ---------- puxar (session-ingest, no presence) ----------
-- So pedido vigente. Nao apaga nada: o pedido so sai quando a maquina CONFIRMA que
-- aplicou. Se o --password falhar, ou a resposta se perder, o presence seguinte leva
-- de novo.
create or replace function public.puxar_senha_pedida(p_device_id uuid)
returns table (pedido_id uuid, ciphertext text, iv text, key_version smallint)
language sql
stable
security definer
set search_path = ''
as $fn$
  select sp.pedido_id, sp.ciphertext, sp.iv, sp.key_version
    from private.senha_pedida sp
   where sp.device_id = p_device_id
     and sp.expira_em > now();
$fn$;

-- ---------- confirmar (rotate-device-secret, com pedido_id) ----------
-- Atomico: a senha que a maquina diz ter aplicado entra em device_secrets e o pedido
-- correspondente sai, na mesma transacao.
--
-- A senha e gravada MESMO SE o pedido nao existir mais (cancelado, expirado ou
-- substituido depois que o agente o puxou). O agente so confirma o que ja aplicou —
-- recusar aqui deixaria o painel servindo a senha antiga para uma maquina que nao a
-- aceita mais, exatamente a divergencia que este desenho existe para evitar.
--
-- Devolve true se casou com o pedido vigente. updated_by = quem pediu, para a
-- metrica origem_da_senha distinguir senha do painel de senha do agente (null).
create or replace function public.confirmar_senha_pedida(
  p_device_id   uuid,
  p_pedido_id   uuid,
  p_ciphertext  text,
  p_iv          text,
  p_key_version smallint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_casou boolean := false;
  v_actor uuid;
begin
  delete from private.senha_pedida sp
   where sp.device_id = p_device_id
     and sp.pedido_id = p_pedido_id
  returning true, sp.pedido_por into v_casou, v_actor;

  perform public.set_device_secret(p_device_id, p_ciphertext, p_iv, p_key_version, v_actor);

  return coalesce(v_casou, false);
end;
$fn$;

-- ---------- status e cancelar (edge definir-senha-dispositivo) ----------
create or replace function public.status_senha_pedida(p_device_id uuid)
returns table (
  pedido_id           uuid,
  pedido_em           timestamptz,
  expira_em           timestamptz,
  senha_atualizada_em timestamptz
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select sp.pedido_id, sp.pedido_em, sp.expira_em, ds.updated_at
    from (select p_device_id as device_id) alvo
    left join private.senha_pedida sp on sp.device_id = alvo.device_id
    left join private.device_secrets ds on ds.device_id = alvo.device_id;
$fn$;

create or replace function public.cancelar_senha_pedida(p_device_id uuid, p_pedido_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $fn$
  with apagado as (
    delete from private.senha_pedida sp
     where sp.device_id = p_device_id
       and sp.pedido_id = p_pedido_id
    returning 1
  )
  select exists (select 1 from apagado);
$fn$;

-- ---------- grants: so o backend ----------
revoke all on function public.pedir_senha_dispositivo(uuid, text, text, smallint, uuid) from public, anon, authenticated;
revoke all on function public.puxar_senha_pedida(uuid) from public, anon, authenticated;
revoke all on function public.confirmar_senha_pedida(uuid, uuid, text, text, smallint) from public, anon, authenticated;
revoke all on function public.status_senha_pedida(uuid) from public, anon, authenticated;
revoke all on function public.cancelar_senha_pedida(uuid, uuid) from public, anon, authenticated;

grant execute on function public.pedir_senha_dispositivo(uuid, text, text, smallint, uuid) to service_role;
grant execute on function public.puxar_senha_pedida(uuid) to service_role;
grant execute on function public.confirmar_senha_pedida(uuid, uuid, text, text, smallint) to service_role;
grant execute on function public.status_senha_pedida(uuid) to service_role;
grant execute on function public.cancelar_senha_pedida(uuid, uuid) to service_role;
