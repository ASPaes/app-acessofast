import { createFileRoute } from "@tanstack/react-router";
import { Cpu, Gauge, HardDrive, Network } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ui-shell/page-header";
import { StatusDot } from "@/components/ui-shell/status-dot";

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
    <div className="px-6 py-6 space-y-6">
      <PageHeader
        title="Monitoramento da VPS"
        description="Saúde do relay compartilhado (visível apenas para super_admin)."
        actions={
          isLoading ? (
            <Skeleton className="h-4 w-40" />
          ) : isActive ? (
            <StatusDot tone="online" pulse>
              Coletor ativo · última amostra há {ageSec}s
            </StatusDot>
          ) : (
            <StatusDot tone="warning">
              {latest ? `sem amostras há ${ageSec}s` : "sem amostras"}
            </StatusDot>
          )
        }
      />

      <div className="rounded-lg border border-border-subtle bg-surface">
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-border-subtle">
          {cards.map(({ label, icon: Icon, value }) => (
            <div key={label} className="flex flex-col gap-1.5 px-5 py-4 min-w-0">
              <div className="flex items-center gap-2 text-text-dim">
                <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span className="text-[10.5px] uppercase tracking-[0.14em] font-medium">
                  {label}
                </span>
              </div>
              {isLoading ? (
                <Skeleton className="h-7 w-20" />
              ) : (
                <div className="text-[22px] font-semibold tabular-nums text-foreground leading-none font-mono">
                  {value}
                </div>
              )}
              <div className="text-[11px] text-muted-foreground">
                {latest ? "atualizado agora" : "sem amostras"}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}