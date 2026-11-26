-- Checkout do site com e-mail que ja tem conta (caso CTM, 25/11/2026).
--
-- O que acontecia: o admin de uma conta vencida assinou de novo pelo site com o
-- mesmo e-mail. O Asaas cobrou, e o webhook (passo 11, conta nova) tentou criar
-- o usuario: "A user with this email address has already been registered". A
-- intencao ficou 'failed' sem tenant, a conta continuou suspensa, e ninguem
-- soube ate o cliente reclamar.
--
-- Duas pecas, ambas so para service_role (as edge functions):
--
--   email_ja_cadastrado       -> a create-checkout-prod recusa o e-mail ANTES de
--                                abrir o checkout e manda a pessoa para o painel,
--                                onde a create-renewal-prod liga a compra a conta.
--
--   vincular_intencao_ao_admin -> rede de seguranca no webhook, para o e-mail que
--                                ganhou conta entre abrir o checkout e pagar (ex.:
--                                abriu o checkout, criou um teste gratis com o
--                                mesmo e-mail, depois pagou). Liga a intencao a
--                                conta so quando nao ha risco de estragar um plano
--                                em curso: o e-mail e admin ativo de UMA conta, a
--                                conta esta ativa, nao e isenta e nao paga plano
--                                agora (teste, gratis, creditos ou suspensa). Em
--                                qualquer outro caso devolve o motivo e o webhook
--                                deixa a intencao 'failed' com ele, para revisao.

create or replace function public.email_ja_cadastrado(p_email text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from auth.users u
     where lower(u.email) = lower(btrim(coalesce(p_email, '')))
  );
$$;

revoke all on function public.email_ja_cadastrado(text) from public, anon, authenticated;
grant execute on function public.email_ja_cadastrado(text) to service_role;


create or replace function public.vincular_intencao_ao_admin(p_intent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_i   public.signup_intents%rowtype;
  v_n   integer;
  v_tid uuid;
  t     public.tenants%rowtype;
begin
  select * into v_i from public.signup_intents where id = p_intent_id for update;
  if not found then
    return jsonb_build_object('motivo', 'intent_not_found');
  end if;
  if v_i.tenant_id is not null then
    return jsonb_build_object('motivo', 'ja_vinculada', 'tenant_id', v_i.tenant_id);
  end if;
  if v_i.status = 'provisioned' then
    return jsonb_build_object('motivo', 'ja_provisionada');
  end if;

  select count(*)::int, (array_agg(p.tenant_id))[1]
    into v_n, v_tid
    from public.profiles p
   where lower(p.email) = lower(btrim(coalesce(v_i.admin_email, '')))
     and p.role = 'admin'::public.user_role
     and p.is_active
     and p.tenant_id is not null;

  if v_n = 0 then
    -- E-mail novo, ou de tecnico/super admin: o webhook segue para a conta nova.
    return jsonb_build_object('motivo', 'email_nao_e_admin');
  end if;
  if v_n > 1 then
    return jsonb_build_object('motivo', 'email_em_varias_contas');
  end if;

  select * into t from public.tenants where id = v_tid for update;
  if not t.is_active then
    return jsonb_build_object('motivo', 'conta_inativa', 'tenant_id', v_tid);
  end if;
  if t.billing_exempt and (t.billing_exempt_until is null or t.billing_exempt_until > now()) then
    return jsonb_build_object('motivo', 'conta_isenta', 'tenant_id', v_tid);
  end if;
  -- Conta pagando plano agora: aplicar a compra trocaria plano e vencimento por
  -- cima do que ja foi pago (e poderia baixar as vagas). Fica para revisao.
  if not (t.is_trial
          or t.billing_mode in ('free'::public.billing_mode, 'credits'::public.billing_mode)
          or t.billing_status = 'suspended') then
    return jsonb_build_object('motivo', 'conta_pagante', 'tenant_id', v_tid);
  end if;

  update public.signup_intents
     set tenant_id = v_tid, updated_at = now()
   where id = p_intent_id;

  return jsonb_build_object('motivo', 'vinculada', 'tenant_id', v_tid);
end;
$$;

revoke all on function public.vincular_intencao_ao_admin(uuid) from public, anon, authenticated;
grant execute on function public.vincular_intencao_ao_admin(uuid) to service_role;
