-- ---------------------------------------------------------------------------
-- Liberar versão nova do agente e do app pelo painel (tela Atualizações).
--
-- Pedido do Ryan (22/10/2026): um botão só para super admin (Ryan, Luiz, Alexandre) para
-- atualizar todas as máquinas quando sai versão nova, sem depender de SQL feito à mão.
--
-- Do jeito que a 20260812120000_agent_auto_update deixou combinado: escrever o alvo é mandar
-- código rodar como SYSTEM em máquina de cliente, então NÃO existe grant de escrita nas tabelas
-- de política nem nas colunas de alvo. A tela entra por RPC security definer que confere o
-- super_admin. E o alvo só aceita versão do catálogo (agent_releases / client_releases), que é
-- assinada no CI: o agente recusa binário sem assinatura válida.
--
-- Duas ações por produto, na ordem da casa (ATUALIZACAO-FROTA.md §4.2):
--   testar_versao   fixa a versão num computador (address_book.*_target_version);
--   liberar_versao  muda o alvo global e, por padrão, solta as versões fixadas.
-- Toda ação fica registrada em liberacoes_versao (quem, quando, de qual para qual).
-- ---------------------------------------------------------------------------

create table if not exists public.liberacoes_versao (
  id           bigint generated always as identity primary key,
  produto      text not null check (produto in ('agente', 'app')),
  versao       text,                      -- null = tirou a versão de teste do computador
  anterior     text,
  alcance      text not null check (alcance in ('todas', 'computador')),
  device_id    uuid references public.address_book(id) on delete set null,
  liberado_por uuid references auth.users(id) on delete set null,
  liberado_em  timestamptz not null default now()
);

comment on table public.liberacoes_versao is
  'Histórico das liberações de versão feitas pela tela Atualizações (só super_admin). '
  'Escrita só pelas funções liberar_versao / testar_versao.';

alter table public.liberacoes_versao enable row level security;
grant select on public.liberacoes_versao to authenticated;
drop policy if exists liberacoes_versao_select_super on public.liberacoes_versao;
create policy liberacoes_versao_select_super on public.liberacoes_versao
  for select to authenticated using (private.is_super_admin());

-- Super admin ATIVO: private.is_super_admin() não olha is_active, e um acesso desativado não
-- pode continuar liberando versão para a frota.
create or replace function private.super_admin_ativo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.profiles
     where id = (select auth.uid())
       and role = 'super_admin'::public.user_role
       and coalesce(is_active, true)
  )
$fn$;

revoke all on function private.super_admin_ativo() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Leitura da tela: tudo numa ida ao banco, para os dois produtos.
-- frota = máquinas ativas vistas nos últimos 7 dias, agrupadas pela versão que rodam.
-- ---------------------------------------------------------------------------
create or replace function public.atualizacoes_resumo()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  r jsonb;
begin
  if not private.super_admin_ativo() then
    raise exception 'Somente a equipe AcessoFast (super_admin) vê as atualizações' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'agente', jsonb_build_object(
      'alvo', (select pol.target_version from public.agent_update_policy pol where pol.id),
      'versoes', coalesce((
        select jsonb_agg(jsonb_build_object('versao', v.version, 'criada_em', v.created_at) order by v.created_at desc)
          from (select version, created_at from public.agent_releases
                 where platform = 'windows' order by created_at desc limit 15) v), '[]'::jsonb),
      'frota', coalesce((
        select jsonb_agg(jsonb_build_object('versao', f.versao, 'maquinas', f.n) order by f.n desc)
          from (select ab.agent_version as versao, count(*) as n
                  from public.address_book ab
                 where ab.is_active and ab.last_online > now() - interval '7 days'
                 group by ab.agent_version) f), '[]'::jsonb),
      'fixadas', coalesce((
        select jsonb_agg(jsonb_build_object('id', ab.id, 'nome', coalesce(ab.alias, ab.rustdesk_id),
                                            'fixada', ab.agent_target_version, 'atual', ab.agent_version)
                         order by ab.alias)
          from public.address_book ab where ab.agent_target_version is not null), '[]'::jsonb),
      'empresas_fixadas', (select count(*) from public.tenant_settings ts where ts.agent_target_version is not null)
    ),
    'app', jsonb_build_object(
      'alvo', (select pol.target_version from public.client_update_policy pol where pol.id),
      'versoes', coalesce((
        select jsonb_agg(jsonb_build_object('versao', v.version, 'criada_em', v.created_at) order by v.created_at desc)
          from (select version, created_at from public.client_releases
                 order by created_at desc limit 15) v), '[]'::jsonb),
      'frota', coalesce((
        select jsonb_agg(jsonb_build_object('versao', f.versao, 'maquinas', f.n) order by f.n desc)
          from (select ab.client_version as versao, count(*) as n
                  from public.address_book ab
                 where ab.is_active and ab.last_online > now() - interval '7 days'
                 group by ab.client_version) f), '[]'::jsonb),
      'fixadas', coalesce((
        select jsonb_agg(jsonb_build_object('id', ab.id, 'nome', coalesce(ab.alias, ab.rustdesk_id),
                                            'fixada', ab.client_target_version, 'atual', ab.client_version)
                         order by ab.alias)
          from public.address_book ab where ab.client_target_version is not null), '[]'::jsonb),
      'empresas_fixadas', (select count(*) from public.tenant_settings ts where ts.client_target_version is not null)
    ),
    'historico', coalesce((
      select jsonb_agg(jsonb_build_object(
               'produto', h.produto, 'versao', h.versao, 'anterior', h.anterior, 'alcance', h.alcance,
               'computador', h.computador, 'por', h.por, 'em', h.liberado_em) order by h.liberado_em desc)
        from (select l.produto, l.versao, l.anterior, l.alcance, l.liberado_em,
                     coalesce(ab.alias, ab.rustdesk_id) as computador,
                     coalesce(p.full_name, p.email) as por
                from public.liberacoes_versao l
                left join public.address_book ab on ab.id = l.device_id
                left join public.profiles p on p.id = l.liberado_por
               order by l.liberado_em desc limit 10) h), '[]'::jsonb)
  ) into r;

  return r;
