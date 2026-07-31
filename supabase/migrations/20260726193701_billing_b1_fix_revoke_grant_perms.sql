-- Correcao: fecha as permissoes de revoke_access_grant que faltaram na
-- billing_b1_connect_metering (default do Postgres deixa EXECUTE para PUBLIC).
revoke all on function public.revoke_access_grant(uuid) from public, anon, authenticated;
grant execute on function public.revoke_access_grant(uuid) to service_role;
