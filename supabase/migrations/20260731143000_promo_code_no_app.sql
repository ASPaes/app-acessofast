-- AcessoFast — cupom aplicado DENTRO do app, numa empresa que ja existe
--
-- Ate aqui promo_codes so era resgatado no site comercial: a create-checkout-prod
-- validava o codigo e chamava redeem_promo_code no meio do checkout. Quem ja e
-- cliente nao tinha onde digitar um codigo que o comercial passou depois da
-- venda. Aqui entram as RPCs que rodam com o usuario LOGADO (admin da conta ou
-- super_admin):
--
--   promo_code_preview_tenant   — o que o codigo faria nesta conta (sem efeito)
--   apply_promo_code_to_tenant  — aplica de fato
--   tenant_pending_promo        — o desconto reservado, para a tela mostrar
--   cancel_pending_promo        — devolve um desconto reservado por engano
--
-- Os dois beneficios se comportam de formas MUITO diferentes numa conta que ja
-- existe, e essa e a decisao central deste arquivo:
--
--   dias extras  -> somam AGORA em tenants.plan_expires_at. So valem para quem
--                   tem data de vencimento (teste ou plano anual). Numa
--                   assinatura mensal recorrente plan_expires_at e NULL — nao ha
--                   data para empurrar, e CRIAR uma seria pior do que nao fazer
--                   nada: o suspend_expired_plans passaria a cortar essa conta
--                   naquele dia. Entao, sem data, os dias simplesmente nao se
--                   aplicam e a tela avisa.
--
--   desconto %   -> nao existe como aplicar sozinho: quem cobra e o Asaas e o
--                   valor so muda quando um checkout novo e criado. O resgate
--                   fica RESERVADO (consumed_at null) e a create-renewal-prod o
--                   consome na proxima contratacao/renovacao, do mesmo jeito que
--                   a create-checkout-prod faz no site — inclusive abrindo a
--                   promo_subscription_windows quando o desconto tem prazo.
--
-- ANTI-REUSO: no site quem segura e o unique (promo_code_id, doc_hash), porque
-- o visitante digita CPF/CNPJ. No painel ninguem digita documento, entao o par
-- (promo_code_id, tenant_id) e que impede o mesmo cupom de cair duas vezes na
-- mesma empresa. A checagem roda sob o lock da linha em promo_codes, que e o
-- mesmo lock que serializa o teto de resgates.
--
-- PLANO ELEGIVEL: o cupom pode restringir planos (promo_codes.plan_codes). Numa
-- conta existente a regra depende do beneficio:
--   dias     -> valem sobre o plano ATUAL, entao o plano atual tem que estar na
--               lista.
--   desconto -> vale sobre o plano que a empresa vai CONTRATAR, que ela ainda
--               nem escolheu. Barrar agora pelo plano atual impediria justamente
--               o upgrade com cupom. A conferencia definitiva e no checkout, com
--               o plano escolhido; a tela mostra para quais planos o cupom vale.

-- ---------------------------------------------------------------------
-- 1. Colunas novas em promo_code_redemptions
-- ---------------------------------------------------------------------
alter table public.promo_code_redemptions
  add column if not exists source text not null default 'signup',
  add column if not exists applied_by uuid references public.profiles(id),
  add column if not exists consumed_intent_id uuid
    references public.signup_intents(id) on delete set null,
  add column if not exists consumed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ck_promo_redemptions_source'
  ) then
    alter table public.promo_code_redemptions
      add constraint ck_promo_redemptions_source
      check (source in ('signup', 'app'));
  end if;
end $$;

comment on column public.promo_code_redemptions.source is
  'signup = resgatado no checkout do site. app = aplicado no painel numa conta que ja existia.';
comment on column public.promo_code_redemptions.consumed_at is
  'Quando o beneficio terminou de ser usado. Desconto reservado no painel fica null ate a cobranca com desconto ser provisionada; resgate sem desconto ja nasce consumido.';
comment on column public.promo_code_redemptions.consumed_intent_id is
  'Intencao de cobranca que esta levando este desconto. Preenchida pela create-renewal-prod, carimbada pela apply_paid_plan.';

