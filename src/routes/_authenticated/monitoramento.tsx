import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Cpu, Gauge, HardDrive, Network } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/monitoramento")({
  head: () => ({
    meta: [{ title: "Monitoramento — Acessofast" }, { name: "robots", content: "noindex" }],
  }),
  component: MonitoramentoPage,
});

type VpsMetric = {
  captured_at: string;
  cpu_pct: number | string;
  mem_pct: number | string;
  disk_pct: number | string;
  net_rx_bytes: number | string;
  net_tx_bytes: number | string;
};

function MonitoramentoPage() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["vps-metrics-latest"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vps_metrics")
        .select("captured_at,cpu_pct,mem_pct,disk_pct,net_rx_bytes,net_tx_bytes")
        .order("captured_at", { ascending: false })
        .limit(2);
      if (error) throw error;
      return (data ?? []) as VpsMetric[];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("vps_metrics_rt")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "vps_metrics" },
        () => {
          refetch();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [refetch]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const latest = data?.[0];
  const previous = data?.[1];
  const ageMs = latest ? now - new Date(latest.captured_at).getTime() : null;
  const ageSec = ageMs != null ? Math.max(0, Math.floor(ageMs / 1000)) : null;
  const isActive = ageSec != null && ageSec <= 60;

  let netMbps: string = "—";
  if (latest && previous) {
    const dt =
      (new Date(latest.captured_at).getTime() - new Date(previous.captured_at).getTime()) / 1000;
    const bytes =
      Number(latest.net_rx_bytes) -
      Number(previous.net_rx_bytes) +
      (Number(latest.net_tx_bytes) - Number(previous.net_tx_bytes));
    if (dt > 0) {
      netMbps = ((bytes * 8) / dt / 1e6).toFixed(2) + " Mbps";
    }
  }

  const cards = [
    {
      label: "CPU",
      icon: Cpu,
      value: latest ? Number(latest.cpu_pct).toFixed(1) + "%" : "—",
    },
    {
      label: "Memória",
      icon: Gauge,
      value: latest ? Number(latest.mem_pct).toFixed(1) + "%" : "—",
    },
    {
      label: "Disco",
      icon: HardDrive,
      value: latest ? Number(latest.disk_pct).toFixed(0) + "%" : "—",
    },
    {
      label: "Rede",
      icon: Network,
      value: netMbps,
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Activity className="h-6 w-6 text-primary" />
          Monitoramento da VPS
        </h1>
        <p className="text-sm text-muted-foreground">
          Saúde do relay compartilhado (visível apenas para super_admin).
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-6 w-64" />
      ) : isActive ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
          <span>Coletor ativo · última amostra há {ageSec}s</span>
        </div>
      ) : (
        <Alert>
          <AlertTitle>Sem amostras recentes</AlertTitle>
          <AlertDescription>
            {latest
              ? `A última amostra foi há ${ageSec}s. Verifique o agente na VPS.`
              : "Nenhuma amostra encontrada em vps_metrics."}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {cards.map(({ label, icon: Icon, value }) => (
          <Card key={label} className="border-dashed border-border/60">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground">
                {label}
              </CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-9 w-24" />
              ) : (
                <div className="text-3xl font-semibold tabular-nums">{value}</div>
              )}
              <p className="text-[11px] text-muted-foreground mt-1">
                {latest ? "atualizado agora" : "sem amostras"}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}