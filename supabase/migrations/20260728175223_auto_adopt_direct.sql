-- =====================================================================
-- Auto-adoção no acesso direto (.exe) — parte 1/3 (servidor).
-- =====================================================================
-- Quando o técnico acessa DIRETO um device do cliente que ainda não foi adotado
-- (só tem claim 'waiting' em private.device_claims, não está no address_book), o
-- session-ingest não conseguia nem autenticar (agent_token_hash vive no address_book)
-- -> device_not_registered.
--
-- auto_adopt_direct: autentica o device pelo CLAIM (token bate) e descobre o tenant
-- pelo rustdesk_id do CONTROLADOR (a máquina do técnico, já adotada) -> cria o device
-- 'approved' nesse tenant (o acesso do técnico É a aprovação). Controlador desconhecido
-- = sem tenant pra atribuir -> NÃO adota (o session-ingest corta). Chamada só no 'start'
-- e só pelo service_role (session-ingest).
--
-- NÃO regride o usuário individual: device já adotado nunca passa por aqui (o
-- session-ingest só chama quando não há linha no address_book).
-- =====================================================================

create or replace function public.auto_adopt_direct(
  p_rustdesk_id            text,
  p_agent_token_hash       text,
  p_controller_rustdesk_id text
)
returns table (device_id uuid, tenant_id uuid, adopted boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_claim private.device_claims%rowtype;
  v_tenant uuid; v_dev uuid;
begin
  -- 0) Já existe no address_book (corrida / evento repetido / device inativo)? Não
  --    re-adota; devolve o existente. (rustdesk_id é único no address_book.)
  select ab.id, ab.tenant_id into v_dev, v_tenant
    from public.address_book ab where ab.rustdesk_id = p_rustdesk_id limit 1;
  if v_dev is not null then
    device_id := v_dev; tenant_id := v_tenant; adopted := false; reason := 'already_adopted';
    return next; return;
  end if;

  -- 1) Claim 'waiting' com o token batendo = AUTENTICA o device (que ainda não está
  --    no address_book). Sem claim válido -> não é um device nosso / token errado.
  select * into v_claim from private.device_claims c
   where c.rustdesk_id = p_rustdesk_id and c.status = 'waiting' and c.expires_at > now()
     and c.agent_token_hash = p_agent_token_hash
   order by c.created_at desc limit 1 for update;
  if v_claim.id is null then
    adopted := false; reason := 'no_claim_or_bad_token'; return next; return;
  end if;

  -- 2) Tenant vem do CONTROLADOR (máquina do técnico, já adotada e ativa). Desconhecido
  --    -> bloqueia (sem tenant pra atribuir).
  if coalesce(p_controller_rustdesk_id, '') = '' then
    adopted := false; reason := 'unknown_controller'; return next; return;
  end if;
  select ab.tenant_id into v_tenant
    from public.address_book ab
   where ab.rustdesk_id = p_controller_rustdesk_id and ab.is_active is distinct from false
   limit 1;
  if v_tenant is null then
    adopted := false; reason := 'unknown_controller'; return next; return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text, 42));

  -- 3) Adota: cria o device 'approved' reusando o token do claim. created_by null =
  --    adoção automática (não houve clique humano).
  insert into public.address_book
    (tenant_id, rustdesk_id, alias, os, agent_token_hash, enrollment_status, created_by)
  values
    (v_tenant, p_rustdesk_id, v_claim.hostname, v_claim.os, v_claim.agent_token_hash,
     'approved'::public.enrollment_status, null)
  returning id into v_dev;

  update private.device_claims
     set status = 'approved', tenant_id = v_tenant, device_id = v_dev, approved_at = now()
   where id = v_claim.id;
  update private.device_claims
     set status = 'rejected'
   where rustdesk_id = p_rustdesk_id and status = 'waiting' and id <> v_claim.id;

  device_id := v_dev; tenant_id := v_tenant; adopted := true; reason := null;
  return next;
end;
$$;

revoke all on function public.auto_adopt_direct(text, text, text) from public, anon, authenticated;
grant execute on function public.auto_adopt_direct(text, text, text) to service_role;
