CREATE OR REPLACE FUNCTION public.vps_metrics_series(
  p_since  timestamptz DEFAULT now() - interval '24 hours',
  p_bucket interval    DEFAULT interval '15 minutes'
)
RETURNS TABLE (
  bucket           timestamptz,
  amostras         integer,
  cpu_avg          numeric,
  cpu_max          numeric,
  load1_avg        numeric,
  load1_max        numeric,
  steal_avg        numeric,
  steal_max        numeric,
  mem_pct_max      numeric,
  mem_avail_min_mb integer,
  disk_pct_max     numeric,
  net_avg_mbps     numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $fn$
  SELECT
    date_bin(p_bucket, captured_at, timestamptz '2000-01-01'),
    count(*)::int,
    round(avg(cpu_pct), 2),
    max(cpu_pct),
    round(avg(load1), 2),
    max(load1),
    round(avg(cpu_steal_pct), 2),
    max(cpu_steal_pct),
    max(mem_pct),
    min(mem_available_mb),
    max(disk_pct),
    round(
      (greatest(max(net_rx_bytes) - min(net_rx_bytes), 0)
       + greatest(max(net_tx_bytes) - min(net_tx_bytes), 0)) * 8.0
      / nullif(extract(epoch FROM max(captured_at) - min(captured_at)), 0)
      / 1e6, 3)
  FROM public.vps_metrics
  WHERE captured_at >= p_since
  GROUP BY 1
  ORDER BY 1
$fn$;

REVOKE ALL ON FUNCTION public.vps_metrics_series(timestamptz, interval) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vps_metrics_series(timestamptz, interval) TO authenticated;
