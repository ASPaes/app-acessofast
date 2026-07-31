-- AcessoFast — promo_codes (vouchers de parceiro)
--
-- Codigo aberto criado pelo comercial (ex.: ACESSOFAST15DIAS) e digitado pelo
-- visitante no site comercial ao contratar. Concede dias EXTRAS de trial (somam
-- aos 7 padrao) e/ou desconto percentual por N meses na assinatura.
--
-- NAO confundir com public.vouchers, que ja existe e tem outra semantica:
-- cortesia de dias amarrada a um CNPJ, 1 por CNPJ, emitida em resposta a um
-- voucher_requests de quem JA e cliente. Aquela continua intacta.
--
-- PRIVACIDADE (LGPD): o resgate guarda o HMAC do CPF/CNPJ (mesmo doc_hash do
-- start-trial-prod), nunca o documento em claro.

-- ---------------------------------------------------------------------
-- 1. promo_codes — catalogo de codigos
-- ---------------------------------------------------------------------
create table if not exists public.promo_codes (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique,
  description        text,

  -- Beneficios. Pelo menos um tem que existir (ck_promo_codes_beneficio).
  extra_trial_days   integer not null default 0
                       check (extra_trial_days between 0 and 365),
  discount_percent   integer check (discount_percent between 1 and 100),
  -- null = desconto em todas as cobrancas enquanto a assinatura durar.
  discount_months    integer check (discount_months >= 1),

  -- null = vale para qualquer plano. Senao, lista de plans.code aceitos.
  plan_codes         text[],

  -- null = ilimitado.
  max_redemptions    integer check (max_redemptions >= 1),
  redemptions_count  integer not null default 0 check (redemptions_count >= 0),

  valid_from         timestamptz not null default now(),
  valid_until        timestamptz,
  is_active          boolean not null default true,

  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- Codigo sempre normalizado em maiuscula: a busca e por igualdade exata.
  constraint ck_promo_codes_code_formato
    check (code = upper(code) and code ~ '^[A-Z0-9._-]{3,32}$'),
  -- Um voucher sem nenhum beneficio nao faz sentido.
  constraint ck_promo_codes_beneficio
    check (extra_trial_days > 0 or discount_percent is not null),
  -- Duracao do desconto so existe se houver desconto.
  constraint ck_promo_codes_discount_months
    check (discount_months is null or discount_percent is not null),
  constraint ck_promo_codes_janela
    check (valid_until is null or valid_until > valid_from)
);

comment on table public.promo_codes is
  'Voucher de parceiro digitado no site comercial: dias extras de trial (somam aos 7) e/ou desconto percentual por N meses. Diferente de public.vouchers (cortesia 1/CNPJ pos-venda).';
comment on column public.promo_codes.discount_months is
  'Meses de cobranca com desconto. null = todas as cobrancas enquanto a assinatura durar.';
comment on column public.promo_codes.plan_codes is
  'null = qualquer plano. Senao, restringe aos plans.code listados.';
comment on column public.promo_codes.max_redemptions is
  'null = uso ilimitado. Senao, teto de resgates (redemptions_count).';

-- ---------------------------------------------------------------------
-- 2. promo_code_redemptions — quem usou, com quais beneficios
-- ---------------------------------------------------------------------
create table if not exists public.promo_code_redemptions (
  id                        uuid primary key default gen_random_uuid(),
  promo_code_id             uuid not null
                              references public.promo_codes(id) on delete restrict,
  -- Snapshot: o codigo pode ser renomeado/desativado depois.
  code                      text not null,

  signup_intent_id          uuid references public.signup_intents(id) on delete set null,
  tenant_id                 uuid references public.tenants(id) on delete set null,
  admin_email               text,
  -- HMAC-SHA256 do CPF/CNPJ (mesma chave do start-trial-prod). Nunca o doc.
  doc_hash                  text,

  -- Beneficios congelados no momento do resgate.
  applied_extra_trial_days  integer not null default 0,
  applied_discount_percent  integer,
  applied_discount_months   integer,

  redeemed_at               timestamptz not null default now()
);

