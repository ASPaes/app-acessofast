-- Hardening telemetria: vps_metrics = escrita-so-service_role, leitura-so-super_admin.
-- authenticated perde INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER; mantem SELECT (RLS ja restringe a super_admin).
-- Ingestao segue via Edge Function vps-metrics-ingest (service_role) - nao afetada.
revoke insert, update, delete, truncate, references, trigger on public.vps_metrics from authenticated;