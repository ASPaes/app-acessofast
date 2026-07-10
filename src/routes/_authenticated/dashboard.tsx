import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
  Users,
  MonitorSmartphone,
  Activity,
  Radio,
  Cpu,
  HardDrive,
  Gauge,
  AlertTriangle,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [{ title: "Dashboard — Acessofast" }, { name: "robots", content: "noindex" }],
  }),
  component: Dashboard,
});

function Dashboard() {
  const stats = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const [devices, users, activeLogs, logsToday] = await Promise.all([
        supabase.from("address_book").select("id", { count: "exact", head: true }),
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_active", true),
        supabase.from("connection_logs").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase
          .from("connection_logs")
          .select("id", { count: "exact", head: true })
          .gte("session_start", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
      ]);
      return {
        devices: devices.count ?? 0,
        users: users.count ?? 0,
        activeSessions: activeLogs.count ?? 0,
        sessions24h: logsToday.count ?? 0,
      };
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Visão geral em tempo quase-real do seu ambiente.
          </p>
        </div>
        <Badge variant="outline" className="gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
          ao vivo
        </Badge>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Usuários ativos"
          value={stats.data?.users}
          icon={Users}
          hint="Contas habilitadas no seu tenant"
          loading={stats.isLoading}
        />
        <StatCard
          title="Dispositivos"
          value={stats.data?.devices}
          icon={MonitorSmartphone}
          hint="Endpoints no address book"
          loading={stats.isLoading}
        />
        <StatCard
          title="Sessões ativas"
          value={stats.data?.activeSessions}
          icon={Radio}
          hint="Conexões em andamento agora"
          loading={stats.isLoading}
        />
        <StatCard
          title="Sessões 24h"
          value={stats.data?.sessions24h}
          icon={Activity}
          hint="Total nas últimas 24 horas"
          loading={stats.isLoading}
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
              <Badge variant="outline" className="gap-1.5 text-muted-foreground">
                <AlertTriangle className="h-3 w-3" />
                aguardando coletor
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-4">
            <MetricPlaceholder label="CPU" icon={Cpu} />
            <MetricPlaceholder label="Memória" icon={Gauge} />
            <MetricPlaceholder label="Disco" icon={HardDrive} />
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-base">Status do sistema</CardTitle>
            <CardDescription>Componentes essenciais</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <StatusRow label="API do painel" ok />
            <StatusRow label="Banco (RLS)" ok />
            <StatusRow label="Coletor VPS" ok={false} note="não configurado" />
            <StatusRow label="Realtime" ok />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  hint,
  loading,
}: {
  title: string;
  value: number | undefined;
  icon: typeof Users;
  hint: string;
  loading: boolean;
}) {
  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-primary" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <div className="text-3xl font-semibold tabular-nums">{value ?? 0}</div>
        )}
        <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>
      </CardContent>
    </Card>
  );
}

function MetricPlaceholder({ label, icon: Icon }: { label: string; icon: typeof Cpu }) {
  return (
    <div className="rounded-md border border-dashed border-border/60 p-4 flex flex-col items-center justify-center text-center gap-2">
      <Icon className="h-5 w-5 text-muted-foreground" />
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold text-muted-foreground/60 tabular-nums">—</div>
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