-- O mesmo documento nao resgata o mesmo codigo duas vezes.
create unique index if not exists uq_promo_redemptions_code_doc
  on public.promo_code_redemptions(promo_code_id, doc_hash)
  where doc_hash is not null;

create index if not exists idx_promo_redemptions_code
  on public.promo_code_redemptions(promo_code_id, redeemed_at desc);
create index if not exists idx_promo_redemptions_tenant
  on public.promo_code_redemptions(tenant_id);

comment on table public.promo_code_redemptions is
  'Resgates de promo_codes. Um por signup. Beneficios congelados no resgate.';

-- ---------------------------------------------------------------------
-- 3. updated_at
-- ---------------------------------------------------------------------
drop trigger if exists set_updated_at on public.promo_codes;
create trigger set_updated_at before update on public.promo_codes
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- 4. Elegibilidade — motivo unico compartilhado por preview e resgate
-- ---------------------------------------------------------------------
-- Retorna null quando o codigo pode ser usado; senao o motivo da recusa.
-- p_doc_hash null pula a checagem de reuso (o site valida antes de ter o doc).
create or replace function private.promo_code_reason(
  v            public.promo_codes,
  p_plan_code  text,
  p_doc_hash   text
) returns text
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  if v.id is null            then return 'not_found';   end if;
  if not v.is_active         then return 'inactive';    end if;
  if now() < v.valid_from    then return 'not_started'; end if;

  if v.valid_until is not null and now() > v.valid_until then
    return 'expired';
  end if;

  if v.plan_codes is not null
     and (p_plan_code is null or not (p_plan_code = any (v.plan_codes))) then
    return 'plan_not_eligible';
  end if;

  if v.max_redemptions is not null and v.redemptions_count >= v.max_redemptions then
    return 'exhausted';
  end if;

  if p_doc_hash is not null and exists (
    select 1 from public.promo_code_redemptions r
     where r.promo_code_id = v.id and r.doc_hash = p_doc_hash
  ) then
    return 'already_used';
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. promo_code_preview — consulta sem efeito colateral (site, ao digitar)
-- ---------------------------------------------------------------------
create or replace function public.promo_code_preview(
  p_code       text,
  p_plan_code  text default null
) returns table (
  ok                boolean,
  reason            text,
  code              text,
  description       text,
  extra_trial_days  integer,
  discount_percent  integer,
  discount_months   integer
)
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v       public.promo_codes;
  v_code  text := upper(btrim(coalesce(p_code, '')));
  v_why   text;
begin
  select * into v from public.promo_codes p where p.code = v_code;

  v_why := private.promo_code_reason(v, p_plan_code, null);
  if v_why is not null then
    return query select false, v_why, v_code, null::text, 0, null::integer, null::integer;
    return;
  end if;

  return query select true, null::text, v.code, v.description,
                      v.extra_trial_days, v.discount_percent, v.discount_months;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. redeem_promo_code — resgate atomico (backend, no signup)
-- ---------------------------------------------------------------------
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
    applied_extra_trial_days, applied_discount_percent, applied_discount_months
  ) values (
    v.id, v.code, p_signup_intent_id, p_admin_email, p_doc_hash,
    v.extra_trial_days, v.discount_percent, v.discount_months
  )
  returning id into v_id;

  update public.promo_codes
     set redemptions_count = redemptions_count + 1
   where id = v.id;

  return query select true, null::text, v_id,
                      v.extra_trial_days, v.discount_percent, v.discount_months;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. release_promo_code — devolve o resgate se o signup falhar depois
