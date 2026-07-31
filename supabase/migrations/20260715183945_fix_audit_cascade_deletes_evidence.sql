-- ============================================================================
-- FIX: as FKs de device_secret_shares apagavam a propria evidencia.
--
-- BUG (meu): device_id e target_tenant_id estavam ON DELETE CASCADE.
-- Consequencia: o tenant que RECEBEU a senha apaga o device dele -> o registro
-- de que houve compartilhamento SOME. O auditado apagando a auditoria.
-- (source_device_id/source_tenant_id ja estavam SET NULL -- protegi o lado do
-- dono e esqueci o lado do convidado, que e justamente o que interessa vigiar.)
--
-- CORRECAO: SET NULL nos dois. As colunas de snapshot (rustdesk_id,
-- source_tenant_name, target_tenant_name, shared_by_email) preservam o QUE
-- aconteceu mesmo quando os ponteiros morrem.
-- ============================================================================

-- Snapshot do tenant que recebeu (faltava; so tinha o do source).
ALTER TABLE public.device_secret_shares
  ADD COLUMN IF NOT EXISTS target_tenant_name text;

UPDATE public.device_secret_shares s
   SET target_tenant_name = t.name
  FROM public.tenants t
 WHERE t.id = s.target_tenant_id AND s.target_tenant_name IS NULL;

COMMENT ON COLUMN public.device_secret_shares.target_tenant_name IS
  'Snapshot do nome do tenant que RECEBEU. Sobrevive a exclusao do tenant.';

-- SET NULL exige nullable.
ALTER TABLE public.device_secret_shares
  ALTER COLUMN device_id DROP NOT NULL,
  ALTER COLUMN target_tenant_id DROP NOT NULL;

ALTER TABLE public.device_secret_shares
  DROP CONSTRAINT device_secret_shares_device_id_fkey,
  ADD  CONSTRAINT device_secret_shares_device_id_fkey
       FOREIGN KEY (device_id) REFERENCES public.address_book(id) ON DELETE SET NULL;

ALTER TABLE public.device_secret_shares
  DROP CONSTRAINT device_secret_shares_target_tenant_id_fkey,
  ADD  CONSTRAINT device_secret_shares_target_tenant_id_fkey
       FOREIGN KEY (target_tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;

COMMENT ON TABLE public.device_secret_shares IS
  'Registro imutavel de compartilhamento de senha entre tenants. TODAS as FKs sao ON DELETE SET NULL de proposito: apagar device ou tenant NAO pode apagar a evidencia. Os campos de snapshot (rustdesk_id, source_tenant_name, target_tenant_name, shared_by_email) sao a fonte da verdade historica.';
