import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  MonitorSmartphone,
  Activity,
  Radio,
  Cpu,
  HardDrive,
  Gauge,
} from "lucide-react";
import { PageHeader, SectionHeader } from "@/components/ui-shell/page-header";
import { MetricStrip, type MetricItemData } from "@/components/ui-shell/metric-strip";
import { StatusDot } from "@/components/ui-shell/status-dot";

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

  const metrics: MetricItemData[] = [];
  if (!isTech) {
    metrics.push({
      label: "Usuários ativos",
      value: stats.data?.users ?? 0,
      hint: hintUsuarios,
      icon: Users,
      loading: stats.isLoading,
    });
  }
  metrics.push(
    {
      label: "Dispositivos",
      value: stats.data?.devices ?? 0,
      hint: hintDispositivos,
      icon: MonitorSmartphone,
      loading: stats.isLoading,
    },
    {
      label: "Sessões ativas",
      value: stats.data?.activeSessions ?? 0,
      hint: hintAtivas,
      icon: Radio,
      loading: stats.isLoading,
    },
    {
      label: "Sessões 24h",
      value: stats.data?.sessions24h ?? 0,
      hint: hint24h,
      icon: Activity,
      loading: stats.isLoading,
    },
  );

  return (
    <div className="px-6 py-6 space-y-6">
      <PageHeader
        title="Dashboard"
        description="Visão geral em tempo quase-real do seu ambiente."
        actions={
          <>
            {isSuper && (
              <span className="rounded border border-border-subtle px-2 py-0.5 text-[11px] uppercase tracking-widest text-text-dim">
                Plataforma
              </span>
            )}
            <StatusDot tone="active" pulse>
              ao vivo
            </StatusDot>
          </>
        }
      />

      <MetricStrip items={metrics} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]">
        {/* MONITORAMENTO DO RELAY */}
        <section className="rounded-lg border border-border-subtle bg-surface">
          <SectionHeaderRow
            title="Monitoramento do relay"
            description="Saúde da VPS compartilhada"
            status={
              ativo ? (
                <StatusDot tone="online" pulse>
                  ao vivo · há {idadeSeg}s
                </StatusDot>
              ) : (
                <StatusDot tone="warning">aguardando coletor</StatusDot>
              )
            }
          />
          <div className="grid grid-cols-3 divide-x divide-border-subtle">
            <RelayMetric
              label="CPU"
              icon={Cpu}
              value={latest ? `${Number(latest.cpu_pct).toFixed(1)}%` : undefined}
              loading={vpsMetrics.isLoading}
            />
            <RelayMetric
              label="Memória"
              icon={Gauge}
              value={latest ? `${Number(latest.mem_pct).toFixed(1)}%` : undefined}
              loading={vpsMetrics.isLoading}
            />
            <RelayMetric
              label="Disco"
              icon={HardDrive}
              value={latest ? `${Number(latest.disk_pct).toFixed(0)}%` : undefined}
              loading={vpsMetrics.isLoading}
            />
          </div>
        </section>

        {/* STATUS DO SISTEMA */}
        <section className="rounded-lg border border-border-subtle bg-surface">
          <SectionHeaderRow title="Status do sistema" description="Componentes essenciais" />
          <ul className="divide-y divide-border-subtle">
            <StatusRow label="API do painel" tone="online" />
            <StatusRow label="Banco (RLS)" tone="online" />
            <StatusRow
              label="Coletor VPS"
              tone={ativo ? "online" : "warning"}
              note={ativo ? undefined : "sem amostras"}
            />
            <StatusRow label="Realtime" tone="online" />
          </ul>
        </section>
      </div>
    </div>
  );
}

function SectionHeaderRow({
  title,
  description,
  status,
}: {
  title: string;
  description?: string;
  status?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-foreground">{title}</div>
        {description && (
          <div className="text-[11px] text-muted-foreground">{description}</div>
        )}
      </div>
      {status}
    </div>
  );
}

function RelayMetric({
  label,
  icon: Icon,
  value,
  loading,
}: {
  label: string;
  icon: typeof Cpu;
  value?: string;
  loading: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5 px-5 py-4 min-w-0">
      <div className="flex items-center gap-2 text-text-dim">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
        <span className="text-[10.5px] uppercase tracking-[0.14em] font-medium">{label}</span>
      </div>
      {loading ? (
        <Skeleton className="h-7 w-16" />
      ) : (
        <div className="text-[22px] font-semibold tabular-nums text-foreground leading-none font-mono">
          {value ?? "—"}
        </div>
      )}
    </div>
  );
}

function StatusRow({
  label,
  tone,
  note,
}: {
  label: string;
  tone: "online" | "warning" | "danger";
  note?: string;
}) {
  return (
    <li className="flex items-center justify-between px-4 h-11 text-[13px]">
      <span className="text-foreground">{label}</span>
      <div className="flex items-center gap-2">
        {note && <span className="text-[11px] text-text-dim">{note}</span>}
        <StatusDot tone={tone} />
      </div>
    </li>
  );
}