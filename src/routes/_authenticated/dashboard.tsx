import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Users,
  MonitorSmartphone,
  Activity,
  Radio,
  Cpu,
  HardDrive,
  Gauge,
  AlertTriangle,
  Network,
} from "lucide-react";

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

type RecentDevice = {
  id: string;
  rustdesk_id: string | null;
  alias: string | null;
  device_group: string | null;
  os: string | null;
  last_online: string | null;
  is_active: boolean | null;
  tenants: { name: string | null } | null;
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
          supabase.from("connection_logs").select("id", { count: "exact", head: true }).eq("status", "active").gt("last_heartbeat_at", new Date(Date.now() - 90000).toISOString()),
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

  const recentDevices = useQuery({
    queryKey: ["dashboard-recent-devices", me?.role, me?.tenant_id],
    enabled: !!me,
    queryFn: async () => {
      const isSuper = me!.role === "super_admin";
      if (!isSuper && !me!.tenant_id) {
        throw new Error("Perfil sem empresa vinculada");
      }
      let query = supabase
        .from("address_book")
        .select("id, rustdesk_id, alias, device_group, os, last_online, is_active, tenants(name)")
        .order("created_at", { ascending: false })
        .limit(6);
      if (!isSuper) query = query.eq("tenant_id", me!.tenant_id as string);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as RecentDevice[];
    },
  });

  const [realtimeOk, setRealtimeOk] = useState(false);

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
      .subscribe((status) => {
        setRealtimeOk(status === "SUBSCRIBED");
      });

    return () => {
      setRealtimeOk(false);
      supabase.removeChannel(channel);
    };
  }, []);

  const latest = vpsMetrics.data?.[0] ?? null;
  const previous = vpsMetrics.data?.[1] ?? null;

  let netMbps: string | undefined = undefined;
  if (latest && previous) {
    const dt =
      (new Date(latest.captured_at).getTime() -
        new Date(previous.captured_at).getTime()) / 1000;
    const bytes =
      Number(latest.net_rx_bytes) - Number(previous.net_rx_bytes) +
      (Number(latest.net_tx_bytes) - Number(previous.net_tx_bytes));
    if (dt > 0) netMbps = ((bytes * 8) / dt / 1e6).toFixed(2) + " Mbps";
  }

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
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

  const subtitulo = stats.data
    ? isSuper
      ? `Plataforma · ${stats.data.devices} dispositivos · ${stats.data.activeSessions} sessões ativas`
      : `${stats.data.devices} dispositivos · ${stats.data.activeSessions} sessões ativas`
    : "Carregando visão geral…";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">{subtitulo}</p>
        </div>
          <Badge variant="outline" className="gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          ao vivo
        </Badge>
      </div>

      <div className={`grid gap-4 grid-cols-2 ${isTech ? "lg:grid-cols-3" : "lg:grid-cols-4"}`}>
        {!isTech && (
          <StatCard
            title="Usuários ativos"
            value={stats.data?.users}
            icon={Users}
            hint={hintUsuarios}
            loading={stats.isLoading}
            color="blue"
          />
        )}
        <StatCard
          title="Dispositivos"
          value={stats.data?.devices}
          icon={MonitorSmartphone}
          hint={hintDispositivos}
          loading={stats.isLoading}
          color="emerald"
        />
        <StatCard
          title="Sessões ativas"
          value={stats.data?.activeSessions}
          icon={Radio}
          hint={hintAtivas}
          loading={stats.isLoading}
          color="amber"
        />
        <StatCard
          title="Sessões 24h"
          value={stats.data?.sessions24h}
          icon={Activity}
          hint={hint24h}
          loading={stats.isLoading}
          color="violet"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 border-border/60">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Monitoramento do relay</CardTitle>
                <CardDescription>Saúde da VPS compartilhada (super_admin)</CardDescription>
              </div>
              {ativo ? (
                <Badge variant="outline" className="gap-1.5 text-emerald-500 border-emerald-500/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  ao vivo · há {idadeSeg}s
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1.5 text-muted-foreground">
                  <AlertTriangle className="h-3 w-3" />
                  aguardando coletor
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {vpsMetrics.isLoading ? (
              <>
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </>
            ) : (
              <>
                <MetricPlaceholder
                  label="CPU"
                  icon={Cpu}
                  value={latest ? `${Number(latest.cpu_pct).toFixed(1)}%` : undefined}
                  color="sky"
                />
                <MetricPlaceholder
                  label="Memória"
                  icon={Gauge}
                  value={latest ? `${Number(latest.mem_pct).toFixed(1)}%` : undefined}
                  color="violet"
                />
                <MetricPlaceholder
                  label="Disco"
                  icon={HardDrive}
                  value={latest ? `${Number(latest.disk_pct).toFixed(0)}%` : undefined}
                  color="amber"
                />
                <MetricPlaceholder label="Rede" icon={Network} value={netMbps} color="emerald" />
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-base">Status do sistema</CardTitle>
            <CardDescription>Componentes essenciais</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <StatusRow label="API do painel" ok={!stats.isError} />
            <StatusRow label="Banco (RLS)" ok={!stats.isError} />
            <StatusRow label="Coletor VPS" ok={ativo} note={ativo ? undefined : "sem amostras"} />
            <StatusRow label="Realtime" ok={realtimeOk} note={realtimeOk ? undefined : "conectando"} />
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/60">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Dispositivos recentes</CardTitle>
            <CardDescription>
              {isSuper ? "Últimos endpoints cadastrados na plataforma" : "Últimos endpoints cadastrados na sua empresa"}
            </CardDescription>
          </div>
          <Link
            to="/dispositivos"
            className="text-xs font-medium text-primary hover:underline"
          >
            Ver todos
          </Link>
        </CardHeader>
        <CardContent>
          {recentDevices.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : !recentDevices.data || recentDevices.data.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Nenhum dispositivo cadastrado.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>SO</TableHead>
                  <TableHead>Grupo</TableHead>
                  {isSuper && <TableHead>Empresa</TableHead>}
                  <TableHead>Status</TableHead>
                  <TableHead>Últ. online</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentDevices.data.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.alias ?? d.rustdesk_id ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{d.os ?? "—"}</TableCell>
                    <TableCell>
                      {d.device_group ? (
                        <Badge variant="secondary">{d.device_group}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {isSuper && (
                      <TableCell className="text-muted-foreground">
                        {d.tenants?.name ?? "—"}
                      </TableCell>
                    )}
                    <TableCell>
                      <Badge variant={d.is_active ? "outline" : "secondary"}>
                        {d.is_active ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {d.last_online ? new Date(d.last_online).toLocaleString("pt-BR") : "nunca"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const STAT_COLORS = {
  blue: { icon: "text-blue-500", wrap: "bg-blue-500/10" },
  emerald: { icon: "text-emerald-500", wrap: "bg-emerald-500/10" },
  amber: { icon: "text-amber-500", wrap: "bg-amber-500/10" },
  violet: { icon: "text-violet-500", wrap: "bg-violet-500/10" },
} as const;

function StatCard({
  title,
  value,
  icon: Icon,
  hint,
  loading,
  color = "blue",
}: {
  title: string;
  value: number | undefined;
  icon: typeof Users;
  hint: string;
  loading: boolean;
  color?: keyof typeof STAT_COLORS;
}) {
  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-center justify-between pb-3 space-y-0">
        <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground">
          {title}
        </CardTitle>
        <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${STAT_COLORS[color].wrap}`}>
          <Icon className={`h-4 w-4 ${STAT_COLORS[color].icon}`} />
        </div>
      </CardHeader>
      <CardContent className="pt-1">
        {loading ? (
          <Skeleton className="h-10 w-20" />
        ) : (
          <div className="text-4xl font-semibold tabular-nums tracking-tight">{value ?? 0}</div>
        )}
        <p className="text-[11px] text-muted-foreground mt-2">{hint}</p>
      </CardContent>
    </Card>
  );
}

const METRIC_COLORS = {
  sky: "text-sky-400",
  violet: "text-violet-400",
  amber: "text-amber-400",
  emerald: "text-emerald-400",
} as const;

function MetricPlaceholder({
  label,
  icon: Icon,
  value,
  color = "sky",
}: {
  label: string;
  icon: typeof Cpu;
  value?: string;
  color?: keyof typeof METRIC_COLORS;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4 flex flex-col items-center justify-center text-center gap-2">
      <Icon className={`h-5 w-5 animate-pulse ${METRIC_COLORS[color]}`} />
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums tracking-tight">{value ?? "—"}</div>
    </div>
  );
}

function StatusRow({ label, ok, note }: { label: string; ok: boolean; note?: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
        <span
          className={`h-2 w-2 rounded-full ${ok ? "bg-primary shadow-[0_0_8px_var(--primary)]" : "bg-muted-foreground/40"}`}
        />
      </div>
    </div>
  );
}