-- Resgate antigo (do site) nao tem nada pendente: o desconto ja foi para dentro
-- do checkout no momento em que nasceu.
update public.promo_code_redemptions
   set consumed_at = redeemed_at
 where consumed_at is null;

-- Um desconto reservado por vez, por empresa. So resgates do painel entram na
-- conta: o do site ja nasce consumido (ver redeem_promo_code adiante) e o
-- source = 'app' e o cinto alem do suspensorio, caso um dia a redeem volte a ser
-- redefinida pelo repo do site sem esse carimbo.
create unique index if not exists uq_promo_redemptions_desconto_pendente
  on public.promo_code_redemptions(tenant_id)
  where tenant_id is not null
    and source = 'app'
    and consumed_at is null
    and applied_discount_percent is not null;

-- ---------------------------------------------------------------------
-- 1b. redeem_promo_code — resgate do site ja nasce consumido
-- ---------------------------------------------------------------------
-- Mesma funcao de 20260730153347_promo_codes.sql, com uma linha a mais: o
-- consumed_at. Sem isso o resgate feito no checkout do site ficaria com
-- consumed_at null e seria lido como "desconto reservado" desta empresa — a
-- create-renewal-prod aplicaria o mesmo desconto DE NOVO na renovacao seguinte.
create or replace function public.redeem_promo_code(
  p_code              text,
  p_plan_code         text default null,
  p_doc_hash          text default null,
  p_signup_intent_id  uuid default null,
  p_admin_email       text default null
) returns table (
  ok                boolean,
  reason            text,
  redemption_id     uuid,
  extra_trial_days  integer,
  discount_percent  integer,
  discount_months   integer
)
language plpgsql
volatile
security definer
set search_path = public, private, pg_temp
as $$
declare
  v       public.promo_codes;
  v_code  text := upper(btrim(coalesce(p_code, '')));
  v_why   text;
  v_id    uuid;
begin
  -- Lock da linha: serializa o teto de resgates entre signups concorrentes.
  select * into v from public.promo_codes p where p.code = v_code for update;

  v_why := private.promo_code_reason(v, p_plan_code, p_doc_hash);
  if v_why is not null then
    return query select false, v_why, null::uuid, 0, null::integer, null::integer;
    return;
  end if;

  insert into public.promo_code_redemptions (
    promo_code_id, code, signup_intent_id, admin_email, doc_hash,
    applied_extra_trial_days, applied_discount_percent, applied_discount_months,
    source, consumed_at
  ) values (
    v.id, v.code, p_signup_intent_id, p_admin_email, p_doc_hash,
    v.extra_trial_days, v.discount_percent, v.discount_months,
    -- O desconto entra no checkout que esta sendo montado agora: nao sobra nada
    -- reservado para depois.
    'signup', now()
  )
  returning id into v_id;

  update public.promo_codes
     set redemptions_count = redemptions_count + 1
   where id = v.id;

  return query select true, null::text, v_id,
                      v.extra_trial_days, v.discount_percent, v.discount_months;
end;
$$;

