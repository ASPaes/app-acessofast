-- ============================================================================
-- Auditoria de compartilhamento de senha entre tenants.
--
-- POR QUE EXISTE: a decisao de ligar o cross_tenant_secret_share foi tomada com
-- a premissa "se eu ver que e risco, retiramos". Sem registro nao ha o que ver:
-- entrega de senha nao gera erro, nao aparece em log de conexao, nao trava nada.
-- Esta tabela e o unico lugar onde "o tenant X pegou a senha do tenant Y" fica
-- visivel depois do fato.
--
-- Imutavel por design: sem UPDATE/DELETE para ninguem (nem super_admin via API).
-- Se pudesse ser editada, nao seria auditoria.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.device_secret_shares (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- quem RECEBEU a senha
  device_id         uuid NOT NULL REFERENCES public.address_book(id) ON DELETE CASCADE,
  target_tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- de quem VEIO (ON DELETE SET NULL: se o dono apagar o device, o registro
  -- de que houve compartilhamento NAO some -- so perde o ponteiro)
  source_device_id  uuid REFERENCES public.address_book(id) ON DELETE SET NULL,
  source_tenant_id  uuid REFERENCES public.tenants(id) ON DELETE SET NULL,

  -- snapshot textual: sobrevive a exclusao do device/tenant de origem
  rustdesk_id       text NOT NULL,
  source_tenant_name text,

  shared_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  shared_by_email   text,
  shared_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.device_secret_shares IS
  'Registro imutavel: cada vez que um tenant recebeu a senha ja existente de outro tenant (feature cross_tenant_secret_share).';
COMMENT ON COLUMN public.device_secret_shares.source_tenant_name IS
  'Snapshot do nome na hora do compartilhamento. Sobrevive a exclusao do tenant de origem.';

CREATE INDEX IF NOT EXISTS idx_dss_rustdesk_id      ON public.device_secret_shares(rustdesk_id);
CREATE INDEX IF NOT EXISTS idx_dss_target_tenant    ON public.device_secret_shares(target_tenant_id, shared_at DESC);
CREATE INDEX IF NOT EXISTS idx_dss_source_tenant    ON public.device_secret_shares(source_tenant_id, shared_at DESC);

ALTER TABLE public.device_secret_shares ENABLE ROW LEVEL SECURITY;

-- SELECT: somente super_admin.
-- O tenant NAO ve. Coerente com a decisao de esconder a flag: se o admin
-- enxergasse esta tabela, deduziria a existencia da feature pelo efeito.
CREATE POLICY dss_select ON public.device_secret_shares
  FOR SELECT
  USING (private.is_super_admin());

COMMENT ON POLICY dss_select ON public.device_secret_shares IS
  'Somente super_admin. Tenant nao ve -- senao deduziria a feature interna pelo efeito.';

-- Sem policy de INSERT/UPDATE/DELETE de proposito: RLS ligada + zero policies
-- = ninguem escreve via API. So service_role (Edge Function), que bypassa RLS.
-- Nem o super_admin consegue alterar o historico pelo painel.
