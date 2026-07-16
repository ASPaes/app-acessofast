import { createFileRoute } from "@tanstack/react-router";
import { Cpu, Gauge, HardDrive, Network } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";

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
    <>
      <PageHeader
        title="Monitoramento"
        subtitle="CPU, memória, disco e rede do relay compartilhado (super_admin)."
      />
      <div className="p-6 space-y-4">
        {isLoading ? (
          <Skeleton className="h-6 w-64" />
        ) : isActive ? (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
            Coletor ativo · última amostra há {ageSec}s
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

        <div className="rounded-md border border-border/60 bg-card overflow-hidden">
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-border/60">
            {cards.map(({ label, icon: Icon, value }) => (
              <div key={label} className="px-5 py-4 min-h-[96px] flex flex-col justify-center">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-medium">
                    {label}
                  </span>
                  <Icon className="h-3.5 w-3.5 text-muted-foreground/70" strokeWidth={1.5} />
                </div>
                {isLoading ? (
                  <Skeleton className="h-7 w-20" />
                ) : (
                  <div className="text-[22px] font-semibold tabular-nums leading-none">{value}</div>
                )}
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  {latest ? "atualizado agora" : "sem amostras"}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}