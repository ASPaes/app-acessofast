-- Dias grátis concedidos pelo super admin, na tela de plano da empresa.
--
-- Usa o mesmo teste do cadastro pelo site: is_trial + plan_expires_at. Assim a
-- conta aparece como "teste" (e não "sem cobrança") em Empresas e no Financeiro,
-- o cliente vê a faixa "Teste grátis: faltam N dias" com o botão Assinar, e o
-- cron acessofast_suspend_expired_plans (00:35 de Brasília) bloqueia o acesso
-- remoto quando a data passa. Assinar (apply_paid_plan) ou registrar pagamento
-- por fora já tiram a conta do teste.
--
-- Recusa o que sobrescreveria dinheiro: assinatura ativa no Asaas ou ano pago
-- em andamento (plan_expires_at no futuro, fora do teste, com contratação paga).
-- Isenção vigente também recusa: conta isenta não é bloqueada, então o teste
-- não teria efeito nenhum e o selo enganaria.
--
-- Conceder de novo em conta que já está em teste troca a data de fim por
-- hoje + N dias (não soma), e conta bloqueada pelo fim do teste volta a ativa.

create or replace function public.conceder_dias_gratis(p_tenant uuid, p_dias integer)
returns timestamptz
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  t     public.tenants%rowtype;
  v_fim timestamptz;
begin
  if auth.uid() is not null and not private.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_dias is null or p_dias < 1 or p_dias > 90 then
    raise exception 'dias_invalidos' using errcode = 'P0001';
  end if;

  select * into t from public.tenants where id = p_tenant for update;
  if not found then
    raise exception 'unknown_tenant: %', p_tenant using errcode = 'P0001';
  end if;

  if t.billing_mode <> 'plan' then
    raise exception 'conta_sem_plano_pago' using errcode = 'P0001';
  end if;
  if t.billing_exempt and (t.billing_exempt_until is null or t.billing_exempt_until > now()) then
    raise exception 'conta_isenta' using errcode = 'P0001';
  end if;
  if t.asaas_subscription_id is not null then
    raise exception 'conta_com_assinatura' using errcode = 'P0001';
  end if;
  if not t.is_trial
     and t.plan_expires_at > now()
     and exists (select 1 from private.valores_contratados() v where v.tenant_id = t.id) then
    raise exception 'periodo_pago_em_andamento' using errcode = 'P0001';
  end if;

  v_fim := now() + make_interval(days => p_dias);

  update public.tenants
     set is_trial        = true,
         plan_expires_at = v_fim,
         billing_status  = 'active',
         past_due_since  = null,
         updated_at      = now()
   where id = t.id;

  return v_fim;
end;
$fn$;

revoke all on function public.conceder_dias_gratis(uuid, integer) from public, anon;
grant execute on function public.conceder_dias_gratis(uuid, integer) to authenticated, service_role;
