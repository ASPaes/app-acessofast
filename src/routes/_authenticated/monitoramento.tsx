import { createFileRoute } from "@tanstack/react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Activity,
  Boxes,
  Clock,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  Network,
  Radio,
  Server,
  ShieldAlert,
  TrendingUp,
  Zap,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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
  host: string | null;
  ncpu: number | string | null;
  cpu_iowait_pct: number | string | null;
  cpu_steal_pct: number | string | null;
  load1: number | string | null;
  load5: number | string | null;
  load15: number | string | null;
  mem_total_mb: number | string | null;
  mem_available_mb: number | string | null;
  swap_used_mb: number | string | null;
  disk_used_gb: number | string | null;
  disk_total_gb: number | string | null;
  uptime_seconds: number | string | null;
  active_sessions: number | string | null;
  hbbs_up: boolean | null;
  hbbr_up: boolean | null;
};

type AgentHealth = {
  tenant_id: string;
  rustdesk_id: string | null;
  address_book_id: string | null;
  tentativas_totais: number | null;
  sessoes_reais: number | null;
  falhas: number | null;
  abertas_agora: number | null;
  ultimo_heartbeat: string | null;
  ultima_atividade: string | null;
  agente_vivo_24h: boolean | null;
};

type SessionsSummary = {
  tenant_id: string;
  dia: string;
  sessoes: number | null;
  fim_limpo: number | null;
  quedas: number | null;
  acessos_externos: number | null;
  dur_media_s: number | null;
  dur_p50_s: number | null;
  dur_p95_s: number | null;
};

type ExternalAccess = {
  tenant_id: string;
  rustdesk_id: string | null;
  address_book_id: string | null;
  session_start: string | null;
  session_end: string | null;
  duration_seconds: number | null;
  last_heartbeat_at: string | null;
  technician_ip: string | null;
  created_at: string | null;
};

type DeviceRef = {
  id: string;
  alias: string | null;
  rustdesk_id: string | null;
  tenants?: { name: string | null } | null;
};

type VpsSeriesPoint = {
  bucket: string;
  amostras: number;
  cpu_avg: number;
  cpu_max: number;
  load1_avg: number;
  load1_max: number;
  steal_avg: number;
  steal_max: number;
  mem_pct_max: number;
  mem_avail_min_mb: number;
  disk_pct_max: number;
  net_avg_mbps: number;
};

type Range = "24h" | "7d" | "30d";

function rangeParams(r: Range): { p_since: string; p_bucket: string } {
  const now = Date.now();
  if (r === "24h")
    return { p_since: new Date(now - 24 * 3600 * 1000).toISOString(), p_bucket: "15 minutes" };
  if (r === "7d")
    return { p_since: new Date(now - 7 * 86400 * 1000).toISOString(), p_bucket: "1 hour" };
  return { p_since: new Date(now - 30 * 86400 * 1000).toISOString(), p_bucket: "3 hours" };
}

