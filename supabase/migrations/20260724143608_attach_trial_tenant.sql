-- Vincula o tenant ao documento ja reservado (auditoria).
-- Existe separado porque claim_trial_document so INSERE: uma segunda chamada
-- bateria no UNIQUE e retornaria false sem gravar o tenant_id.
create or replace function public.attach_trial_tenant(
  p_doc_hash text, p_tenant_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $fn$
declare v_ok boolean;
begin
  if auth.uid() is not null and not private.is_super_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;

  update private.trial_documents
     set tenant_id = p_tenant_id
   where doc_hash = p_doc_hash and tenant_id is null;

  get diagnostics v_ok = row_count;
  return v_ok;
end;
$fn$;

revoke all on function public.attach_trial_tenant(text, uuid) from public, anon, authenticated;
grant execute on function public.attach_trial_tenant(text, uuid) to service_role;
