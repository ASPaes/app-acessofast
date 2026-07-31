-- ============================================================================
-- Defense-in-depth nos GRANTs de device_secret_shares.
--
-- O read-back mostrou que o Supabase auto-concedeu SELECT/INSERT/UPDATE/DELETE
-- a anon e authenticated via ALTER DEFAULT PRIVILEGES. A RLS ja bloqueia (ligada
-- + zero policies de escrita), mas GRANT frouxo + RLS e uma camada so: basta uma
-- policy permissiva criada por engano (o Lovable ja criou objeto de seguranca por
-- conta propria neste projeto) para a auditoria virar editavel.
--
-- Auditoria que pode ser apagada nao e auditoria.
-- ============================================================================

REVOKE ALL ON TABLE public.device_secret_shares FROM anon;
REVOKE ALL ON TABLE public.device_secret_shares FROM public;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.device_secret_shares FROM authenticated;

-- authenticated mantem SELECT: a policy dss_select filtra para super_admin
-- (que e um authenticated). Sem este GRANT, nem o super_admin leria.
GRANT SELECT ON TABLE public.device_secret_shares TO authenticated;

-- service_role escreve (Edge Function). Nao concedemos UPDATE/DELETE nem a ele:
-- o backend so precisa INSERIR o registro do compartilhamento.
GRANT SELECT, INSERT ON TABLE public.device_secret_shares TO service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.device_secret_shares FROM service_role;
