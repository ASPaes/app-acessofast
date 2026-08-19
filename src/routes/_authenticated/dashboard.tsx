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
import { StatCard } from "@/components/stat-card";
import { PainelOperacao } from "@/components/painel-operacao";
import { FaixaAgora, type ItemAgora } from "@/components/faixa-agora";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { KpiInfo } from "@/components/kpi-info";
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
  Coins,
  Gift,
  Wifi,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [{ title: "Dashboard — Acessofast" }, { name: "robots", content: "noindex" }],
  }),
  component: Dashboard,
});

// Dia corrente em America/Sao_Paulo (GMT-3) — mesma referencia do reset do free.
function todaySP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

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

// ---------------------------------------------------------------------------
// O que cada número quer dizer.
//
// Fica AQUI, e não num catálogo central de textos, porque "Como calculamos" tem
// que envelhecer junto com a consulta que o produz. Num arquivo distante a
// consulta muda e o texto fica — e definição errada é pior que nenhuma, porque
// tem a aparência de verificada.
// ---------------------------------------------------------------------------
const INFO: Record<string, KpiInfo> = {
  usuarios: {
    oQue: "Contas de pessoas habilitadas a entrar no painel.",
    porQue:
      "É o número que casa com assento contratado. Se ele cresce sem o plano crescer, alguém esbarra no limite ao convidar o próximo técnico.",
    comoCalculamos: "profiles onde is_active = true",
  },
  online: {
    oQue: "Computadores com o agente reportando presença agora.",
    porQue:
      "É quem está alcançável neste instante. Parque grande com poucos online significa que o suporte não vai conseguir agir quando precisar — e é isso, não o total cadastrado, que limita o atendimento de hoje.",
    comoCalculamos: "dispositivos ativos com última presença nos últimos 5 minutos",
    referencia:
      "A janela é de 5 min porque o agente reporta presença a cada 60s; mais curta, um beat perdido viraria máquina offline.",
  },
  dispositivos: {
    oQue: "Máquinas cadastradas no address book, ligadas ou não.",
    porQue:
      "É o tamanho do parque sob gestão. Não confundir com máquinas online: endpoint desligado continua contado aqui, porque continua sendo responsabilidade.",
    comoCalculamos: "address_book (todas as linhas)",
  },
  ativas: {
    oQue: "Atendimentos remotos acontecendo neste instante.",
    porQue:
      "É o que ocupa vaga de simultaneidade do plano. Quando bate no limite, o próximo Conectar é recusado — e é aqui que dá para ver isso chegando.",
    comoCalculamos: "connection_logs com status = active E último heartbeat nos últimos 90s",
    referencia:
      "O corte de 90s existe porque sessão sem heartbeat é sessão fantasma: o agente caiu sem avisar que fechou.",
  },
  sessoes24h: {
    oQue: "Atendimentos iniciados nas últimas 24 horas.",
    porQue:
      "É o volume de trabalho do dia. Serve para comparar com ontem e para explicar consumo de crédito ou de acesso gratuito.",
    comoCalculamos: "connection_logs com session_start nas últimas 24h",
    referencia: "Janela deslizante de 24h, não “hoje”: não zera à meia-noite.",
  },
  creditos: {
    oQue: "Saldo de créditos de atendimento da conta.",
    porQue:
      "Cada atendimento fora do acesso gratuito consome 1. Zerado com o gratuito esgotado, o técnico é bloqueado no Conectar.",
    comoCalculamos: "soma de credit_ledger.credits da conta (compras positivas, consumos negativos)",
  },
  gratis: {
    oQue: "Acessos gratuitos que ainda restam hoje, sobre o total do dia.",
    porQue:
      "É a franquia diária do plano grátis. Esgotada, só se conecta gastando crédito — e o atendimento gratuito ainda cai em 2 horas.",
    comoCalculamos: "cap − used de daily_access no dia de hoje",
    referencia: "Renova à meia-noite no horário de Brasília, não em UTC.",
  },
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
      const [devices, users, activeLogs, logsToday, online] = await Promise.all([
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
        // Maquinas alcancaveis AGORA. Mesmo corte de 5 min que o resto do
        // painel usa para "presente": o agente reporta presenca a cada 60s, e
        // uma janela mais curta transformaria um beat perdido em maquina
        // offline.
        withTenant(
          supabase
            .from("address_book")
            .select("id", { count: "exact", head: true })
            .eq("is_active", true)
            .gt("last_online", new Date(Date.now() - 5 * 60 * 1000).toISOString()),
        ),
      ]);
      return {
        devices: devices.count ?? 0,
        users: users.count ?? 0,
        activeSessions: activeLogs.count ?? 0,
        sessions24h: logsToday.count ?? 0,
        devicesOnline: online.count ?? 0,
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

  // Billing: carteira do tenant (creditos + gratis hoje) + modo, p/ os cards.
  const carteira = useQuery({
    queryKey: ["dashboard-carteira", me?.tenant_id],
    enabled: !!me && me.role !== "super_admin" && !!me.tenant_id,
    refetchInterval: 20000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const tid = me!.tenant_id as string;
      const today = todaySP();
      const [tenantRes, creditsRes, dailyRes] = await Promise.all([
        supabase.from("tenants").select("billing_mode").eq("id", tid).single(),
        supabase.from("credit_ledger").select("credits").eq("tenant_id", tid),
        supabase
          .from("daily_access")
          .select("used, cap")
          .eq("tenant_id", tid)
          .eq("access_date", today)
          .maybeSingle(),
      ]);
      if (tenantRes.error) throw tenantRes.error;
      if (creditsRes.error) throw creditsRes.error;
      if (dailyRes.error) throw dailyRes.error;
      const credits = (creditsRes.data ?? []).reduce((sum, r) => sum + (r.credits ?? 0), 0);
      const cap = dailyRes.data?.cap ?? 5;
      const used = dailyRes.data?.used ?? 0;
      return {
        billingMode: tenantRes.data.billing_mode as "free" | "credits" | "plan",
        credits,
        freeRemaining: Math.max(0, cap - used),
        freeCap: cap,
      };
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
  const [recvAt, setRecvAt] = useState<number | null>(null);
  useEffect(() => {
    if (latest?.captured_at) setRecvAt(Date.now());
  }, [latest?.captured_at]);
  const idadeSeg = recvAt != null ? Math.max(0, Math.floor((now - recvAt) / 1000)) : null;
  const idadeReal = capturedAt != null ? Math.max(0, Math.floor((now - capturedAt) / 1000)) : null;
  const ativo = idadeReal != null && idadeReal <= 60;

  const role = me?.role;
  const isSuper = role === "super_admin";
  const isTech = role === "tech";
  // Cards de billing só p/ tenant metrado (free/credits), nunca super/plano.
  const cart = carteira.data;
  const metered = !isSuper && (cart?.billingMode === "free" || cart?.billingMode === "credits");

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

  // Sem numero aqui: a faixa logo abaixo ja mostra sessoes ativas e PCs online,
  // e repetir os mesmos valores dois centimetros acima foi parte do que fazia a
  // tela parecer amontoada. O subtitulo diz o ESCOPO, que a faixa nao diz.
  const subtitulo = isSuper
    ? "Plataforma inteira. Escolha uma empresa na aba Operação para olhar uma só."
    : isTech
      ? "Seu atendimento e o parque que você acessa."
      : "O atendimento da sua empresa e o parque cadastrado.";

  // A faixa do instante. Nao entra nas abas de proposito: e o unico bloco que
  // NAO responde a filtro nenhum, e essa e a informacao que a posicao dele
  // comunica. Ver o comentario de faixa-agora.tsx.
  const agora: ItemAgora[] = [
    {
      titulo: "Sessões ativas",
      valor: stats.data?.activeSessions,
      hint: hintAtivas,
      icon: Radio,
      color: "amber",
      info: INFO.ativas,
    },
    {
      titulo: "PCs online",
      valor: stats.data?.devicesOnline,
      hint: "alcançáveis neste instante",
      icon: Wifi,
      color: "emerald",
      info: INFO.online,
    },
    {
      titulo: "Acessos 24h",
      valor: stats.data?.sessions24h,
      hint: hint24h,
      icon: Activity,
      color: "violet",
      info: INFO.sessoes24h,
    },
    ...(metered
      ? [
          {
            titulo: "Créditos",
            valor: cart?.credits,
            hint: "saldo para atendimentos",
            icon: Coins,
            color: "lime",
            info: INFO.creditos,
          } as ItemAgora,
        ]
      : []),
    ...(metered && cart?.billingMode === "free"
      ? [
          {
            titulo: "Grátis hoje",
            valor: `${cart.freeRemaining}/${cart.freeCap}`,
            hint: "renova à meia-noite",
            icon: Gift,
            color: "cyan",
            info: INFO.gratis,
          } as ItemAgora,
        ]
      : []),
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">{subtitulo}</p>
      </div>

      <FaixaAgora itens={agora} loading={stats.isLoading} />

      {/* Abas por PERGUNTA, nao por origem do dado: "como foi o atendimento",
          "o que existe cadastrado", "a infraestrutura esta de pe". Antes tudo
          isso era uma coluna unica de 14 cartoes, e a leitura se perdia bem no
          meio — inclusive misturando numero de instante com numero de periodo
          filtrado, que agora estao fisicamente separados. */}
      <Tabs defaultValue="operacao" className="space-y-4">
        <TabsList>
          <TabsTrigger value="operacao">Operação</TabsTrigger>
          <TabsTrigger value="cadastro">Cadastro</TabsTrigger>
          {isSuper && <TabsTrigger value="plataforma">Plataforma</TabsTrigger>}
        </TabsList>

        <TabsContent value="operacao" className="space-y-4">
          <PainelOperacao isSuper={isSuper} />
        </TabsContent>

        <TabsContent value="cadastro" className="space-y-4">
          <div className={`grid gap-4 grid-cols-2 ${isTech ? "lg:grid-cols-2" : "lg:grid-cols-3"}`}>
            {!isTech && (
              <StatCard
                title="Usuários ativos"
                info={INFO.usuarios}
                value={stats.data?.users}
                icon={Users}
                hint={hintUsuarios}
                loading={stats.isLoading}
                color="blue"
              />
            )}
            <StatCard
              title="Dispositivos"
              info={INFO.dispositivos}
              value={stats.data?.devices}
              icon={MonitorSmartphone}
              hint={hintDispositivos}
              loading={stats.isLoading}
              color="emerald"
            />
            <StatCard
              title="Online agora"
              info={INFO.online}
              value={stats.data?.devicesOnline}
              icon={Wifi}
              hint="do parque acima, alcançáveis neste instante"
              loading={stats.isLoading}
              color="cyan"
            />
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Dispositivos recentes</CardTitle>
                <CardDescription>
                  {isSuper
                    ? "Últimos endpoints cadastrados na plataforma"
                    : "Últimos endpoints cadastrados na sua empresa"}
                </CardDescription>
              </div>
              <Link to="/dispositivos" className="text-xs font-medium text-primary hover:underline">
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
                        <TableCell className="font-medium">
                          {d.alias ?? d.rustdesk_id ?? "—"}
                        </TableCell>
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
                          {d.last_online
                            ? new Date(d.last_online).toLocaleString("pt-BR")
                            : "nunca"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {isSuper && (
          <TabsContent value="plataforma" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base">Monitoramento do relay</CardTitle>
                      <CardDescription>Saúde da VPS compartilhada</CardDescription>
                    </div>
                    {ativo ? (
                      <Badge variant="outline" className="gap-1.5 text-success border-success/30">
                        <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
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
                        color="cyan"
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
                      <MetricPlaceholder
                        label="Rede"
                        icon={Network}
                        value={netMbps}
                        color="emerald"
                      />
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Status do sistema</CardTitle>
                  <CardDescription>Componentes essenciais</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <StatusRow label="API do painel" ok={!stats.isError} />
                  <StatusRow label="Banco (RLS)" ok={!stats.isError} />
                  <StatusRow
                    label="Coletor VPS"
                    ok={ativo}
                    note={ativo ? undefined : "sem amostras"}
                  />
                  <StatusRow
                    label="Realtime"
                    ok={realtimeOk}
                    note={realtimeOk ? undefined : "conectando"}
                  />
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

/** Mesma paleta categórica dos cartões — uma métrica tem UMA cor no painel
    inteiro. Métrica com duas cores obriga a ler o rótulo, que é justamente o
    que a cor deveria evitar. */
const METRIC_COLORS = {
  cyan: "text-viz-cyan",
  violet: "text-viz-violet",
  amber: "text-viz-amber",
  emerald: "text-viz-emerald",
} as const;

function MetricPlaceholder({
  label,
  icon: Icon,
  value,
  color = "cyan",
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