function fmtDur(s: number | null | undefined): string {
  if (s == null || !isFinite(Number(s))) return "—";
  const n = Math.max(0, Math.floor(Number(s)));
  const m = Math.floor(n / 60);
  const ss = n % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

function fmtUptime(seconds: number | string | null | undefined): string {
  if (seconds == null || !isFinite(Number(seconds))) return "—";
  let n = Math.max(0, Math.floor(Number(seconds)));
  const d = Math.floor(n / 86400);
  n -= d * 86400;
  const h = Math.floor(n / 3600);
  n -= h * 3600;
  const m = Math.floor(n / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

function num(v: number | string | null | undefined, digits = 1): string {
  if (v == null || !isFinite(Number(v))) return "—";
  return Number(v).toFixed(digits);
}

const PANEL_GROUPS = [
  { id: "agentes", label: "Agentes", scope: "secao" as const },
  { id: "sessoes", label: "Sessões", scope: "secao" as const },
  { id: "externos", label: "Acessos externos", scope: "secao" as const },
  { id: "vps_containers", label: "Containers", scope: "vps" as const },
  { id: "vps_cpu", label: "CPU & Load", scope: "vps" as const },
  { id: "vps_mem", label: "Memória", scope: "vps" as const },
  { id: "vps_disco", label: "Disco", scope: "vps" as const },
  { id: "vps_rede", label: "Rede/Relay", scope: "vps" as const },
  { id: "vps_trend", label: "Tendência", scope: "vps" as const },
];
const HIDDEN_LS_KEY = "acessofast:monitor:hidden";

function MonitoramentoPage() {
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

  const isSuper = me?.role === "super_admin";
  const isTech = me?.role === "tech";
  const canSecao = !!me && !isTech;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["vps-metrics-latest"],
    enabled: isSuper,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vps_metrics")
        .select(
          "captured_at,cpu_pct,mem_pct,disk_pct,net_rx_bytes,net_tx_bytes,host,ncpu,cpu_iowait_pct,cpu_steal_pct,load1,load5,load15,mem_total_mb,mem_available_mb,swap_used_mb,disk_used_gb,disk_total_gb,uptime_seconds,active_sessions,hbbs_up,hbbr_up",
        )
        .order("captured_at", { ascending: false })
        .limit(2);
      if (error) throw error;
      return (data ?? []) as VpsMetric[];
    },
  });

  const agentHealth = useQuery({
    queryKey: ["mon-agent-health", me?.role, me?.tenant_id],
    enabled: canSecao,
    queryFn: async () => {
      let q = supabase
        .from("v_agent_health" as never)
        .select(
          "tenant_id,rustdesk_id,address_book_id,tentativas_totais,sessoes_reais,falhas,abertas_agora,ultimo_heartbeat,ultima_atividade,agente_vivo_24h",
        )
        .order("ultima_atividade", { ascending: false });
      if (!isSuper) q = q.eq("tenant_id", me!.tenant_id as string);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as AgentHealth[];
    },
  });

  const sessionsSummary = useQuery({
    queryKey: ["mon-sessions-summary", me?.role, me?.tenant_id],
    enabled: canSecao,
    queryFn: async () => {
      let q = supabase
        .from("v_sessions_summary" as never)
        .select(
          "tenant_id,dia,sessoes,fim_limpo,quedas,acessos_externos,dur_media_s,dur_p50_s,dur_p95_s",
        )
        .order("dia", { ascending: false })
        .limit(14);
      if (!isSuper) q = q.eq("tenant_id", me!.tenant_id as string);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as SessionsSummary[];
    },
  });

  const externalAccess = useQuery({
    queryKey: ["mon-external-access", me?.role, me?.tenant_id],
    enabled: canSecao,
    queryFn: async () => {
      let q = supabase
        .from("v_external_access" as never)
        .select(
          "tenant_id,rustdesk_id,address_book_id,session_start,session_end,duration_seconds,last_heartbeat_at,technician_ip,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(20);
      if (!isSuper) q = q.eq("tenant_id", me!.tenant_id as string);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as ExternalAccess[];
    },
  });

  const devices = useQuery({
    queryKey: ["mon-devices-ref", me?.role, me?.tenant_id],
    enabled: canSecao,
    queryFn: async () => {
      let q = supabase.from("address_book").select("id, alias, rustdesk_id, tenants(name)");
      if (!isSuper) q = q.eq("tenant_id", me!.tenant_id as string);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as DeviceRef[];
    },
  });

  const deviceById = new Map<string, DeviceRef>();
  (devices.data ?? []).forEach((d) => deviceById.set(d.id, d));

  const nomeDispositivo = (address_book_id: string | null, rustdesk_id: string | null) => {
    if (address_book_id) {
      const d = deviceById.get(address_book_id);
      if (d) return d.alias ?? d.rustdesk_id ?? "—";
    }
    return rustdesk_id ?? "—";
  };

  const empresaDe = (tenant_id: string, address_book_id: string | null) => {
    if (address_book_id) {
      const d = deviceById.get(address_book_id);
      if (d?.tenants?.name) return d.tenants.name;
    }
    // fallback: qualquer device desse tenant já carregado
    for (const d of deviceById.values()) {
      if (d.tenants?.name) {
        // não sabemos tenant_id em DeviceRef; melhor retornar "—"
        break;
      }
    }
    return "—";
    void tenant_id;
  };

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

  useEffect(() => {
    if (!canSecao) return;
    const channel = supabase
      .channel("mon_conn_logs_rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "connection_logs" },
        () => {
          agentHealth.refetch();
          sessionsSummary.refetch();
          externalAccess.refetch();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSecao]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const [hidden, setHidden] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.localStorage.getItem(HIDDEN_LS_KEY);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? (arr as string[]) : []);
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(HIDDEN_LS_KEY, JSON.stringify(Array.from(hidden)));
    } catch {
      /* ignore */
    }
  }, [hidden]);
  const toggleHidden = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const availableGroups = PANEL_GROUPS.filter((g) =>
    g.scope === "vps" ? isSuper : canSecao,
  );
  const show = (id: string) => !hidden.has(id);

  const latest = data?.[0];
  const previous = data?.[1];
  const ageMs = latest ? now - new Date(latest.captured_at).getTime() : null;
  const ageSec = ageMs != null ? Math.max(0, Math.floor(ageMs / 1000)) : null;
  const isActive = ageSec != null && ageSec <= 60;

  let netMbps: string = "—";
  let netRxMbps: string = "—";
  let netTxMbps: string = "—";
  if (latest && previous) {
    const dt =
      (new Date(latest.captured_at).getTime() - new Date(previous.captured_at).getTime()) / 1000;
    const drx = Number(latest.net_rx_bytes) - Number(previous.net_rx_bytes);
    const dtx = Number(latest.net_tx_bytes) - Number(previous.net_tx_bytes);
    if (dt > 0 && drx >= 0 && dtx >= 0) {
      netMbps = (((drx + dtx) * 8) / dt / 1e6).toFixed(2) + " Mbps";
      netRxMbps = ((drx * 8) / dt / 1e6).toFixed(2) + " Mbps";
      netTxMbps = ((dtx * 8) / dt / 1e6).toFixed(2) + " Mbps";
    }
  }

  const ncpuN = latest ? Number(latest.ncpu) : NaN;
  const load1N = latest ? Number(latest.load1) : NaN;
  const stealN = latest ? Number(latest.cpu_steal_pct) : NaN;
  const memTotalGb = latest && latest.mem_total_mb != null
    ? Number(latest.mem_total_mb) / 1024
    : NaN;
  const memAvailGb = latest && latest.mem_available_mb != null
    ? Number(latest.mem_available_mb) / 1024
    : NaN;
  const memUsedGb = isFinite(memTotalGb) && isFinite(memAvailGb) ? memTotalGb - memAvailGb : NaN;
  const memPctN = latest ? Number(latest.mem_pct) : NaN;
  const diskPctN = latest ? Number(latest.disk_pct) : NaN;

  const [range, setRange] = useState<Range>("24h");
  const series = useQuery({
    queryKey: ["vps-series", range],
    enabled: isSuper,
    refetchInterval: 60000,
    queryFn: async () => {
      const { p_since, p_bucket } = rangeParams(range);
      const { data, error } = await (supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>)("vps_metrics_series", {
        p_since,
        p_bucket,
      });
      if (error) throw error as Error;
      const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
      const points: VpsSeriesPoint[] = rows.map((r) => ({
        bucket: String(r.bucket),
        amostras: Number(r.amostras),
        cpu_avg: Number(r.cpu_avg),
        cpu_max: Number(r.cpu_max),
        load1_avg: Number(r.load1_avg),
        load1_max: Number(r.load1_max),
        steal_avg: Number(r.steal_avg),
        steal_max: Number(r.steal_max),
        mem_pct_max: Number(r.mem_pct_max),
        mem_avail_min_mb: Number(r.mem_avail_min_mb),
        disk_pct_max: Number(r.disk_pct_max),
        net_avg_mbps: Number(r.net_avg_mbps),
      }));
      points.sort((a, b) => a.bucket.localeCompare(b.bucket));
      return points;
    },
  });

  const fmtTick = (iso: string) => {
    const d = new Date(iso);
    if (range === "24h")
      return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  };

  function ContainerStatus({ label, up }: { label: string; up: boolean | null | undefined }) {
    const isUp = up === true;
    const isDown = up === false;
    return (
      <div
        className={`
          flex-1 rounded-xl border px-4 py-5 text-center
          ${isUp ? "border-emerald-500/40 bg-emerald-500/10" : ""}
          ${isDown ? "border-red-500/40 bg-red-500/10" : ""}
          ${!isUp && !isDown ? "border-muted bg-muted/40" : ""}
        `}
      >
        <div
          className={`
            text-2xl font-semibold tracking-tight tabular-nums
            ${isUp ? "text-emerald-500" : ""}
            ${isDown ? "text-red-500" : ""}
            ${!isUp && !isDown ? "text-muted-foreground" : ""}
          `}
        >
          {label} · {isUp ? "UP" : isDown ? "DOWN" : "—"}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Activity className="h-6 w-6 text-primary" />
          Monitoramento
        </h1>
        <p className="text-sm text-muted-foreground">
          Sessões, agentes {isSuper ? "e saúde do relay compartilhado." : "e acessos externos."}
        </p>
      </div>


      {availableGroups.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {availableGroups.map((g) => {
            const on = show(g.id);
            return (
              <Button
                key={g.id}
                size="sm"
                variant={on ? "secondary" : "outline"}
                className={on ? undefined : "opacity-60"}
                onClick={() => toggleHidden(g.id)}
              >
                {g.label}
              </Button>
            );
          })}
        </div>
      )}

      {canSecao && (
        <div className="space-y-6">
          {show("agentes") && (
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-base">Saúde dos agentes</CardTitle>
              <CardDescription>
                Últimos heartbeats e contadores por dispositivo.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {agentHealth.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : !agentHealth.data || agentHealth.data.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Nenhum agente registrado.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dispositivo</TableHead>
                      {isSuper && <TableHead>Empresa</TableHead>}
                      <TableHead className="text-right">Sessões reais</TableHead>
                      <TableHead className="text-right">Falhas</TableHead>
                      <TableHead>Agente</TableHead>
                      <TableHead>Últ. heartbeat</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agentHealth.data.map((r, i) => {
                      const vivo = !!r.agente_vivo_24h;
                      return (
                        <TableRow
                          key={`${r.address_book_id ?? r.rustdesk_id ?? i}`}
                          className={vivo ? undefined : "bg-amber-500/5"}
                        >
                          <TableCell className="font-medium">
                            {nomeDispositivo(r.address_book_id, r.rustdesk_id)}
                          </TableCell>
                          {isSuper && (
                            <TableCell className="text-muted-foreground">
                              {empresaDe(r.tenant_id, r.address_book_id)}
                            </TableCell>
                          )}
                          <TableCell className="text-right tabular-nums">
                            {r.sessoes_reais ?? 0}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {r.falhas ?? 0}
                          </TableCell>
                          <TableCell>
                            {vivo ? (
                              <Badge
                                variant="outline"
                                className="text-emerald-500 border-emerald-500/30"
                              >
                                vivo
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="text-amber-500 border-amber-500/40"
                              >
                                sem sinal
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground tabular-nums">
                            {r.ultimo_heartbeat
                              ? new Date(r.ultimo_heartbeat).toLocaleString("pt-BR")
                              : "nunca"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          )}

          {show("sessoes") && (
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-base">Resumo de sessões (por dia)</CardTitle>
              <CardDescription>Últimos 14 dias.</CardDescription>
            </CardHeader>
            <CardContent>
              {sessionsSummary.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : !sessionsSummary.data || sessionsSummary.data.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Sem sessões nos últimos dias.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dia</TableHead>
                      <TableHead className="text-right">Sessões</TableHead>
                      <TableHead className="text-right">Quedas</TableHead>
                      <TableHead className="text-right">Acessos externos</TableHead>
                      <TableHead className="text-right">Dur. média</TableHead>
                      <TableHead className="text-right">p95</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessionsSummary.data.map((r) => (
                      <TableRow key={`${r.tenant_id}-${r.dia}`}>
                        <TableCell className="tabular-nums">
                          {new Date(r.dia).toLocaleDateString("pt-BR")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.sessoes ?? 0}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.quedas ?? 0}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.acessos_externos ?? 0}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtDur(r.dur_media_s)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtDur(r.dur_p95_s)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          )}

          {show("externos") && (
          <Card className="border-amber-500/40 bg-amber-500/[0.02]">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-amber-500" />
                Acessos externos
              </CardTitle>
              <CardDescription>Conexões não iniciadas pelo painel.</CardDescription>
            </CardHeader>
            <CardContent>
              {externalAccess.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : !externalAccess.data || externalAccess.data.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Nenhum acesso externo registrado.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dispositivo</TableHead>
                      {isSuper && <TableHead>Empresa</TableHead>}
                      <TableHead>Início</TableHead>
                      <TableHead className="text-right">Duração</TableHead>
                      <TableHead>IP</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {externalAccess.data.map((r, i) => (
                      <TableRow key={`${r.address_book_id ?? r.rustdesk_id ?? i}-${r.session_start ?? i}`}>
                        <TableCell className="font-medium">
                          {nomeDispositivo(r.address_book_id, r.rustdesk_id)}
                        </TableCell>
                        {isSuper && (
                          <TableCell className="text-muted-foreground">
                            {empresaDe(r.tenant_id, r.address_book_id)}
                          </TableCell>
                        )}
                        <TableCell className="text-muted-foreground tabular-nums">
                          {r.session_start
                            ? new Date(r.session_start).toLocaleString("pt-BR")
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtDur(r.duration_seconds)}
                        </TableCell>
                        <TableCell className="text-muted-foreground tabular-nums">
                          {r.technician_ip ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          )}
        </div>
      )}

      {isSuper && (
        <>
          <div className="pt-2">
            <h2 className="text-lg font-semibold tracking-tight">Saúde da VPS</h2>
            <p className="text-sm text-muted-foreground">Relay compartilhado.</p>
          </div>

          <Card className="border-border/60">
            <CardContent className="py-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{latest?.host ?? "—"}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span className="tabular-nums">uptime {fmtUptime(latest?.uptime_seconds)}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Cpu className="h-4 w-4" />
                <span className="tabular-nums">
                  {isFinite(ncpuN) ? `${ncpuN} vCPU` : "— vCPU"}
                </span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Radio className="h-4 w-4" />
                <span className="tabular-nums">
                  {Number(latest?.active_sessions ?? 0)} sessões ativas
                </span>
              </div>
              <div className="ml-auto">
                {isLoading ? (
                  <Skeleton className="h-5 w-48" />
                ) : isActive ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span
                      className="inline-block h-2 w-2 rounded-full bg-emerald-500"
                      aria-hidden
                    />
                    <span>Coletor ativo · há {ageSec}s</span>
                  </div>
                ) : (
                  <Badge variant="outline" className="text-amber-500 border-amber-500/40">
                    coletor parado
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {!isActive && !isLoading && (
            <Alert>
              <AlertTitle>Sem amostras recentes</AlertTitle>
              <AlertDescription>
                {latest
                  ? `A última amostra foi há ${ageSec}s. Verifique o agente na VPS.`
                  : "Nenhuma amostra encontrada em vps_metrics."}
              </AlertDescription>
            </Alert>
          )}

          {show("vps_containers") && (
            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Boxes className="h-4 w-4 text-primary" />
                  Containers (relay)
                </CardTitle>
                <CardDescription>hbbs (sinalização) · hbbr (relay)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col sm:flex-row gap-4">
                  <ContainerStatus label="hbbs" up={latest?.hbbs_up} />
                  <ContainerStatus label="hbbr" up={latest?.hbbr_up} />
                </div>
              </CardContent>
            </Card>
          )}

          {show("vps_cpu") && (
            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-sky-500" /> CPU & Load
                </CardTitle>
                <CardDescription>Uso de CPU, I/O wait, steal e load average.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                <VpsStat label="CPU" value={latest ? num(latest.cpu_pct, 1) + "%" : "—"} />
                <VpsStat
                  label="I/O wait"
                  value={latest ? num(latest.cpu_iowait_pct, 1) + "%" : "—"}
                />
                <VpsStat
                  label="Steal"
                  value={latest ? num(latest.cpu_steal_pct, 1) + "%" : "—"}
                  warn={isFinite(stealN) && stealN > 5}
                />
                <VpsStat
                  label="Load 1 / 5 / 15"
                  value={
                    latest
                      ? `${num(latest.load1, 2)} / ${num(latest.load5, 2)} / ${num(latest.load15, 2)}`
                      : "—"
                  }
                  sub={isFinite(ncpuN) ? `de ${ncpuN} vCPU` : undefined}
                  warn={isFinite(load1N) && isFinite(ncpuN) && load1N > ncpuN}
                />
              </CardContent>
            </Card>
          )}

          {show("vps_mem") && (
            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <MemoryStick className="h-4 w-4 text-violet-500" /> Memória
                </CardTitle>
                <CardDescription>RAM em uso e swap.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-muted-foreground">RAM</span>
                    <span className="text-sm tabular-nums font-medium">
                      {isFinite(memUsedGb) && isFinite(memTotalGb)
                        ? `${memUsedGb.toFixed(2)} / ${memTotalGb.toFixed(2)} GB`
                        : "—"}{" "}
                      · {latest ? num(latest.mem_pct, 1) + "%" : "—"}
                    </span>
                  </div>
                  <Progress value={isFinite(memPctN) ? memPctN : 0} />
                </div>
                <div className="grid gap-4 grid-cols-2">
                  <VpsStat
                    label="Disponível"
                    value={isFinite(memAvailGb) ? `${memAvailGb.toFixed(2)} GB` : "—"}
                  />
                  <VpsStat
                    label="Swap em uso"
                    value={latest?.swap_used_mb != null ? `${num(latest.swap_used_mb, 0)} MB` : "—"}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {show("vps_disco") && (
            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <HardDrive className="h-4 w-4 text-amber-500" /> Disco
                </CardTitle>
                <CardDescription>Uso do volume principal.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-muted-foreground">Volume</span>
                  <span className="text-sm tabular-nums font-medium">
                    {latest?.disk_used_gb != null && latest?.disk_total_gb != null
                      ? `${num(latest.disk_used_gb, 1)} / ${num(latest.disk_total_gb, 1)} GB`
                      : "—"}{" "}
                    · {latest ? num(latest.disk_pct, 0) + "%" : "—"}
                  </span>
                </div>
                <Progress value={isFinite(diskPctN) ? diskPctN : 0} />
              </CardContent>
            </Card>
          )}

          {show("vps_rede") && (
            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Network className="h-4 w-4 text-emerald-500" /> Rede (eth0 = relay)
                </CardTitle>
                <CardDescription>Taxa derivada das duas últimas amostras.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 grid-cols-3">
                <VpsStat label="Total" value={netMbps} icon={Zap} />
                <VpsStat label="RX" value={netRxMbps} />
                <VpsStat label="TX" value={netTxMbps} />
              </CardContent>
            </Card>
          )}

          {show("vps_trend") && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold tracking-tight flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    Tendência de capacidade
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Séries agregadas do relay compartilhado.
                  </p>
                </div>
                <div className="flex gap-1">
                  {(["24h", "7d", "30d"] as Range[]).map((r) => (
                    <Button
                      key={r}
                      size="sm"
                      variant={range === r ? "secondary" : "outline"}
                      onClick={() => setRange(r)}
                    >
                      {r}
                    </Button>
                  ))}
                </div>
              </div>

              {series.isLoading ? (
              <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
                  <Skeleton className="h-[240px] w-full" />
                  <Skeleton className="h-[240px] w-full" />
                  <Skeleton className="h-[240px] w-full" />
                  <Skeleton className="h-[240px] w-full" />
                  <Skeleton className="h-[240px] w-full" />
                </div>
              ) : !series.data || series.data.length === 0 ? (
                <Card className="border-border/60">
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    Sem dados no período.
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
                  <TrendCard
                    title="CPU & Steal (%)"
                    icon={<Cpu className="h-4 w-4 text-sky-500" />}
                  >
                    <LineChart data={series.data}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                      <XAxis
                        dataKey="bucket"
                        tickFormatter={fmtTick}
                        minTickGap={40}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis domain={[0, "auto"]} tick={{ fontSize: 11 }} />
                      <Tooltip
                        labelFormatter={(v) => new Date(String(v)).toLocaleString("pt-BR")}
                      />
                      <Line
                        type="monotone"
                        dataKey="cpu_avg"
                        name="CPU méd"
                        stroke="hsl(200 90% 55%)"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="cpu_max"
                        name="CPU máx"
                        stroke="hsl(200 90% 70%)"
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="steal_avg"
                        name="Steal"
                        stroke="hsl(38 92% 55%)"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </TrendCard>

                  <TrendCard
                    title="Load average"
                    icon={<Gauge className="h-4 w-4 text-violet-500" />}
                  >
                    <LineChart data={series.data}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                      <XAxis
                        dataKey="bucket"
                        tickFormatter={fmtTick}
                        minTickGap={40}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis domain={[0, "auto"]} tick={{ fontSize: 11 }} />
                      <Tooltip
                        labelFormatter={(v) => new Date(String(v)).toLocaleString("pt-BR")}
                      />
                      <Line
                        type="monotone"
                        dataKey="load1_avg"
                        name="méd"
                        stroke="hsl(262 83% 65%)"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="load1_max"
                        name="máx"
                        stroke="hsl(262 83% 78%)"
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        dot={false}
                      />
                      {isFinite(ncpuN) && ncpuN > 0 && (
                        <ReferenceLine
                          y={ncpuN}
                          stroke="hsl(38 92% 55%)"
                          strokeDasharray="4 4"
                          label={{ value: "saturação", fontSize: 10, fill: "hsl(38 92% 55%)" }}
                        />
                      )}
                    </LineChart>
                  </TrendCard>

                  <TrendCard
                    title="Memória (%)"
                    icon={<MemoryStick className="h-4 w-4 text-violet-500" />}
                  >
                    <LineChart data={series.data}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                      <XAxis
                        dataKey="bucket"
                        tickFormatter={fmtTick}
                        minTickGap={40}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                      <Tooltip
                        labelFormatter={(v) => new Date(String(v)).toLocaleString("pt-BR")}
                      />
                      <Line
                        type="monotone"
                        dataKey="mem_pct_max"
                        name="RAM %"
                        stroke="hsl(262 83% 65%)"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </TrendCard>

                  <TrendCard
                    title="Rede/Relay (Mbps)"
                    icon={<Network className="h-4 w-4 text-emerald-500" />}
                  >
                    <LineChart data={series.data}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                      <XAxis
                        dataKey="bucket"
                        tickFormatter={fmtTick}
                        minTickGap={40}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis domain={[0, "auto"]} tick={{ fontSize: 11 }} />
                      <Tooltip
                        labelFormatter={(v) => new Date(String(v)).toLocaleString("pt-BR")}
                      />
                      <Line
                        type="monotone"
                        dataKey="net_avg_mbps"
                        name="Mbps"
                        stroke="hsl(160 84% 45%)"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </TrendCard>

                  <TrendCard
                    title="Disco (%)"
                    icon={<HardDrive className="h-4 w-4 text-amber-500" />}
                  >
                    <LineChart data={series.data}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                      <XAxis
                        dataKey="bucket"
                        tickFormatter={fmtTick}
                        minTickGap={40}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                      <Tooltip
                        labelFormatter={(v) => new Date(String(v)).toLocaleString("pt-BR")}
                      />
                      <Line
                        type="monotone"
                        dataKey="disk_pct_max"
                        name="Disco %"
                        stroke="hsl(38 92% 55%)"
                        strokeWidth={2}
                        dot={false}
                      />
                      <ReferenceLine
                        y={85}
                        strokeDasharray="4 4"
                        stroke="hsl(0 84% 60%)"
                        label={{ value: "atenção", fontSize: 10, fill: "hsl(0 84% 60%)" }}
                      />
                    </LineChart>
                  </TrendCard>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TrendCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactElement;
}) {
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[200px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function VpsStat({
  label,
  value,
  sub,
  warn,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div
      className={
        "rounded-md border p-3 " +
        (warn ? "border-amber-500/40 bg-amber-500/[0.04]" : "border-border/60")
      }
    >
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
        {Icon ? <Icon className="h-3 w-3" /> : null}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub ? <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div> : null}
    </div>
  );
}