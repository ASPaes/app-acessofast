-- ============================================================================
-- Esconde features internas de admin/head/tech. Somente super_admin enxerga.
--
-- Precisa dos DOIS lados, senao vaza:
--   1. public.features        -> hoje: features_select USING (true) = todo mundo le
--   2. public.tenant_features -> hoje: USING (is_super_admin OR tenant_id = current)
--
-- INSERT/UPDATE/DELETE de tenant_features JA sao super_admin-only (auditado).
-- Nao mexemos neles.
-- ============================================================================

-- 1. features: some da listagem se for interna.
DROP POLICY IF EXISTS features_select ON public.features;
CREATE POLICY features_select ON public.features
  FOR SELECT
  USING (
    NOT is_internal
    OR private.is_super_admin()
  );

COMMENT ON POLICY features_select ON public.features IS
  'Features internas (is_internal) somente para super_admin. As demais, publicas.';

-- 2. tenant_features: o tenant continua vendo as features dele, MENOS as internas.
--    is_internal_feature e SECURITY DEFINER de proposito: le public.features sem
--    passar pela RLS dela (que acabamos de restringir) -> evita que a policy
--    dependa da visibilidade da propria feature.
DROP POLICY IF EXISTS tenant_features_select ON public.tenant_features;
CREATE POLICY tenant_features_select ON public.tenant_features
  FOR SELECT
  USING (
    private.is_super_admin()
    OR (
      tenant_id = private.current_tenant_id()
      AND NOT private.is_internal_feature(feature_key)
    )
  );

COMMENT ON POLICY tenant_features_select ON public.tenant_features IS
  'Super_admin ve tudo. Tenant ve as proprias features, exceto as internas (is_internal).';
