import * as React from "react";
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
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cx } from "@preview/lib/cx";
import { Badge, StatusBadge } from "@preview/components/ui/badge";
import { Panel, PanelHeader, PanelBody } from "@preview/components/ui/panel";
import { PageHeader, Section, Segmented, StatCell, StatStrip } from "@preview/components/ui/page";
import { Table, TBody, TD, TH, THead, TR, TableWrap, Truncate } from "@preview/components/ui/table";
import { vizFg } from "@preview/components/ui/viz";
import {
  Alert,
  EmptyState,
  ErrorState,
  Progress,
  SkeletonRows,
} from "@preview/components/ui/states";
import { dataCurta, dataHora, tempoRelativo, uptime } from "@preview/lib/format";
import { usePreview } from "@preview/data/preview-state";
import { ACESSOS_EXTERNOS, RESUMO_SESSOES, SAUDE_AGENTES, SERIES, VPS } from "@preview/data/mock";

type Periodo = "24h" | "7d" | "30d";

export function MonitoramentoScreen() {
  const { isSuper, isTech, dados } = usePreview();
  const [periodo, setPeriodo] = React.useState<Periodo>("24h");

  const carregando = dados === "carregando";
  const erro = dados === "erro";
  const vazio = dados === "vazio";

  const agentes = vazio || erro || carregando ? [] : SAUDE_AGENTES;
  const resumo = vazio || erro || carregando ? [] : RESUMO_SESSOES;
  const externos = vazio || erro || carregando ? [] : ACESSOS_EXTERNOS;
  const serie = vazio || erro || carregando ? [] : SERIES[periodo];

  const coletorAtivo = VPS.capturado_ha_s <= 60;

  if (isTech) {
    return (
      <div className="space-y-5">
        <PageHeader title="Monitoramento" description="Sessões, agentes e acessos externos." />
        <Panel>
          <PanelBody>
            <EmptyState
              icon={<Activity aria-hidden />}
              title="Visão restrita ao seu papel"
              description="O monitoramento de agentes e sessões é liberado para administradores e supervisores da conta."
            />
          </PanelBody>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Monitoramento"
        description={
          isSuper
            ? "Sessões, agentes e saúde do relay compartilhado."
            : "Sessões, agentes e acessos externos."
        }
        actions={
          isSuper ? (
            coletorAtivo ? (
              <StatusBadge tone="success" pulse>
                coletor ativo · há {VPS.capturado_ha_s}s
              </StatusBadge>
            ) : (
              <StatusBadge tone="warning">coletor parado</StatusBadge>
            )
          ) : null
        }
      />

      {isSuper && !coletorAtivo && (
        <Alert tone="warning" title="Sem amostras recentes">
          A última amostra chegou há {VPS.capturado_ha_s}s. Verifique o agente coletor na VPS.
        </Alert>
      )}

      {/* ------------------------------ Operação ------------------------------ */}

      <Section
        title="Saúde dos agentes"
        description="Últimos heartbeats e contadores por dispositivo."
      >
        <Panel flush>
          {erro ? (
            <ErrorState compact onRetry={() => undefined} />
          ) : (
            <TableWrap className="rounded-none border-0" minWidth={820}>
              <Table>
                <THead>
                  <TR>
                    <TH>Dispositivo</TH>
                    {isSuper && <TH>Empresa</TH>}
                    <TH align="right">Sessões reais</TH>
                    <TH align="right">Falhas</TH>
                    <TH>Agente</TH>
                    <TH align="right">Últ. heartbeat</TH>
                  </TR>
                </THead>
                <TBody>
                  {carregando && <SkeletonRows rows={5} cols={isSuper ? 6 : 5} />}
                  {!carregando && agentes.length === 0 && (
                    <tr>
                      <td colSpan={isSuper ? 6 : 5} className="border-b-0">
                        <EmptyState
                          compact
                          icon={<Activity aria-hidden />}
                          title="Nenhum agente registrado"
                          description="Assim que um endpoint enviar o primeiro heartbeat, ele aparece aqui."
                        />
                      </td>
                    </tr>
                  )}
                  {!carregando &&
                    agentes.map((a) => (
                      <TR key={a.dispositivo}>
                        <TD>
                          <Truncate className="text-[13px] font-medium text-ink">
                            {a.dispositivo}
                          </Truncate>
                        </TD>
                        {isSuper && (
                          <TD>
                            <Truncate className="text-[12.5px] text-muted">{a.empresa}</Truncate>
                          </TD>
                        )}
                        <TD align="right" className="af-num text-[13px]">
                          {a.sessoes_reais}
                        </TD>
                        <TD align="right" className="af-num text-[13px]">
                          {a.falhas > 0 ? (
                            <span className="text-warning">{a.falhas}</span>
                          ) : (
                            <span className="text-muted">0</span>
                          )}
                        </TD>
                        <TD>
                          <StatusBadge tone={a.vivo ? "success" : "warning"} pulse={a.vivo}>
                            {a.vivo ? "vivo" : "sem sinal"}
                          </StatusBadge>
                        </TD>
                        <TD align="right" className="af-num text-[12.5px] text-muted">
                          {tempoRelativo(a.ultimo_heartbeat)}
                        </TD>
                      </TR>
                    ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Panel>
      </Section>

      <Section title="Resumo de sessões" description="Últimos 14 dias.">
        <Panel flush>
          {erro ? (
            <ErrorState compact onRetry={() => undefined} />
          ) : (
            <TableWrap className="rounded-none border-0" minWidth={760}>
              <Table>
                <THead>
                  <TR>
                    <TH>Dia</TH>
                    <TH align="right">Sessões</TH>
                    <TH align="right">Quedas</TH>
                    <TH align="right">Acessos externos</TH>
                    <TH align="right">Dur. média</TH>
                    <TH align="right">p95</TH>
                  </TR>
                </THead>
                <TBody>
                  {carregando && <SkeletonRows rows={6} cols={6} />}
                  {!carregando && resumo.length === 0 && (
                    <tr>
                      <td colSpan={6} className="border-b-0">
                        <EmptyState
                          compact
                          icon={<Activity aria-hidden />}
                          title="Sem sessões nos últimos dias"
                          description="O resumo diário aparece assim que houver atendimento registrado."
                        />
                      </td>
                    </tr>
                  )}
                  {!carregando &&
                    resumo.map((r) => (
                      <TR key={r.dia}>
                        <TD className="af-num text-[12.5px]">{dataCurta(r.dia)}</TD>
                        <TD align="right" className="af-num text-[13px] text-ink">
                          {r.sessoes}
                        </TD>
                        <TD align="right" className="af-num text-[13px]">
                          {r.quedas > 0 ? (
                            <span className="text-warning">{r.quedas}</span>
                          ) : (
                            <span className="text-muted">0</span>
                          )}
                        </TD>
                        <TD align="right" className="af-num text-[13px]">
                          {r.externos > 0 ? (
                            <span className="text-danger">{r.externos}</span>
                          ) : (
                            <span className="text-muted">0</span>
                          )}
                        </TD>
                        <TD align="right" className="af-num text-[12.5px] text-muted">
                          {fmtMin(r.dur_media_s)}
                        </TD>
                        <TD align="right" className="af-num text-[12.5px] text-muted">
                          {fmtMin(r.dur_p95_s)}
                        </TD>
                      </TR>
                    ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Panel>
      </Section>

      <Section
        title="Acessos externos"
        description="Conexões não iniciadas pelo painel."
        actions={
          externos.length > 0 ? <Badge tone="warning">{externos.length} registrados</Badge> : null
        }
      >
        <Panel
          flush
          className={
            externos.length > 0
              ? "border-[color-mix(in_oklab,var(--af-warning)_26%,transparent)]"
              : undefined
          }
        >
          {externos.length > 0 && (
            <div className="flex items-center gap-2.5 border-b border-line-subtle bg-warning-soft px-5 py-2.5">
              <ShieldAlert className="size-4 shrink-0 text-warning" aria-hidden />
              <p className="text-[12.5px] text-ink-2">
                Estas conexões chegaram ao endpoint sem passar pelo painel — confirme se foram
                autorizadas.
              </p>
            </div>
          )}
          {erro ? (
            <ErrorState compact onRetry={() => undefined} />
          ) : carregando ? (
            <TableWrap className="rounded-none border-0" minWidth={700}>
              <Table>
                <TBody>
                  <SkeletonRows rows={3} cols={5} />
                </TBody>
              </Table>
            </TableWrap>
          ) : externos.length === 0 ? (
            <EmptyState
              compact
              icon={<ShieldAlert aria-hidden />}
              title="Nenhum acesso externo registrado"
              description="Todo atendimento do período passou pelo painel."
            />
          ) : (
            <TableWrap className="rounded-none border-0" minWidth={720}>
              <Table>
                <THead>
                  <TR>
                    <TH>Dispositivo</TH>
                    {isSuper && <TH>Empresa</TH>}
                    <TH>Início</TH>
                    <TH align="right">Duração</TH>
                    <TH align="right">IP de origem</TH>
                  </TR>
                </THead>
                <TBody>
                  {externos.map((e, i) => (
                    <TR key={`${e.dispositivo}-${i}`}>
                      <TD>
                        <Truncate className="text-[13px] font-medium text-ink">
                          {e.dispositivo}
                        </Truncate>
                      </TD>
                      {isSuper && (
                        <TD>
                          <Truncate className="text-[12.5px] text-muted">{e.empresa}</Truncate>
                        </TD>
                      )}
                      <TD className="af-num text-[12.5px] text-muted">{dataHora(e.inicio)}</TD>
                      <TD align="right" className="af-num text-[12.5px]">
                        {fmtMin(e.duracao ?? 0)}
                      </TD>
                      <TD align="right" className="af-num font-mono text-[12px] text-muted">
                        {e.ip}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Panel>
      </Section>

      {/* -------------------------------- Relay ------------------------------- */}

      {isSuper && (
        <>
          <Section
            title="Saúde da VPS"
            description="Relay compartilhado — hbbs (sinalização) e hbbr (relay)."
          >
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-line-subtle bg-bg-secondary px-4 py-3 text-[12.5px]">
                <span className="flex items-center gap-2 text-ink">
                  <Server className="size-4 text-muted" aria-hidden />
                  <span className="font-medium">{VPS.host}</span>
                </span>
                <span className="af-num flex items-center gap-2 text-muted">
                  <Clock className="size-4" aria-hidden />
                  uptime {uptime(VPS.uptime_s)}
                </span>
                <span className="af-num flex items-center gap-2 text-muted">
                  <Cpu className="size-4" aria-hidden />
                  {VPS.ncpu} vCPU
                </span>
                <span className="af-num flex items-center gap-2 text-muted">
                  <Radio className="size-4" aria-hidden />
                  {VPS.sessoes_ativas} sessões ativas
                </span>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Panel>
                  <PanelHeader
                    title="Containers"
                    icon={<Boxes aria-hidden className={vizFg("blue")} />}
                    description="Processos do relay"
                  />
                  <PanelBody className="grid grid-cols-2 gap-3">
                    <Container label="hbbs" nome="sinalização" up={VPS.hbbs_up} />
                    <Container label="hbbr" nome="relay" up={VPS.hbbr_up} />
                  </PanelBody>
                </Panel>

                <Panel>
                  <PanelHeader
                    title="CPU & Load"
                    icon={<Cpu aria-hidden className={vizFg("cyan")} />}
                    description="Uso, I/O wait, steal e load average"
                  />
                  <PanelBody className="grid grid-cols-2 gap-3">
                    <Tile label="CPU" value={`${VPS.cpu_pct.toFixed(1)}%`} />
                    <Tile label="I/O wait" value={`${VPS.cpu_iowait_pct.toFixed(1)}%`} />
                    <Tile
                      label="Steal"
                      value={`${VPS.cpu_steal_pct.toFixed(1)}%`}
                      alerta={VPS.cpu_steal_pct > 5}
                    />
                    <Tile
                      label="Load 1 / 5 / 15"
                      value={`${VPS.load1.toFixed(2)} / ${VPS.load5.toFixed(2)} / ${VPS.load15.toFixed(2)}`}
                      sub={`de ${VPS.ncpu} vCPU`}
                      alerta={VPS.load1 > VPS.ncpu}
                    />
                  </PanelBody>
                </Panel>

                <Panel>
                  <PanelHeader
                    title="Memória"
                    icon={<MemoryStick aria-hidden className={vizFg("violet")} />}
                    description="RAM em uso e swap"
                  />
                  <PanelBody className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[12.5px] text-muted">RAM</span>
                        <span className="af-num text-[12.5px] font-medium text-ink">
                          {((VPS.mem_total_mb - VPS.mem_available_mb) / 1024).toFixed(2)} /{" "}
                          {(VPS.mem_total_mb / 1024).toFixed(2)} GB · {VPS.mem_pct.toFixed(1)}%
                        </span>
                      </div>
                      <Progress value={VPS.mem_pct} label="Uso de memória" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Tile
                        label="Disponível"
                        value={`${(VPS.mem_available_mb / 1024).toFixed(2)} GB`}
                      />
                      <Tile label="Swap em uso" value={`${VPS.swap_used_mb} MB`} />
                    </div>
                  </PanelBody>
                </Panel>

                <Panel>
                  <PanelHeader
                    title="Disco e rede"
                    icon={<HardDrive aria-hidden className={vizFg("amber")} />}
                    description="Volume principal e taxa do relay"
                  />
                  <PanelBody className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[12.5px] text-muted">Volume</span>
                        <span className="af-num text-[12.5px] font-medium text-ink">
                          {VPS.disk_used_gb} / {VPS.disk_total_gb} GB · {VPS.disk_pct}%
                        </span>
                      </div>
                      <Progress
                        value={VPS.disk_pct}
                        tone={
                          VPS.disk_pct >= 85 ? "danger" : VPS.disk_pct >= 70 ? "warning" : "primary"
                        }
                        label="Uso do disco"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <Tile label="Total" value={`${VPS.net_mbps} Mbps`} />
                      <Tile label="RX" value={`${VPS.net_rx_mbps} Mbps`} />
                      <Tile label="TX" value={`${VPS.net_tx_mbps} Mbps`} />
                    </div>
                  </PanelBody>
                </Panel>
              </div>
            </div>
          </Section>

          <Section
            title="Tendência de capacidade"
            description="Séries agregadas do relay compartilhado."
            actions={
              <Segmented<Periodo>
                label="Período"
                size="sm"
                value={periodo}
                onChange={setPeriodo}
                options={[
                  { value: "24h", label: "24h", title: "Últimas 24 horas" },
                  { value: "7d", label: "7d", title: "Últimos 7 dias" },
                  { value: "30d", label: "30d", title: "Últimos 30 dias" },
                ]}
              />
            }
          >
            {serie.length === 0 ? (
              <Panel>
                <PanelBody>
                  <EmptyState
                    compact
                    icon={<TrendingUp aria-hidden />}
                    title="Sem dados no período"
                    description="Escolha outro intervalo ou verifique o coletor da VPS."
                  />
                </PanelBody>
              </Panel>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                <Grafico
                  titulo="CPU & steal (%)"
                  icone={<Cpu aria-hidden className={vizFg("cyan")} />}
                >
                  <LineChart data={serie} margin={MARGEM}>
                    <CartesianGrid {...GRID} />
                    <XAxis {...eixoX(periodo)} />
                    <YAxis {...EIXO_Y} domain={[0, "auto"]} />
                    <RTooltip {...TOOLTIP} />
                    {linha("cpu_avg", "CPU méd", "var(--af-primary-light)")}
                    {linha("cpu_max", "CPU máx", "var(--af-primary)", true)}
                    {linha("steal_avg", "Steal", "var(--af-warning)")}
                  </LineChart>
                </Grafico>

                <Grafico
                  titulo="Load average"
                  icone={<Gauge aria-hidden className={vizFg("violet")} />}
                >
                  <LineChart data={serie} margin={MARGEM}>
                    <CartesianGrid {...GRID} />
                    <XAxis {...eixoX(periodo)} />
                    <YAxis {...EIXO_Y} domain={[0, "auto"]} />
                    <RTooltip {...TOOLTIP} />
                    {linha("load1_avg", "méd", "#a78bfa")}
                    {linha("load1_max", "máx", "#c4b5fd", true)}
                    <ReferenceLine
                      y={VPS.ncpu}
                      stroke="var(--af-warning)"
                      strokeDasharray="4 4"
                      label={{ value: "saturação", fontSize: 10, fill: "var(--af-warning)" }}
                    />
                  </LineChart>
                </Grafico>

                <Grafico
                  titulo="Memória (%)"
                  icone={<MemoryStick aria-hidden className={vizFg("violet")} />}
                >
                  <LineChart data={serie} margin={MARGEM}>
                    <CartesianGrid {...GRID} />
                    <XAxis {...eixoX(periodo)} />
                    <YAxis {...EIXO_Y} domain={[0, 100]} />
                    <RTooltip {...TOOLTIP} />
                    {linha("mem_pct_max", "RAM %", "#a78bfa")}
                  </LineChart>
                </Grafico>

                <Grafico
                  titulo="Rede / relay (Mbps)"
                  icone={<Network aria-hidden className={vizFg("emerald")} />}
                >
                  <LineChart data={serie} margin={MARGEM}>
                    <CartesianGrid {...GRID} />
                    <XAxis {...eixoX(periodo)} />
                    <YAxis {...EIXO_Y} domain={[0, "auto"]} />
                    <RTooltip {...TOOLTIP} />
                    {linha("net_avg_mbps", "Mbps", "var(--af-success)")}
                  </LineChart>
                </Grafico>

                <Grafico
                  titulo="Disco (%)"
                  icone={<HardDrive aria-hidden className={vizFg("amber")} />}
                  largo
                >
                  <LineChart data={serie} margin={MARGEM}>
                    <CartesianGrid {...GRID} />
                    <XAxis {...eixoX(periodo)} />
                    <YAxis {...EIXO_Y} domain={[0, 100]} />
                    <RTooltip {...TOOLTIP} />
                    {linha("disk_pct_max", "Disco %", "var(--af-warning)")}
                    <ReferenceLine
                      y={85}
                      stroke="var(--af-danger)"
                      strokeDasharray="4 4"
                      label={{ value: "atenção", fontSize: 10, fill: "var(--af-danger)" }}
                    />
                  </LineChart>
                </Grafico>
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function fmtMin(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function Container({ label, nome, up }: { label: string; nome: string; up: boolean | null }) {
  const on = up === true;
  const off = up === false;
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center gap-1.5 rounded-lg border px-4 py-5 text-center",
        on && "border-[color-mix(in_oklab,var(--af-success)_32%,transparent)] bg-success-soft",
        off && "border-[color-mix(in_oklab,var(--af-danger)_32%,transparent)] bg-danger-soft",
        !on && !off && "border-line-subtle bg-surface-2",
      )}
    >
      <span className="af-eyebrow">{nome}</span>
      <span
        className={cx(
          "af-num text-[20px] font-semibold leading-none",
          on ? "text-success" : off ? "text-danger" : "text-muted",
        )}
      >
        {label} · {on ? "UP" : off ? "DOWN" : "—"}
      </span>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  alerta,
}: {
  label: string;
  value: string;
  sub?: string;
  alerta?: boolean;
}) {
  return (
    <div
      className={cx(
        "rounded-lg border px-3.5 py-3",
        alerta
          ? "border-[color-mix(in_oklab,var(--af-warning)_32%,transparent)] bg-warning-soft"
          : "border-line-subtle bg-surface-2",
      )}
    >
      <p className="af-eyebrow">{label}</p>
      <p
        className={cx(
          "af-num mt-1.5 text-[19px] font-semibold leading-none",
          alerta ? "text-warning" : "text-ink",
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-1 text-[11px] text-muted">{sub}</p> : null}
    </div>
  );
}

function Grafico({
  titulo,
  icone,
  largo = false,
  children,
}: {
  titulo: string;
  icone: React.ReactNode;
  largo?: boolean;
  children: React.ReactElement;
}) {
  return (
    <Panel className={largo ? "lg:col-span-2" : undefined}>
      <PanelHeader title={titulo} icon={icone} />
      <PanelBody>
        <div className="h-[208px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        </div>
      </PanelBody>
    </Panel>
  );
}

/* Configuração comum dos gráficos — os eixos ficam inline em cada LineChart
   porque o Recharts inspeciona os filhos diretos para montar a escala. */
const MARGEM = { top: 6, right: 8, bottom: 0, left: 0 };

const GRID = {
  stroke: "var(--af-border)",
  strokeOpacity: 0.35,
  vertical: false,
} as const;

const EIXO_Y = {
  width: 38,
  tickLine: false,
  axisLine: false,
  tick: { fontSize: 11, fill: "var(--af-text-muted)" },
} as const;

const TOOLTIP = {
  cursor: { stroke: "var(--af-border-strong)", strokeWidth: 1 },
  labelFormatter: (v: unknown) => new Date(String(v)).toLocaleString("pt-BR"),
  contentStyle: {
    background: "var(--af-surface-raised)",
    border: "1px solid var(--af-border)",
    borderRadius: 8,
    fontSize: 12,
    boxShadow: "var(--af-shadow-pop)",
  },
  labelStyle: { color: "var(--af-text-secondary)", marginBottom: 4 },
  itemStyle: { color: "var(--af-text)" },
} as const;

function eixoX(periodo: Periodo) {
  return {
    dataKey: "bucket",
    tickFormatter: (iso: string) => {
      const d = new Date(iso);
      return periodo === "24h"
        ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
        : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    },
    minTickGap: 44,
    tickLine: false,
    axisLine: { stroke: "var(--af-border)" },
    tick: { fontSize: 11, fill: "var(--af-text-muted)" },
  };
}

function linha(dataKey: string, nome: string, cor: string, tracejada = false) {
  return (
    <Line
      key={dataKey}
      type="monotone"
      dataKey={dataKey}
      name={nome}
      stroke={cor}
      strokeWidth={2}
      strokeDasharray={tracejada ? "4 4" : undefined}
      dot={false}
      isAnimationActive={false}
    />
  );
}