revoke all on function public.redeem_promo_code(text, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.redeem_promo_code(text, text, text, uuid, text)
  to service_role;

-- ---------------------------------------------------------------------
-- 2. Quem pode mexer no cupom de uma empresa
-- ---------------------------------------------------------------------
-- super_admin (comercial passando o cupom para o cliente) ou o admin ATIVO da
-- propria conta (cliente digitando o codigo que recebeu). Tecnico e supervisor
-- ficam de fora: isso e financeiro.
create or replace function private.can_manage_tenant_promo(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select private.is_super_admin()
      or exists (
           select 1 from public.profiles p
            where p.id = (select auth.uid())
              and p.tenant_id = p_tenant_id
              and p.role = 'admin'::public.user_role
              and p.is_active
         );
$$;

revoke all on function private.can_manage_tenant_promo(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Elegibilidade na conta existente — motivo unico
-- ---------------------------------------------------------------------
-- Mesma ordem de recusa do private.promo_code_reason, com as duas diferencas
-- explicadas no cabecalho: plano so barra quando o beneficio e de dias, e o
-- anti-reuso e por tenant.
create or replace function private.promo_code_reason_tenant(
  v            public.promo_codes,
  p_tenant_id  uuid,
  p_plan_code  text
) returns text
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  if v.id is null         then return 'not_found';   end if;
  if not v.is_active      then return 'inactive';    end if;
  if now() < v.valid_from then return 'not_started'; end if;

  if v.valid_until is not null and now() > v.valid_until then
    return 'expired';
  end if;

  if v.max_redemptions is not null and v.redemptions_count >= v.max_redemptions then
    return 'exhausted';
  end if;

  -- Cupom so de dias: o beneficio cai no plano atual, entao ele tem que estar na
  -- lista. Cupom com desconto passa e o checkout confere o plano escolhido.
  if v.discount_percent is null
     and v.plan_codes is not null
     and (p_plan_code is null or not (p_plan_code = any (v.plan_codes))) then
    return 'plan_not_eligible';
  end if;

  if exists (
    select 1 from public.promo_code_redemptions r
     where r.promo_code_id = v.id and r.tenant_id = p_tenant_id
  ) then
    return 'already_used';
  end if;

  -- Dois descontos reservados ao mesmo tempo nao teriam como ser aplicados: o
  -- checkout leva um valor so.
  if v.discount_percent is not null and exists (
    select 1 from public.promo_code_redemptions r
     where r.tenant_id = p_tenant_id
       and r.source = 'app'
       and r.applied_discount_percent is not null
       and r.consumed_at is null
  ) then
    return 'discount_pending';
  end if;

  return null;
end;
$$;

revoke all on function private.promo_code_reason_tenant(public.promo_codes, uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. promo_code_preview_tenant — o que aconteceria, sem efeito colateral
-- ---------------------------------------------------------------------
create or replace function public.promo_code_preview_tenant(
  p_tenant_id uuid,
  p_code      text
) returns table (
  ok                boolean,
  reason            text,
  code              text,
  description       text,
  extra_trial_days  integer,
  dias_aplicaveis   boolean,
  novo_vencimento   timestamptz,
  discount_percent  integer,
  discount_months   integer,
  plan_codes        text[]
)
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v      public.promo_codes;
  t      public.tenants;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_why  text;
  v_dias boolean;
begin
  if not private.can_manage_tenant_promo(p_tenant_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into t from public.tenants where id = p_tenant_id;
  if t.id is null then
    raise exception 'tenant_not_found' using errcode = 'P0001';
  end if;

  select * into v from public.promo_codes p where p.code = v_code;

  v_why := private.promo_code_reason_tenant(v, p_tenant_id, t.plan_code);
  if v_why is not null then
    return query select false, v_why, v_code, null::text, 0, false,
                        null::timestamptz, null::integer, null::integer, null::text[];
    return;
  end if;

  v_dias := v.extra_trial_days > 0 and t.plan_expires_at is not null;

  -- Cupom que so daria dias numa conta sem data de vencimento nao faz nada. Vale
  -- dizer isso antes de queimar um resgate da campanha.
  if not v_dias and v.discount_percent is null then
    return query select false, 'no_effect', v.code, v.description,
                        v.extra_trial_days, false, null::timestamptz,
                        null::integer, null::integer, v.plan_codes;
    return;
  end if;

  return query select
    true, null::text, v.code, v.description,
    v.extra_trial_days,
    v_dias,
    case when v_dias
         then greatest(t.plan_expires_at, now()) + make_interval(days => v.extra_trial_days)
         end,
    v.discount_percent, v.discount_months, v.plan_codes;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. apply_promo_code_to_tenant — aplica de fato
-- ---------------------------------------------------------------------
create or replace function public.apply_promo_code_to_tenant(
  p_tenant_id uuid,
  p_code      text
) returns table (
  ok                boolean,
  reason            text,
  redemption_id     uuid,
  dias_aplicados    integer,
  novo_vencimento   timestamptz,
  discount_percent  integer,
  discount_months   integer
)
language plpgsql
volatile
security definer
set search_path = public, private, pg_temp
as $$
declare
  v       public.promo_codes;
  t       public.tenants;
  v_code  text := upper(btrim(coalesce(p_code, '')));
  v_why   text;
  v_id    uuid;
  v_dias  integer := 0;
  v_exp   timestamptz;
  v_uid   uuid := (select auth.uid());
  v_email text;
begin
  if not private.can_manage_tenant_promo(p_tenant_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into t from public.tenants where id = p_tenant_id for update;
  if t.id is null then
    raise exception 'tenant_not_found' using errcode = 'P0001';
  end if;

  -- Mesmo lock do resgate no site: serializa teto de resgates e anti-reuso.
  select * into v from public.promo_codes p where p.code = v_code for update;

  v_why := private.promo_code_reason_tenant(v, p_tenant_id, t.plan_code);
  if v_why is not null then
    return query select false, v_why, null::uuid, 0, null::timestamptz,
                        null::integer, null::integer;
    return;
  end if;

  if v.extra_trial_days > 0 and t.plan_expires_at is not null then
    v_dias := v.extra_trial_days;
    -- greatest(): se o prazo ja venceu, os dias contam a partir de hoje. Somar
    -- sobre uma data no passado devolveria menos dias do que o cupom promete.
    v_exp  := greatest(t.plan_expires_at, now()) + make_interval(days => v_dias);
  end if;

  if v_dias = 0 and v.discount_percent is null then
    return query select false, 'no_effect', null::uuid, 0, null::timestamptz,
                        null::integer, null::integer;
    return;
  end if;

  select p.email into v_email from public.profiles p where p.id = v_uid;

  insert into public.promo_code_redemptions (
    promo_code_id, code, tenant_id, admin_email, doc_hash,
    applied_extra_trial_days, applied_discount_percent, applied_discount_months,
    source, applied_by,
    -- Sem desconto nao ha nada a consumir depois: nasce fechado.
    consumed_at
  ) values (
    v.id, v.code, p_tenant_id, coalesce(t.billing_email, v_email), null,
    v_dias, v.discount_percent, v.discount_months,
    'app', v_uid,
    case when v.discount_percent is null then now() end
  )
  returning id into v_id;

  update public.promo_codes
     set redemptions_count = redemptions_count + 1
   where id = v.id;

  if v_dias > 0 then
    update public.tenants
       set plan_expires_at = v_exp,
           -- Conta cortada por vencimento volta a funcionar: e o motivo de
           -- existir um cupom de dias no painel. Inadimplencia (past_due) nao
           -- se resolve com dias e fica como esta.
           billing_status  = case
                               when billing_status = 'suspended'
                                    and plan_expires_at < now()
                               then 'active'
                               else billing_status
                             end,
           updated_at = now()
     where id = p_tenant_id;
  end if;

  return query select true, null::text, v_id, v_dias, v_exp,
                      v.discount_percent, v.discount_months;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. tenant_pending_promo — o desconto reservado, para a tela
-- ---------------------------------------------------------------------
-- A RLS de promo_code_redemptions ja deixa a empresa ler o proprio resgate, mas
-- promo_codes e so do super_admin — e a tela precisa de plan_codes para dizer em
-- quais planos o desconto vale. Dai a RPC.
create or replace function public.tenant_pending_promo(p_tenant_id uuid)
returns table (
  redemption_id     uuid,
  code              text,
  description       text,
  discount_percent  integer,
  discount_months   integer,
  plan_codes        text[],
  redeemed_at       timestamptz
)
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  if not private.can_manage_tenant_promo(p_tenant_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select r.id, r.code, c.description,
           r.applied_discount_percent, r.applied_discount_months,
           c.plan_codes, r.redeemed_at
      from public.promo_code_redemptions r
      join public.promo_codes c on c.id = r.promo_code_id
     where r.tenant_id = p_tenant_id
       and r.source = 'app'
       and r.consumed_at is null
       and r.applied_discount_percent is not null
     order by r.redeemed_at desc
     limit 1;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. cancel_pending_promo — devolve um desconto reservado por engano
-- ---------------------------------------------------------------------
create or replace function public.cancel_pending_promo(p_redemption_id uuid)
returns table (ok boolean, reason text)
language plpgsql
volatile
security definer
set search_path = public, private, pg_temp
as $$
declare
  r public.promo_code_redemptions;
begin
  select * into r from public.promo_code_redemptions
   where id = p_redemption_id for update;

  if r.id is null then
    return query select false, 'not_found'; return;
  end if;
  if r.tenant_id is null or not private.can_manage_tenant_promo(r.tenant_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if r.consumed_at is not null then
    return query select false, 'already_used'; return;
  end if;
  -- Resgate do site nunca fica reservado; se aparecer um aqui, e sinal de que
  -- algo saiu do trilho e apagar seria pior do que recusar.
  if r.source <> 'app' then
    return query select false, 'not_cancellable'; return;
  end if;

  -- Checkout aberto agora: o link do Asaas vale 60 minutos e ja saiu com o valor
  -- descontado. Apagar o resgate levaria junto a janela de restauracao (cascade)
  -- e o desconto ficaria eterno na assinatura se aquele link fosse pago.
  if exists (
    select 1 from public.promo_subscription_windows w
     where w.redemption_id = r.id
       and w.status = 'pending_link'
       and w.created_at > now() - interval '2 hours'
  ) then
    return query select false, 'checkout_open'; return;
  end if;

  delete from public.promo_code_redemptions where id = r.id;

  update public.promo_codes
     set redemptions_count = greatest(redemptions_count - 1, 0)
   where id = r.promo_code_id;

  return query select true, null::text;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. apply_paid_plan — carimba o desconto como consumido
-- ---------------------------------------------------------------------
-- Mesma funcao de 20260725220947_apply_paid_plan.sql, com o carimbo do resgate
-- no fim. E aqui que o desconto reservado deixa de existir: a cobranca com
-- desconto foi paga e provisionada.
create or replace function public.apply_paid_plan(p_intent_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_intent public.signup_intents%rowtype;
begin
  if auth.uid() is not null and not private.is_super_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;

  select * into v_intent from public.signup_intents where id = p_intent_id for update;
  if not found then
    raise exception 'intent_not_found: %', p_intent_id using errcode='P0001';
  end if;
  if v_intent.tenant_id is null then
    raise exception 'intent_sem_tenant' using errcode='P0001';
  end if;
  if v_intent.status = 'provisioned' then
    return v_intent.tenant_id;   -- idempotente
  end if;

  perform public.assign_plan(v_intent.tenant_id, v_intent.plan_code);

  update public.tenants
     set billing_status  = 'active',
         is_trial        = false,
         past_due_since  = null,
         billing_invoice_url = null,
         -- ESTE e o ponto critico: mensal nao expira; anual ganha 12 meses novos.
         -- Sem isso, o cron cortaria um cliente que acabou de pagar.
         plan_expires_at = case when v_intent.billing_cycle = 'annual'
                                then now() + interval '12 months'
                                else null end,
         asaas_customer_id     = coalesce(v_intent.asaas_customer_id, public.tenants.asaas_customer_id),
         asaas_subscription_id = coalesce(v_intent.asaas_subscription_id, public.tenants.asaas_subscription_id),
         updated_at = now()
   where id = v_intent.tenant_id;

  update public.signup_intents
     set status = 'provisioned', provisioned_at = now(), updated_at = now()
   where id = p_intent_id;

  -- Cupom aplicado no painel e levado por esta cobranca: fecha o resgate.
  update public.promo_code_redemptions
     set consumed_at = now()
   where consumed_intent_id = p_intent_id
     and consumed_at is null;

  return v_intent.tenant_id;
end;
$fn$;

revoke all on function public.apply_paid_plan(uuid) from public, anon, authenticated;
grant execute on function public.apply_paid_plan(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 9. Grants — o guard de papel esta dentro de cada funcao
-- ---------------------------------------------------------------------
revoke all on function public.promo_code_preview_tenant(uuid, text)  from public, anon;
revoke all on function public.apply_promo_code_to_tenant(uuid, text) from public, anon;
revoke all on function public.tenant_pending_promo(uuid)             from public, anon;
revoke all on function public.cancel_pending_promo(uuid)             from public, anon;

grant execute on function public.promo_code_preview_tenant(uuid, text)  to authenticated;
grant execute on function public.apply_promo_code_to_tenant(uuid, text) to authenticated;
grant execute on function public.tenant_pending_promo(uuid)             to authenticated;
grant execute on function public.cancel_pending_promo(uuid)             to authenticated;

-- A create-renewal-prod nao usa nenhuma destas: com service_role nao existe
-- auth.uid(), entao o guard as recusaria. Ela le promo_code_redemptions direto,
-- que e o que service_role ja pode fazer.
