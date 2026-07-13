-- Fecha priv-esc: authenticated deixa de poder alterar colunas sensiveis da propria linha.
-- role / tenant_id / is_active / email / id / timestamps passam a mudar SOMENTE via RPC vetado
-- (assign_member, provision_tenant) ou service_role. full_name continua auto-editavel.
revoke update on public.profiles from authenticated;
grant  update (full_name) on public.profiles to authenticated;