end;
$fn$;

revoke all on function public.atualizacoes_resumo() from public, anon;
grant execute on function public.atualizacoes_resumo() to authenticated;

-- ---------------------------------------------------------------------------
-- Liberar para todas as máquinas. Voltar para uma versão anterior é o mesmo botão: o agente
-- compara por igualdade, não por "mais nova" (ver resolve_agent_update).
-- p_soltar_fixadas: tira as versões de teste fixadas por computador e por empresa, para elas
-- seguirem a liberação geral (o que foi feito à mão em 06/10/2026).
-- ---------------------------------------------------------------------------
create or replace function public.liberar_versao(
  p_produto        text,
  p_versao         text,
  p_soltar_fixadas boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_anterior text;
  v_soltas   integer := 0;
  v_empresas integer := 0;
begin
  if not private.super_admin_ativo() then
    raise exception 'Somente a equipe AcessoFast (super_admin) libera versão' using errcode = '42501';
  end if;

  if p_produto = 'agente' then
    if not exists (select 1 from public.agent_releases r where r.version = p_versao and r.platform = 'windows') then
      raise exception 'Versão % do agente não está no catálogo', p_versao using errcode = '22023';
    end if;
    select pol.target_version into v_anterior from public.agent_update_policy pol where pol.id;
    update public.agent_update_policy set target_version = p_versao, updated_at = now() where id;
    if p_soltar_fixadas then
      update public.address_book set agent_target_version = null where agent_target_version is not null;
      get diagnostics v_soltas = row_count;
      update public.tenant_settings set agent_target_version = null where agent_target_version is not null;
      get diagnostics v_empresas = row_count;
    end if;

  elsif p_produto = 'app' then
    if not exists (select 1 from public.client_releases r where r.version = p_versao) then
      raise exception 'Versão % do app não está no catálogo', p_versao using errcode = '22023';
    end if;
    select pol.target_version into v_anterior from public.client_update_policy pol where pol.id;
    update public.client_update_policy set target_version = p_versao, updated_at = now() where id;
    if p_soltar_fixadas then
      update public.address_book set client_target_version = null where client_target_version is not null;
      get diagnostics v_soltas = row_count;
      update public.tenant_settings set client_target_version = null where client_target_version is not null;
      get diagnostics v_empresas = row_count;
    end if;

  else
    raise exception 'Produto inválido: %', p_produto using errcode = '22023';
  end if;

  insert into public.liberacoes_versao (produto, versao, anterior, alcance, liberado_por)
  values (p_produto, p_versao, v_anterior, 'todas', (select auth.uid()));

  return jsonb_build_object('anterior', v_anterior, 'versao', p_versao,
                            'computadores_soltos', v_soltas, 'empresas_soltas', v_empresas);
end;
$fn$;

revoke all on function public.liberar_versao(text, text, boolean) from public, anon;
grant execute on function public.liberar_versao(text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Testar num computador: fixa a versão só nele. p_versao null tira o teste (o computador volta
-- a seguir a liberação geral).
-- ---------------------------------------------------------------------------
create or replace function public.testar_versao(
  p_produto   text,
  p_versao    text,
  p_device_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_anterior text;
  v_nome     text;
begin
  if not private.super_admin_ativo() then
    raise exception 'Somente a equipe AcessoFast (super_admin) testa versão' using errcode = '42501';
  end if;

  select coalesce(ab.alias, ab.rustdesk_id),
         case when p_produto = 'agente' then ab.agent_target_version else ab.client_target_version end
    into v_nome, v_anterior
    from public.address_book ab where ab.id = p_device_id;
  if not found then
    raise exception 'Computador não encontrado' using errcode = '22023';
  end if;

  if p_produto = 'agente' then
    if p_versao is not null
       and not exists (select 1 from public.agent_releases r where r.version = p_versao and r.platform = 'windows') then
      raise exception 'Versão % do agente não está no catálogo', p_versao using errcode = '22023';
    end if;
    update public.address_book set agent_target_version = p_versao where id = p_device_id;
  elsif p_produto = 'app' then
    if p_versao is not null
       and not exists (select 1 from public.client_releases r where r.version = p_versao) then
      raise exception 'Versão % do app não está no catálogo', p_versao using errcode = '22023';
    end if;
    update public.address_book set client_target_version = p_versao where id = p_device_id;
  else
    raise exception 'Produto inválido: %', p_produto using errcode = '22023';
  end if;

  insert into public.liberacoes_versao (produto, versao, anterior, alcance, device_id, liberado_por)
  values (p_produto, p_versao, v_anterior, 'computador', p_device_id, (select auth.uid()));

  return jsonb_build_object('computador', v_nome, 'anterior', v_anterior, 'versao', p_versao);
end;
$fn$;

revoke all on function public.testar_versao(text, text, uuid) from public, anon;
grant execute on function public.testar_versao(text, text, uuid) to authenticated;