--    (mesmo papel do release_trial_document no start-trial-prod)
-- ---------------------------------------------------------------------
create or replace function public.release_promo_code(p_redemption_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_code_id uuid;
begin
  delete from public.promo_code_redemptions
   where id = p_redemption_id
  returning promo_code_id into v_code_id;

  if v_code_id is not null then
    update public.promo_codes
       set redemptions_count = greatest(redemptions_count - 1, 0)
     where id = v_code_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. promo_code_attach_tenant — liga o resgate ao tenant provisionado
-- ---------------------------------------------------------------------
create or replace function public.promo_code_attach_tenant(
  p_redemption_id uuid,
  p_tenant_id     uuid
) returns void
language sql
volatile
security definer
set search_path = public, private, pg_temp
as $$
  update public.promo_code_redemptions
     set tenant_id = p_tenant_id
   where id = p_redemption_id;
$$;

-- ---------------------------------------------------------------------
-- 9. Gestao pelo comercial (super_admin) — usadas pela tela do app
-- ---------------------------------------------------------------------
create or replace function public.create_promo_code(
  p_code              text,
  p_extra_trial_days  integer default 0,
  p_discount_percent  integer default null,
  p_discount_months   integer default null,
  p_description       text default null,
  p_plan_codes        text[] default null,
  p_max_redemptions   integer default null,
  p_valid_until       timestamptz default null
) returns public.promo_codes
language plpgsql
volatile
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_row public.promo_codes;
begin
  if not private.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.promo_codes (
    code, description, extra_trial_days, discount_percent, discount_months,
    plan_codes, max_redemptions, valid_until, created_by
  ) values (
    upper(btrim(p_code)), nullif(btrim(coalesce(p_description, '')), ''),
    coalesce(p_extra_trial_days, 0), p_discount_percent, p_discount_months,
    p_plan_codes, p_max_redemptions, p_valid_until, (select auth.uid())
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.set_promo_code_active(
  p_id     uuid,
  p_active boolean
) returns void
language plpgsql
volatile
security definer
set search_path = public, private, pg_temp
as $$
begin
  if not private.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.promo_codes set is_active = p_active where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 10. RLS — so o comercial enxerga o catalogo
-- ---------------------------------------------------------------------
alter table public.promo_codes            enable row level security;
alter table public.promo_code_redemptions enable row level security;

-- promo_codes: nunca exposto ao visitante nem ao tenant. O site consulta pela
-- edge function (service_role); o app lista com super_admin.
drop policy if exists promo_codes_select on public.promo_codes;
create policy promo_codes_select on public.promo_codes
  for select to authenticated
  using ( private.is_super_admin() );

-- redemptions: super_admin ve tudo; o tenant ve o proprio resgate.
drop policy if exists promo_code_redemptions_select on public.promo_code_redemptions;
create policy promo_code_redemptions_select on public.promo_code_redemptions
  for select to authenticated
  using ( private.is_super_admin() or tenant_id = private.current_tenant_id() );

-- ---------------------------------------------------------------------
-- 11. Grants — authenticated so LE; escrita via RPC/backend
-- ---------------------------------------------------------------------
grant select on public.promo_codes            to authenticated;
grant select on public.promo_code_redemptions to authenticated;

revoke insert, update, delete, truncate, references, trigger
  on public.promo_codes, public.promo_code_redemptions
  from authenticated;

-- O visitante anonimo nao fala com essas tabelas em hipotese nenhuma.
revoke all on public.promo_codes            from anon;
revoke all on public.promo_code_redemptions from anon;

-- RPCs de signup: exclusivas do backend (service_role).
revoke all on function public.promo_code_preview(text, text)              from public, anon, authenticated;
revoke all on function public.redeem_promo_code(text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.release_promo_code(uuid)                    from public, anon, authenticated;
revoke all on function public.promo_code_attach_tenant(uuid, uuid)        from public, anon, authenticated;
revoke all on function private.promo_code_reason(public.promo_codes, text, text) from public, anon, authenticated;

grant execute on function public.promo_code_preview(text, text)              to service_role;
grant execute on function public.redeem_promo_code(text, text, text, uuid, text) to service_role;
grant execute on function public.release_promo_code(uuid)                    to service_role;
grant execute on function public.promo_code_attach_tenant(uuid, uuid)        to service_role;

-- RPCs de gestao: o guard de super_admin esta dentro da funcao.
revoke all on function public.create_promo_code(text, integer, integer, integer, text, text[], integer, timestamptz) from public, anon;
revoke all on function public.set_promo_code_active(uuid, boolean) from public, anon;
grant execute on function public.create_promo_code(text, integer, integer, integer, text, text[], integer, timestamptz) to authenticated;
grant execute on function public.set_promo_code_active(uuid, boolean) to authenticated;
