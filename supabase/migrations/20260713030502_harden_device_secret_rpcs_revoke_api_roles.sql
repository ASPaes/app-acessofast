-- FIX do device_secret_storage_rota_b:
-- os ALTER DEFAULT PRIVILEGES do Supabase concederam EXECUTE a anon/authenticated
-- nas RPCs recem-criadas em public. O "revoke ... from public" nao remove esses
-- grants EXPLICITOS de anon/authenticated. Revogando explicitamente.
-- NOTA PERMANENTE: todo "create or replace" futuro dessas funcoes re-concede via
-- default privileges -> este revoke tem que ser reaplicado junto de qualquer recriacao.
revoke all on function public.set_device_secret(uuid, text, text, smallint, uuid) from anon, authenticated;
revoke all on function public.get_device_secret(uuid) from anon, authenticated;

-- reforca service_role (idempotente)
grant execute on function public.set_device_secret(uuid, text, text, smallint, uuid) to service_role;
grant execute on function public.get_device_secret(uuid) to service_role;