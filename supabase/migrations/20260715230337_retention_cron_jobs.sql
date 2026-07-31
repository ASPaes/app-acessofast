-- 1. purge de connection_logs respeitando tenant_settings.log_retention_days por tenant.
--    left join + coalesce: tenant sem tenant_settings cairia fora de um inner join e seus
--    logs NUNCA seriam apagados (falha silenciosa).
create or replace function private.purge_connection_logs_por_tenant()
returns integer language plpgsql security definer set search_path to '' as $fn$
declare removed integer;
begin
  delete from public.connection_logs cl
  using (
    select t.id as tenant_id, coalesce(ts.log_retention_days, 180) as dias
      from public.tenants t
      left join public.tenant_settings ts on ts.tenant_id = t.id
  ) cfg
  where cl.tenant_id = cfg.tenant_id
    and cl.created_at < now() - make_interval(days => cfg.dias);
  get diagnostics removed = row_count;
  return removed;
end; $fn$;

revoke all on function private.purge_connection_logs_por_tenant() from public, anon, authenticated;

-- 2. agendamento (pg_cron roda em UTC no Supabase: 03:10 UTC = 00:10 BRT)
select cron.schedule('acessofast_purge_connection_logs', '10 3 * * *',
  $job$select private.purge_connection_logs_por_tenant();$job$);

select cron.schedule('acessofast_purge_vps_metrics', '20 3 * * *',
  $job$select private.purge_old_vps_metrics(14);$job$);
