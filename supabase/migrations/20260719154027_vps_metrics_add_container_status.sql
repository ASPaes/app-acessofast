ALTER TABLE public.vps_metrics
  ADD COLUMN IF NOT EXISTS hbbs_up boolean,
  ADD COLUMN IF NOT EXISTS hbbr_up boolean;
