ALTER TABLE public.vps_metrics
  ADD COLUMN IF NOT EXISTS ncpu             integer,
  ADD COLUMN IF NOT EXISTS load1            numeric,
  ADD COLUMN IF NOT EXISTS load5            numeric,
  ADD COLUMN IF NOT EXISTS load15           numeric,
  ADD COLUMN IF NOT EXISTS cpu_iowait_pct   numeric,
  ADD COLUMN IF NOT EXISTS cpu_steal_pct    numeric,
  ADD COLUMN IF NOT EXISTS mem_total_mb     integer,
  ADD COLUMN IF NOT EXISTS mem_available_mb integer,
  ADD COLUMN IF NOT EXISTS swap_used_mb     integer,
  ADD COLUMN IF NOT EXISTS disk_used_gb     numeric,
  ADD COLUMN IF NOT EXISTS disk_total_gb    numeric,
  ADD COLUMN IF NOT EXISTS uptime_seconds   bigint;
