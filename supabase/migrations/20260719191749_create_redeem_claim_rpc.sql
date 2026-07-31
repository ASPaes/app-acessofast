create or replace function public.redeem_claim(
  p_rustdesk_id text, p_tenant_id uuid, p_actor uuid, p_alias text default null
) returns table(r_device_id uuid, r_was_inserted boolean, r_hostname text, r_os text)
language plpgsql security definer set search_path = '' as $fn$
declare
  v_claim  private.device_claims%rowtype;
  v_device uuid;
  v_ins    boolean;
begin
  -- claim MAIS RECENTE em espera pra este ID (reinstalação gera vários); trava a linha
  select * into v_claim from private.device_claims
   where rustdesk_id = p_rustdesk_id and status = 'waiting' and expires_at > now()
   order by created_at desc limit 1 for update;
  if v_claim.id is null then
    raise exception 'no_pending_claim' using errcode = 'P0002';
  end if;

  select id into v_device from public.address_book
   where tenant_id = p_tenant_id and rustdesk_id = p_rustdesk_id;
  v_ins := (v_device is null);

  if v_ins then
    -- device NOVO: cria já 'approved' (a adoção do técnico É a aprovação humana)
    insert into public.address_book
      (tenant_id, rustdesk_id, alias, os, agent_token_hash, enrollment_status, created_by)
    values
      (p_tenant_id, p_rustdesk_id, coalesce(p_alias, v_claim.hostname), v_claim.os,
       v_claim.agent_token_hash, 'approved', p_actor)
    returning id into v_device;
  else
    -- device EXISTENTE (reinstalou): só rotaciona o token do agente, mantém o resto
    update public.address_book
       set agent_token_hash = v_claim.agent_token_hash, updated_at = now()
     where id = v_device;
  end if;

  update private.device_claims
     set status='approved', tenant_id=p_tenant_id, device_id=v_device,
         approved_by=p_actor, approved_at=now()
   where id = v_claim.id;

  -- claims velhos em espera pro mesmo ID (nonces mortos) -> rejeitados
  update private.device_claims set status='rejected'
   where rustdesk_id = p_rustdesk_id and status='waiting' and id <> v_claim.id;

  r_device_id := v_device; r_was_inserted := v_ins;
  r_hostname := v_claim.hostname; r_os := v_claim.os;
  return next;
end; $fn$;

revoke all on function public.redeem_claim(text,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.redeem_claim(text,uuid,uuid,text) to service_role;
