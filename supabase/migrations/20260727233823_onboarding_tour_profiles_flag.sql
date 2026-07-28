-- Tour de primeiro acesso do painel.
-- onboarding_done_at null = usuario ainda nao concluiu o passo a passo; o tour
-- aparece (bloqueante) no proximo login. Preenchido uma unica vez, ao concluir.
alter table public.profiles
  add column if not exists onboarding_done_at timestamptz;

-- A migracao 20260713223741 revogou update em public.profiles para authenticated
-- e liberou apenas full_name. O proprio usuario precisa marcar a conclusao do
-- tour, entao liberamos esta coluna especifica: ela nao concede privilegio algum
-- (nao muda role, tenant_id, is_active nem email) e o RLS profiles_update ja
-- limita a linha ao proprio usuario (ou ao admin do mesmo tenant).
grant update (onboarding_done_at) on public.profiles to authenticated;
