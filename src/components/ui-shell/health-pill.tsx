import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StatusDot } from "@/components/ui-shell/status-dot";

export function HealthPill({ enabled }: { enabled: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, [enabled]);

  const { data } = useQuery({
    queryKey: ["header-relay-health"],
    enabled,
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vps_metrics")
        .select("captured_at")
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (!enabled || !data?.captured_at) return null;

  const idade = Math.max(0, Math.floor((now - new Date(data.captured_at).getTime()) / 1000));
  if (idade <= 60) {
    return <StatusDot tone="online">Servidor operacional</StatusDot>;
  }
  return <StatusDot tone="warning">{`Coletor parado há ${idade}s`}</StatusDot>;
}