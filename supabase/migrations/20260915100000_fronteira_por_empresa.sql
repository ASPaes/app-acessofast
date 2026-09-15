-- AcessoFast, 15/09/2026: Passo 3 (fronteira pelo controlador) passa a valer POR EMPRESA.
--
-- Pedido do usuario: deixar a observacao rodando, mas so nos computadores da ASP
-- SOFTWARES. Ate aqui a 20260914210000 classificava o controlador de toda sessao da
-- frota — em menos de um dia ja havia uma sessao de outra empresa (Consysa) gravada.
--
-- A CHAVE. tenant_settings.fronteira_modo:
--   off     (padrao) nada e gravado nem classificado
--   shadow  grava e classifica o controlador; nao corta, nao avisa
-- 'enforce' (cortar) NAO existe ainda de proposito: so entra depois de ler os numeros
-- do shadow. Quando entrar, e um valor a mais no CHECK e um ramo na session-ingest —
-- a chave por empresa ja fica pronta para o rollout empresa a empresa.
--
-- POR QUE GUARDA. A politica tenant_settings_update deixa o ADMIN da empresa editar a
-- propria linha. Sem guarda, quando existir o 'enforce', o admin de uma empresa poderia
-- desligar a fronteira que vale para ela. So super_admin e backend alteram — mesmo
-- desenho da private.guard_rotacao_modo, com as licoes de 11/09 (SECURITY DEFINER e um
-- IF por checagem, para o service_role nunca tocar em private).

alter table public.tenant_settings
  add column fronteira_modo text not null default 'off'
    check (fronteira_modo in ('off', 'shadow'));

comment on column public.tenant_settings.fronteira_modo is
  'Passo 3: off = nao observa; shadow = grava e classifica o controlador de cada sessao (connection_logs.controlador_status), sem cortar. So super_admin/backend alteram (trg_tenant_settings_guard_fronteira).';

create or replace function private.guard_fronteira_modo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  claims jsonb := auth.jwt();
begin
  if tg_op = 'UPDATE' and new.fronteira_modo is not distinct from old.fronteira_modo then
    return new;
  end if;
  if tg_op = 'INSERT' and new.fronteira_modo = 'off' then
    return new;
  end if;

  if claims is null then
    return new;
  end if;

  if coalesce(claims ->> 'role', '') = 'service_role' then
    return new;
  end if;

  if private.is_super_admin() then
    return new;
  end if;

  raise exception
    'Somente super_admin ou o backend (service_role) podem alterar a fronteira do controlador'
    using errcode = '42501';
end;
$fn$;

revoke all on function private.guard_fronteira_modo() from public, anon, authenticated;

create trigger trg_tenant_settings_guard_fronteira
  before insert or update of fronteira_modo
  on public.tenant_settings
  for each row execute function private.guard_fronteira_modo();

-- A RPC passa a respeitar a chave da empresa DONA da maquina acessada.
create or replace function public.registrar_controlador(
  p_connection_log_id      uuid,
  p_controller_rustdesk_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_ctrl      text := nullif(regexp_replace(coalesce(p_controller_rustdesk_id, ''), '\s', '', 'g'), '');
  v_tenant    uuid;
  v_modo      text;
  v_dev       uuid;
  v_dev_ten   uuid;
  v_dev_ativo boolean;
  v_status    text;
begin
  if v_ctrl is null or v_ctrl !~ '^[0-9]{6,20}$' then
    return null;
  end if;

  select cl.tenant_id, coalesce(ts.fronteira_modo, 'off')
    into v_tenant, v_modo
    from public.connection_logs cl
    left join public.tenant_settings ts on ts.tenant_id = cl.tenant_id
   where cl.id = p_connection_log_id
     and cl.controller_rustdesk_id is null;
  if not found or v_modo = 'off' then
    return null;
  end if;

  select ab.id, ab.tenant_id, ab.is_active
    into v_dev, v_dev_ten, v_dev_ativo
    from public.address_book ab
   where ab.rustdesk_id = v_ctrl
   limit 1;

  v_status := case
    when v_dev is null            then 'desconhecido'
    when v_dev_ativo is false     then 'inativo'
    when v_dev_ten = v_tenant     then 'mesma_empresa'
    else                               'outra_empresa'
  end;

  update public.connection_logs
     set controller_rustdesk_id = v_ctrl,
         controlador_status     = v_status,
         controlador_device_id  = v_dev,
         controlador_visto_em   = now()
   where id = p_connection_log_id
     and controller_rustdesk_id is null;

  return v_status;
end;
$fn$;

revoke all on function public.registrar_controlador(uuid, text) from public, anon, authenticated;
grant execute on function public.registrar_controlador(uuid, text) to service_role;

-- Liga para a ASP SOFTWARES.
update public.tenant_settings
   set fronteira_modo = 'shadow'
 where tenant_id = 'ebd17e4e-d158-4164-a235-e8fd53cbf895';

-- O que foi gravado fora do escopo entre 14/09 e agora (uma sessao da Consysa) sai:
-- a empresa nao entrou no experimento.
update public.connection_logs cl
   set controller_rustdesk_id = null,
       controlador_status     = null,
       controlador_device_id  = null,
       controlador_visto_em   = null
 where cl.controlador_status is not null
   and cl.tenant_id <> 'ebd17e4e-d158-4164-a235-e8fd53cbf895';
