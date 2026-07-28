import * as React from "react";
import {
  Activity,
  ArrowRight,
  Coins,
  Cpu,
  Gauge,
  Gift,
  HardDrive,
  Monitor,
  Network,
  Radio,
  Users,
} from "lucide-react";
import { cx } from "@preview/lib/cx";
import { Button } from "@preview/components/ui/button";
import { StatusBadge } from "@preview/components/ui/badge";
import { Panel, PanelHeader, Divider } from "@preview/components/ui/panel";
import { PageHeader } from "@preview/components/ui/page";
import { Table, TBody, TD, TH, THead, TR, TableWrap, Truncate } from "@preview/components/ui/table";
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from "@preview/components/ui/states";
import { VizIcon, vizFg, type VizTone } from "@preview/components/ui/viz";
import { DeviceGlyph, DeviceStatus } from "@preview/components/domain/device-bits";
import { Link } from "@preview/lib/router";
import { tempoRelativo } from "@preview/lib/format";
import { usePreview } from "@preview/data/preview-state";
import { CARTEIRA, DASHBOARD_STATS, DISPOSITIVOS, VPS } from "@preview/data/mock";

export function DashboardScreen() {
  const { isSuper, isTech, dados } = usePreview();
  const carregando = dados === "carregando";
  const erro = dados === "erro";
  /**
   * 10 linhas, não 6.
   *
   * O painel atual busca com `.limit(6)` e a tela terminava a 743px de uma
   * janela de 985px — 242px de fundo vazio, um quarto da altura útil, logo
   * abaixo do único bloco que de fato responde "o que está acontecendo agora".
   * A cada linha de 52px, quatro linhas a mais fecham exatamente esse vão.
   *
   * Não é conteúdo novo: é mais do mesmo conteúdo que a tela já existe para
   * mostrar, e o "Ver todos" continua no lugar. Para a FASE 2 isto significa
   * trocar o `.limit(6)` da consulta por `.limit(10)` — tamanho de página, não
   * regra de negócio. Precisa do seu aval antes de eu encostar na consulta.
   */
  const recentes = dados === "vazio" || erro || carregando ? [] : DISPOSITIVOS.slice(0, 10);

  const subtitulo = isSuper
    ? `Plataforma · ${DASHBOARD_STATS.dispositivos} dispositivos · ${DASHBOARD_STATS.sessoesAtivas} sessões ativas`
    : `${DASHBOARD_STATS.dispositivos} dispositivos · ${DASHBOARD_STATS.sessoesAtivas} sessões ativas`;

  // A grade acompanha quantos cartões o papel realmente vê: nunca sobra um
  // cartão órfão numa segunda linha.
  const cartoes =
    (isTech ? 0 : 1) +
    3 +
    (isSuper ? 0 : 1) +
    (!isSuper && CARTEIRA.billing_mode === "free" ? 1 : 0);
  const colunas =
    { 3: "xl:grid-cols-3", 4: "xl:grid-cols-4", 5: "xl:grid-cols-5", 6: "xl:grid-cols-6" }[
      cartoes
    ] ?? "xl:grid-cols-4";

  return (
    <div className="space-y-5">
      {/* Sem o selo "ao vivo" no cabeçalho, a pedido.
          ATENÇÃO PARA A FASE 2: esse selo EXISTE no painel atual
          (`_authenticated/dashboard.tsx`, Badge com ponto pulsante ao lado do
          título). Tirá-lo é remover um elemento existente — o que a regra 25
          proíbe por padrão. Foi pedido explicitamente, então fica registrado
          aqui como decisão consciente, não como descuido.
          O selo "ao vivo · há Ns" do painel do relay continua: aquele diz se o
          coletor está respondendo, é informação de estado e não enfeite. */}
      <PageHeader
        title="Visão geral"
        description={carregando ? "Carregando visão geral…" : subtitulo}
      />

      {/* Métricas primárias. Os cartões de billing entram à direita, e só em
          conta metrada — por isso a contagem de colunas é dinâmica. */}
      <div className={cx("grid gap-4", "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3", colunas)}>
        {!isTech && (
          <MetricCard
            label="Usuários ativos"
            value={DASHBOARD_STATS.usuarios}
            hint={isSuper ? "Contas de todas as empresas" : "Contas habilitadas no seu tenant"}
            icon={<Users aria-hidden />}
            tone="blue"
            loading={carregando}
          />
        )}
        <MetricCard
          label="Dispositivos"
          value={DASHBOARD_STATS.dispositivos}
          hint={isSuper ? "Endpoints de todas as empresas" : "Endpoints no address book"}
          icon={<Monitor aria-hidden />}
          tone="emerald"
          loading={carregando}
          href="/dispositivos"
        />
        <MetricCard
          label="Sessões ativas"
          value={DASHBOARD_STATS.sessoesAtivas}
          hint={
            isSuper
              ? "Em andamento na plataforma"
              : isTech
                ? "Minhas conexões em andamento"
                : "Conexões em andamento agora"
          }
          icon={<Radio aria-hidden />}
          tone="amber"
          loading={carregando}
        />
        <MetricCard
          label="Sessões 24h"
          value={DASHBOARD_STATS.sessoes24h}
          hint={
            isSuper
              ? "Total da plataforma em 24h"
              : isTech
                ? "Minhas sessões nas últimas 24h"
                : "Total nas últimas 24 horas"
          }
          icon={<Activity aria-hidden />}
          tone="violet"
          loading={carregando}
          href="/auditoria"
        />
        {!isSuper && (
          <MetricCard
            label="Créditos"
            value={CARTEIRA.creditos}
            hint="Saldo disponível para atendimentos"
            icon={<Coins aria-hidden />}
            tone="lime"
            loading={carregando}
            href="/financeiro"
          />
        )}
        {!isSuper && CARTEIRA.billing_mode === "free" && (
          <MetricCard
            label="Grátis hoje"
            value={`${CARTEIRA.gratisRestante}/${CARTEIRA.gratisCap}`}
            hint="Acessos gratuitos · renova à meia-noite"
            icon={<Gift aria-hidden />}
            tone="cyan"
            loading={carregando}
          />
        )}
      </div>

      {isSuper && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Panel>
            <PanelHeader
              title="Monitoramento do relay"
              description="Saúde da VPS compartilhada"
              actions={
                VPS.capturado_ha_s <= 60 ? (
                  <StatusBadge tone="success" pulse>
                    ao vivo · há {VPS.capturado_ha_s}s
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="warning">aguardando coletor</StatusBadge>
                )
              }
            />
            <div className="grid grid-cols-2 gap-3 p-5 lg:grid-cols-4">
              <RelayTile
                label="CPU"
                value={`${VPS.cpu_pct.toFixed(1)}%`}
                icon={<Cpu aria-hidden />}
                tone="cyan"
                loading={carregando}
              />
              <RelayTile
                label="Memória"
                value={`${VPS.mem_pct.toFixed(1)}%`}
                icon={<Gauge aria-hidden />}
                tone="violet"
                loading={carregando}
              />
              <RelayTile
                label="Disco"
                value={`${VPS.disk_pct}%`}
                icon={<HardDrive aria-hidden />}
                tone="amber"
                loading={carregando}
              />
              <RelayTile
                label="Rede"
                value={`${VPS.net_mbps} Mbps`}
                icon={<Network aria-hidden />}
                tone="emerald"
                loading={carregando}
              />
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Status do sistema" description="Componentes essenciais" />
            <ul className="px-5 py-2">
              <LinhaStatus label="API do painel" ok />
              <LinhaStatus label="Banco (RLS)" ok />
              <LinhaStatus label="Coletor VPS" ok={VPS.capturado_ha_s <= 60} nota="há 12s" />
              <LinhaStatus label="Realtime" ok nota="conectado" ultimo />
            </ul>
          </Panel>
        </div>
      )}

      <Panel flush>
        <PanelHeader
          title="Dispositivos recentes"
          description={
            isSuper
              ? "Últimos endpoints cadastrados na plataforma"
              : "Últimos endpoints cadastrados na sua empresa"
          }
          actions={
            <Button variant="ghost" size="sm" asChild>
              <Link to="/dispositivos">
                Ver todos
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          }
        />
        {erro ? (
          <ErrorState compact onRetry={() => undefined} />
        ) : (
          <TableWrap className="rounded-none border-x-0 border-b-0" minWidth={760}>
            <Table>
              <THead>
                <TR>
                  <TH>Computador</TH>
                  <TH>Sistema</TH>
                  <TH>Cliente</TH>
                  {isSuper && <TH>Empresa</TH>}
                  <TH>Situação</TH>
                  <TH align="right">Últ. online</TH>
                </TR>
              </THead>
              <TBody>
                {carregando && <SkeletonRows rows={5} cols={isSuper ? 6 : 5} />}
                {!carregando && recentes.length === 0 && (
                  <tr>
                    <td colSpan={isSuper ? 6 : 5} className="border-b-0">
                      <EmptyState
                        compact
                        icon={<Monitor aria-hidden />}
                        title="Nenhum dispositivo cadastrado"
                        description="Cadastre o primeiro endpoint para começar a atender."
                        action={
                          <Button size="sm" asChild>
                            <Link to="/dispositivos">Ir para Dispositivos</Link>
                          </Button>
                        }
                      />
                    </td>
                  </tr>
                )}
                {!carregando &&
                  recentes.map((d) => (
                    <TR key={d.id}>
                      <TD>
                        <div className="flex items-center gap-2.5">
                          <DeviceGlyph status={d.status} size="sm" />
                          <div className="min-w-0">
                            <span className="block truncate text-[13.5px] font-medium text-ink">
                              {d.alias ?? d.rustdesk_id}
                            </span>
                            <span className="af-num block font-mono text-[11px] text-muted">
                              {d.rustdesk_id}
                            </span>
                          </div>
                        </div>
                      </TD>
                      <TD className="text-[12.5px] text-muted">{d.os ?? "—"}</TD>
                      <TD>
                        {d.cliente ? (
                          <Truncate className="text-[13px] text-ink-2">{d.cliente.nome}</Truncate>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </TD>
                      {isSuper && <TD className="text-[12.5px]">{d.empresa}</TD>}
                      <TD>
                        <DeviceStatus status={d.status} lastOnline={d.last_online} />
                      </TD>
                      <TD align="right" className="af-num text-[12.5px] text-muted">
                        {tempoRelativo(d.last_online)}
                      </TD>
                    </TR>
                  ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Panel>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function MetricCard({
  label,
  value,
  hint,
  icon,
  tone,
  loading,
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint: string;
  icon: React.ReactNode;
  /** cor categórica da métrica — cada cartão tem a sua, como no painel atual */
  tone: VizTone;
  loading?: boolean;
  href?: "/dispositivos" | "/auditoria" | "/financeiro";
}) {
  const conteudo = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="af-eyebrow">{label}</p>
        <VizIcon tone={tone}>{icon}</VizIcon>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-20" />
      ) : (
        <p className="af-num mt-3 text-[32px] font-semibold leading-none tracking-[-0.02em] text-ink">
          {value}
        </p>
      )}
      <p className="mt-2.5 text-[11.5px] leading-relaxed text-muted">{hint}</p>
    </>
  );

  const classe = cx(
    "af-panel flex flex-col rounded-xl border border-line-subtle bg-surface p-4 shadow-sm",
    href && "transition-colors duration-[var(--af-dur-hover)] hover:border-line hover:bg-surface-2",
  );

  if (href) {
    return (
      <Link to={href} className={classe}>
        {conteudo}
      </Link>
    );
  }
  return <div className={classe}>{conteudo}</div>;
}

function RelayTile({
  label,
  value,
  icon,
  tone,
  loading,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: VizTone;
  loading?: boolean;
}) {
  return (
    <div className="af-panel-2 rounded-lg border border-line-subtle bg-surface-2 px-4 py-3.5">
      <div className={cx("flex items-center gap-2 [&_svg]:size-3.5", vizFg(tone))}>
        {icon}
        <span className="af-eyebrow">{label}</span>
      </div>
      {loading ? (
        <Skeleton className="mt-2.5 h-6 w-16" />
      ) : (
        <p className="af-num mt-2 text-[22px] font-semibold leading-none text-ink">{value}</p>
      )}
    </div>
  );
}

function LinhaStatus({
  label,
  ok,
  nota,
  ultimo = false,
}: {
  label: string;
  ok: boolean;
  nota?: string;
  ultimo?: boolean;
}) {
  return (
    <li>
      <div className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
        <span className="text-ink-2">{label}</span>
        <span className="flex items-center gap-2">
          {nota ? <span className="text-[11.5px] text-muted">{nota}</span> : null}
          <StatusBadge tone={ok ? "success" : "warning"} pulse={ok}>
            {ok ? "ok" : "atenção"}
          </StatusBadge>
        </span>
      </div>
      {!ultimo && <Divider />}
    </li>
  );
}
