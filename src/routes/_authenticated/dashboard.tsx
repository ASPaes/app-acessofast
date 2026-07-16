import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Cpu, HardDrive, Gauge, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { MetricStrip, type MetricItem } from "@/components/metric-strip";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [{ title: "Dashboard — Acessofast" }, { name: "robots", content: "noindex" }],
  }),
  component: Dashboard,
});

type VpsMetric = {
  captured_at: string;
  cpu_pct: number | string | null;
  mem_pct: number | string | null;
  disk_pct: number | string | null;
  net_rx_bytes: number | string | null;
  net_tx_bytes: number | string | null;
};

function Dashboard() {
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      const uid = userData.user?.id;
      if (!uid) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("id, role, tenant_id")
        .eq("id", uid)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const stats = useQuery({
    queryKey: ["dashboard-stats", me?.role, me?.tenant_id],
    enabled: !!me,
    queryFn: async () => {
      const isSuper = me!.role === "super_admin";
      if (!isSuper && !me!.tenant_id) {
        throw new Error("Perfil sem empresa vinculada");
      }
      const tid = me!.tenant_id as string;
      const withTenant = <T extends { eq: (c: string, v: string) => T }>(q: T): T =>
        isSuper ? q : q.eq("tenant_id", tid);
      const [devices, users, activeLogs, logsToday] = await Promise.all([
        withTenant(supabase.from("address_book").select("id", { count: "exact", head: true })),
        withTenant(
          supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_active", true),
        ),
        withTenant(
          supabase.from("connection_logs").select("id", { count: "exact", head: true }).eq("status", "active"),
        ),
        withTenant(
          supabase
            .from("connection_logs")
            .select("id", { count: "exact", head: true })
            .gte("session_start", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
        ),
      ]);
      return {
        devices: devices.count ?? 0,
        users: users.count ?? 0,
        activeSessions: activeLogs.count ?? 0,
        sessions24h: logsToday.count ?? 0,
      };
    },
  });

  const vpsMetrics = useQuery({
    queryKey: ["dashboard-vps-metrics"],
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
      .channel("dashboard_vps_rt")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "vps_metrics" },
        () => {
          vpsMetrics.refetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const latest = vpsMetrics.data?.[0] ?? null;
  const now = Date.now();
  const capturedAt = latest ? new Date(latest.captured_at).getTime() : null;
  const idadeSeg = capturedAt != null ? Math.floor((now - capturedAt) / 1000) : null;
  const ativo = latest != null && idadeSeg != null && idadeSeg <= 60;

  const role = me?.role;
  const isSuper = role === "super_admin";
  const isTech = role === "tech";

  const hintUsuarios = isSuper ? "Contas de todas as empresas" : "Contas habilitadas no seu tenant";
  const hintDispositivos = isSuper ? "Endpoints de todas as empresas" : "Endpoints no address book";
  const hintAtivas = isSuper
    ? "Em andamento na plataforma"
    : isTech
      ? "Minhas conexões em andamento"
      : "Conexões em andamento agora";
  const hint24h = isSuper
    ? "Total da plataforma em 24h"
    : isTech
      ? "Minhas sessões nas últimas 24h"
      : "Total nas últimas 24 horas";

  const fmt = (v: number | undefined) =>
    stats.isLoading ? <Skeleton className="h-6 w-14" /> : (v ?? 0).toLocaleString("pt-BR");

  const metrics: MetricItem[] = [];
  if (!isTech) {
    metrics.push({ label: "Usuários ativos", value: fmt(stats.data?.users), hint: hintUsuarios });
  }
  metrics.push(
    { label: "Dispositivos", value: fmt(stats.data?.devices), hint: hintDispositivos },
    { label: "Sessões ativas", value: fmt(stats.data?.activeSessions), hint: hintAtivas },
    { label: "Sessões 24h", value: fmt(stats.data?.sessions24h), hint: hint24h },
  );

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Dashboard
            {isSuper && (
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground border border-border/60 rounded-sm px-1.5 py-0.5">
                Plataforma
              </span>
            )}
          </span>
        }
        subtitle="Visão geral em tempo quase-real do seu ambiente."
        actions={
          <Badge variant="outline" className="gap-1.5 rounded-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            ao vivo
          </Badge>
        }
      />

      <div className="p-6 space-y-5">
        <MetricStrip items={metrics} />

        <div className="grid gap-4 lg:grid-cols-3">
          <section className="lg:col-span-2 rounded-md border border-border/60 bg-card">
            <div className="h-11 px-4 flex items-center justify-between border-b border-border/60">
              <div className="flex items-baseline gap-2">
                <h2 className="text-[13px] font-medium text-foreground">Monitoramento do relay</h2>
                <span className="text-[11px] text-muted-foreground">
                  saúde da VPS compartilhada
                </span>
              </div>
              {ativo ? (
                <span className="flex items-center gap-1.5 text-[11px] text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  ao vivo · há {idadeSeg}s
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <AlertTriangle className="h-3 w-3" />
                  aguardando coletor
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 divide-x divide-border/60">
              {[
                { label: "CPU", icon: Cpu, value: latest ? `${Number(latest.cpu_pct).toFixed(1)}%` : "—" },
                { label: "Memória", icon: Gauge, value: latest ? `${Number(latest.mem_pct).toFixed(1)}%` : "—" },
                { label: "Disco", icon: HardDrive, value: latest ? `${Number(latest.disk_pct).toFixed(0)}%` : "—" },
              ].map(({ label, icon: Icon, value }) => (
                <div key={label} className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
                    <Icon className="h-3.5 w-3.5 text-muted-foreground/70" strokeWidth={1.5} />
                  </div>
                  {vpsMetrics.isLoading ? (
                    <Skeleton className="h-6 w-16" />
                  ) : (
                    <div className="text-[20px] font-semibold tabular-nums">{value}</div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-md border border-border/60 bg-card">
            <div className="h-11 px-4 flex items-center border-b border-border/60">
              <h2 className="text-[13px] font-medium text-foreground">Status do sistema</h2>
            </div>
            <ul className="divide-y divide-border/60">
              <StatusRow label="API do painel" ok />
              <StatusRow label="Banco (RLS)" ok />
              <StatusRow label="Coletor VPS" ok={ativo} note={ativo ? undefined : "sem amostras"} />
              <StatusRow label="Realtime" ok />
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}

function StatusRow({ label, ok, note }: { label: string; ok: boolean; note?: string }) {
  return (
    <li className="flex items-center justify-between px-4 h-10 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
        <span
          className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-muted-foreground/40"}`}
        />
      </div>
    </li>
  );
}