-- ============================================================================
-- FIX: tenant_has_feature precisa estar em 'public' para o PostgREST expo-la.
--
-- CAUSA: criei em 'private' por reflexo. O supabase-js faz
-- POST /rest/v1/rpc/<fn>, e o PostgREST so enxerga o schema public
-- (mesmo motivo de get_device_secret/set_device_secret/provision_tenant
-- viverem em public, apesar de tocarem dados sensiveis).
-- Resultado: featErr -> feature_check_failed -> 500.
--
-- SEGURANCA NAO MUDA: o schema define EXPOSICAO; quem define ACESSO e o GRANT.
-- Continua service_role-only, exatamente como get/set_device_secret.
--
-- private.is_internal_feature NAO se move: e chamada de dentro da policy
-- (SQL puro, sem PostgREST), entao 'private' e o lugar certo pra ela.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tenant_has_feature(p_tenant_id uuid, p_feature_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT tf.enabled
       FROM public.tenant_features tf
      WHERE tf.tenant_id = p_tenant_id
        AND tf.feature_key = p_feature_key),
    (SELECT f.is_default
       FROM public.features f
      WHERE f.key = p_feature_key),
    false
  );
$$;

COMMENT ON FUNCTION public.tenant_has_feature(uuid, text) IS
  'Feature ligada para o tenant? tenant_features.enabled vence; na ausencia usa features.is_default. Exposta via PostgREST, mas service_role-only por GRANT.';

-- O Supabase auto-concede EXECUTE a anon/authenticated via ALTER DEFAULT
-- PRIVILEGES em TODA funcao nova em public. Sem este REVOKE, qualquer usuario
-- logado poderia sondar quais features cada tenant tem -- inclusive a interna,
-- que acabamos de esconder. Isso anularia o trabalho da migration anterior.
REVOKE ALL ON FUNCTION public.tenant_has_feature(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_has_feature(uuid, text) TO service_role;

-- Remove a versao orfa em private (nao era alcancavel pelo PostgREST).
DROP FUNCTION IF EXISTS private.tenant_has_feature(uuid, text);
