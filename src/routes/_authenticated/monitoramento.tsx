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
  Clock,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  Network,
  Server,
  ShieldAlert,
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
  { id: "vps_cpu", label: "CPU & Load", scope: "vps" as const },
  { id: "vps_mem", label: "Memória", scope: "vps" as const },
  { id: "vps_disco", label: "Disco", scope: "vps" as const },
  { id: "vps_rede", label: "Rede/Relay", scope: "vps" as const },
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
          "captured_at,cpu_pct,mem_pct,disk_pct,net_rx_bytes,net_tx_bytes,host,ncpu,cpu_iowait_pct,cpu_steal_pct,load1,load5,load15,mem_total_mb,mem_available_mb,swap_used_mb,disk_used_gb,disk_total_gb,uptime_seconds",
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
        </>
      )}
    </div>
  );
}