-- ============================================================================
-- AcessoFast — Compartilhamento de senha entre empresas (cross-tenant)
--
-- CONTEXTO: 3 empresas diferentes (tenants) atendem o mesmo cliente final e
-- precisam acessar a MESMA maquina fisica. O RustDesk suporta UMA senha
-- permanente por maquina (confirmado na fonte). Hoje o register-device gera
-- senha NOVA por tenant -> o segundo a provisionar SOBRESCREVE o endpoint e
-- derruba o acesso do primeiro, em silencio.
--
-- Esta feature faz o segundo tenant REUSAR a senha existente.
--
-- is_internal: a flag e invisivel para admin/head/tech. Somente super_admin
-- enxerga e controla (a RLS de tenant_features ja e super_admin-only para
-- INSERT/UPDATE/DELETE; falta esconder no SELECT e em features).
-- ============================================================================

-- 1. Marcador de feature interna (generico: serve para qualquer flag futura
--    que deva ficar invisivel para os tenants).
ALTER TABLE public.features
  ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.features.is_internal IS
  'Feature interna: visivel e controlavel somente por super_admin. Escondida das policies de SELECT de features e tenant_features.';

-- 2. A feature.
INSERT INTO public.features (key, name, description, is_default, is_internal)
VALUES (
  'cross_tenant_secret_share',
  'Compartilhamento de senha entre empresas',
  'Quando outra empresa cadastra um rustdesk_id ja existente, recebe a MESMA senha do dono em vez de gerar uma nova (que sobrescreveria o endpoint e derrubaria o acesso do dono).',
  true,
  true
)
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      is_default = EXCLUDED.is_default,
      is_internal = EXCLUDED.is_internal;

-- 3. Helper: a feature e interna?
--    SECURITY DEFINER de proposito: sera chamada DE DENTRO da policy de SELECT
--    de tenant_features. Se disparasse a RLS de public.features, teriamos
--    recursao/inconsistencia. search_path vazio contra hijack.
CREATE OR REPLACE FUNCTION private.is_internal_feature(p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((SELECT f.is_internal FROM public.features f WHERE f.key = p_key), false);
$$;

COMMENT ON FUNCTION private.is_internal_feature(text) IS
  'True se a feature e interna (so super_admin ve). Usada na policy de SELECT de tenant_features.';

-- 4. Helper: o tenant tem a feature ligada?
--    Resolucao: linha explicita em tenant_features vence; na ausencia, cai no
--    features.is_default. Consumida pelo register-device (service_role).
CREATE OR REPLACE FUNCTION private.tenant_has_feature(p_tenant_id uuid, p_feature_key text)
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

COMMENT ON FUNCTION private.tenant_has_feature(uuid, text) IS
  'Feature ligada para o tenant? tenant_features.enabled vence; na ausencia usa features.is_default.';

-- 5. Privilegios.
--    O Supabase auto-concede EXECUTE a anon/authenticated via ALTER DEFAULT
--    PRIVILEGES em toda funcao nova. Revogamos e concedemos so o necessario.
REVOKE ALL ON FUNCTION private.is_internal_feature(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION private.tenant_has_feature(uuid, text) FROM public, anon, authenticated;

-- is_internal_feature roda DENTRO da policy de tenant_features, avaliada no
-- contexto do usuario logado -> authenticated precisa de EXECUTE.
GRANT EXECUTE ON FUNCTION private.is_internal_feature(text) TO authenticated;

-- tenant_has_feature e consumida so pelo backend (Edge Function service_role).
-- Nenhum GRANT a authenticated: o tenant nao precisa saber que a flag existe.
GRANT EXECUTE ON FUNCTION private.tenant_has_feature(uuid, text) TO service_role;
