-- AcessoFast, 03/11/2026: a Auditoria precisa dizer de onde veio cada acesso, em toda empresa.
--
-- O CASO: a Delvale viu um acesso do Ruan Leite, feito pelo app, aparecer sem tecnico e como
-- "fora do painel". A maquina acessada ja informa o ID do computador que conectou, mas esta
-- funcao jogava o dado fora em toda empresa com fronteira_modo = 'off', ou seja, todas menos
-- a ASP (decisao de 15/09, quando isto era so uma medicao).
--
-- O pedido do Ryan em 03/11: e log de seguranca da empresa, tem de valer sempre. Por isso a
-- gravacao deixa de depender da chave. fronteira_modo continua existindo para o corte por
-- controlador, que ainda nao existe.
--
-- POR QUE NAO LIGAR 'shadow' EM TODAS: o gatilho guard_fronteira_modo so aceita inserir 'off'
-- sem ser super_admin ou backend. Com 'shadow' de padrao, criar empresa nova poderia falhar.
--
-- O QUE NAO MUDA: technician_id continua sendo so de quem pediu o acesso. O selo da logo, o
-- horario de acesso e a cobranca leem esse campo, e o computador de origem nao prova quem
-- estava nele. A funcao so grava e classifica; nao corta nem avisa ninguem.
--
-- Vale para acessos novos. Sessao antiga nao tem o dado e nao tem como recuperar.

create or replace function public.registrar_controlador(
  p_connection_log_id uuid,
  p_controller_rustdesk_id text
)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_ctrl      text := nullif(regexp_replace(coalesce(p_controller_rustdesk_id, ''), '\s', '', 'g'), '');
  v_tenant    uuid;
  v_dev       uuid;
  v_dev_ten   uuid;
  v_dev_ativo boolean;
  v_status    text;
begin
  if v_ctrl is null or v_ctrl !~ '^[0-9]{6,20}$' then
    return null;
  end if;

  select cl.tenant_id
    into v_tenant
    from public.connection_logs cl
   where cl.id = p_connection_log_id
     and cl.controller_rustdesk_id is null;
  if not found then
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
$function$;

comment on column public.tenant_settings.fronteira_modo is
  'Reservado para o corte por controlador, que ainda nao existe. A gravacao do controlador nao depende mais desta chave: vale para toda empresa (20261103190000). So super_admin/backend alteram (trg_tenant_settings_guard_fronteira).';
