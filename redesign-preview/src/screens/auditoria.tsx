import * as React from "react";
import { ChevronDown, ChevronRight, History, ShieldCheck } from "lucide-react";
import { cx } from "@preview/lib/cx";
import { StatusBadge, type Tone } from "@preview/components/ui/badge";
import { Panel, PanelHeader, PanelFooter } from "@preview/components/ui/panel";
import { PageHeader, Segmented, Toolbar } from "@preview/components/ui/page";
import { SearchField } from "@preview/components/ui/field";
import { Table, TBody, TD, TH, THead, TR, TableWrap, Truncate } from "@preview/components/ui/table";
import { Alert, EmptyState, ErrorState, SkeletonRows } from "@preview/components/ui/states";
import { dataHora, duracao, tempoRelativo } from "@preview/lib/format";
import { usePreview } from "@preview/data/preview-state";
import { SESSOES, type Sessao } from "@preview/data/mock";

type Visao = "grouped" | "flat";

const STATUS: Record<Sessao["status"], { tone: Tone; label: string; pulse: boolean }> = {
  active: { tone: "primary", label: "ativa", pulse: true },
  ended: { tone: "neutral", label: "encerrada", pulse: false },
  failed: { tone: "danger", label: "falhou", pulse: false },
};

export function AuditoriaScreen() {
  const { dados } = usePreview();
  const [visao, setVisao] = React.useState<Visao>("grouped");
  const [busca, setBusca] = React.useState("");
  const [aberto, setAberto] = React.useState<string | null>(null);

  const carregando = dados === "carregando";
  const erro = dados === "erro";
  const base = dados === "vazio" || erro || carregando ? [] : SESSOES;

  const filtradas = base.filter((s) => {
    const t = busca.trim().toLowerCase();
    if (!t) return true;
    return s.rustdesk_id.includes(t) || (s.tecnico ?? "").toLowerCase().includes(t);
  });

  const grupos = React.useMemo(() => {
    const mapa = new Map<string, Sessao[]>();
    for (const s of filtradas) {
      if (!mapa.has(s.rustdesk_id)) mapa.set(s.rustdesk_id, []);
      mapa.get(s.rustdesk_id)!.push(s);
    }
    return Array.from(mapa.entries())
      .map(([rustdesk_id, sessoes]) => {
        const ordenadas = [...sessoes].sort(
          (a, b) => new Date(b.inicio).getTime() - new Date(a.inicio).getTime(),
        );
        return {
          rustdesk_id,
          ultimo: ordenadas[0]!,
          tecnico: ordenadas[0]!.tecnico,
          acessos: ordenadas.filter((s) => s.status !== "failed").length,
          sessoes: ordenadas,
        };
      })
      .sort((a, b) => new Date(b.ultimo.inicio).getTime() - new Date(a.ultimo.inicio).getTime());
  }, [filtradas]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Auditoria"
        description="Registro append-only das sessões de suporte. Nenhum técnico apaga um log — nem você."
        actions={
          <Segmented<Visao>
            label="Modo de visualização"
            value={visao}
            onChange={setVisao}
            options={[
              { value: "grouped", label: "Por máquina", title: "Agrupar por máquina" },
              { value: "flat", label: "Todas as sessões", title: "Listar todas as sessões" },
            ]}
          />
        }
      />

      <Alert tone="neutral" title="Registro imutável">
        As últimas 200 sessões são carregadas por consulta. O histórico completo permanece no banco
        e nunca é sobrescrito.
      </Alert>

      <Toolbar>
        <SearchField
          className="w-full min-w-[220px] sm:w-[340px]"
          value={busca}
          onValueChange={setBusca}
          placeholder="Buscar por ID do dispositivo ou técnico…"
          aria-label="Buscar sessões"
        />
      </Toolbar>

      <Panel flush>
        <PanelHeader
          title="Últimas 200 sessões"
          icon={<History aria-hidden />}
          description={carregando ? "Carregando…" : `${filtradas.length} registro(s)`}
        />

        {erro ? (
          <ErrorState onRetry={() => undefined} />
        ) : visao === "flat" ? (
          <TableWrap className="rounded-none border-x-0 border-b-0" minWidth={860}>
            <Table>
              <THead>
                <TR>
                  <TH>Início</TH>
                  <TH>Técnico</TH>
                  <TH>Dispositivo</TH>
                  <TH>Situação</TH>
                  <TH align="right">Duração</TH>
                  <TH align="right">IP de origem</TH>
                </TR>
              </THead>
              <TBody>
                {carregando && <SkeletonRows rows={7} cols={6} />}
                {!carregando && filtradas.length === 0 && (
                  <tr>
                    <td colSpan={6} className="border-b-0">
                      <VazioAuditoria busca={busca} />
                    </td>
                  </tr>
                )}
                {!carregando &&
                  filtradas.map((s) => (
                    <TR key={s.id}>
                      <TD className="af-num text-[12.5px]">
                        <span className="block text-ink-2">{dataHora(s.inicio)}</span>
                        <span className="block text-[11px] text-muted">
                          {tempoRelativo(s.inicio)}
                        </span>
                      </TD>
                      <TD>
                        <Truncate className="text-[12.5px] text-ink-2">{s.tecnico ?? "—"}</Truncate>
                      </TD>
                      <TD className="af-num font-mono text-[12px] text-ink-2">{s.rustdesk_id}</TD>
                      <TD>
                        <StatusBadge tone={STATUS[s.status].tone} pulse={STATUS[s.status].pulse}>
                          {STATUS[s.status].label}
                        </StatusBadge>
                      </TD>
                      <TD align="right" className="af-num text-[12.5px]">
                        {duracao(s.duracao)}
                      </TD>
                      <TD align="right" className="af-num font-mono text-[12px] text-muted">
                        {s.ip ?? "—"}
                      </TD>
                    </TR>
                  ))}
              </TBody>
            </Table>
          </TableWrap>
        ) : (
          <TableWrap className="rounded-none border-x-0 border-b-0" minWidth={780}>
            <Table>
              <THead>
                <TR>
                  <TH className="w-10" />
                  <TH>Dispositivo</TH>
                  <TH>Último acesso</TH>
                  <TH>Técnico</TH>
                  <TH align="right">Acessos</TH>
                </TR>
              </THead>
              <TBody>
                {carregando && <SkeletonRows rows={6} cols={5} />}
                {!carregando && grupos.length === 0 && (
                  <tr>
                    <td colSpan={5} className="border-b-0">
                      <VazioAuditoria busca={busca} />
                    </td>
                  </tr>
                )}
                {!carregando &&
                  grupos.map((g) => {
                    const on = aberto === g.rustdesk_id;
                    return (
                      <React.Fragment key={g.rustdesk_id}>
                        <TR
                          interactive
                          onClick={() => setAberto(on ? null : g.rustdesk_id)}
                          // `af-linha-ativa` em vez de uma classe de fundo do
                          // Tailwind: a utilidade tem especificidade (0,1,0) e
                          // perderia para o zebrado (0,1,2), então a linha
                          // aberta sumiria quando calhasse de ser par.
                          className={on ? "af-linha-ativa" : undefined}
                        >
                          <TD className="pr-0">
                            <span
                              aria-hidden
                              className="grid size-6 place-items-center rounded text-muted"
                            >
                              {on ? (
                                <ChevronDown className="size-4" />
                              ) : (
                                <ChevronRight className="size-4" />
                              )}
                            </span>
                          </TD>
                          <TD className="af-num font-mono text-[12.5px] text-ink">
                            {g.rustdesk_id}
                          </TD>
                          <TD className="af-num text-[12.5px]">
                            <span className="block text-ink-2">{dataHora(g.ultimo.inicio)}</span>
                            <span className="block text-[11px] text-muted">
                              {tempoRelativo(g.ultimo.inicio)}
                            </span>
                          </TD>
                          <TD>
                            <Truncate className="text-[12.5px] text-ink-2">
                              {g.tecnico ?? "—"}
                            </Truncate>
                          </TD>
                          <TD align="right" className="af-num text-[12.5px]">
                            {g.acessos}
                          </TD>
                        </TR>
                        {on && (
                          // `af-linha-detalhe` faz o detalhe compartilhar o
                          // fundo da linha aberta, então o par (linha + detalhe)
                          // lê como UM bloco. Sem isso a linha de detalhe entra
                          // na contagem do `nth-child` como uma linha comum e a
                          // faixa aparece duas vezes seguidas na emenda.
                          <tr className="af-linha-detalhe">
                            <td colSpan={5} className="border-b border-line-subtle p-0">
                              <div className="px-4 py-3">
                                <p className="af-eyebrow mb-2">Sessões desta máquina</p>
                                <div className="overflow-hidden rounded-lg border border-line-subtle bg-surface">
                                  <Table>
                                    <THead>
                                      <TR>
                                        <TH>Início</TH>
                                        <TH>Técnico</TH>
                                        <TH>Situação</TH>
                                        <TH align="right">Duração</TH>
                                        <TH align="right">IP</TH>
                                      </TR>
                                    </THead>
                                    <TBody>
                                      {g.sessoes.map((s) => (
                                        <TR key={s.id}>
                                          <TD className="af-num text-[12.5px]">
                                            {dataHora(s.inicio)}
                                          </TD>
                                          <TD>
                                            <Truncate className="text-[12.5px] text-ink-2">
                                              {s.tecnico ?? "—"}
                                            </Truncate>
                                          </TD>
                                          <TD>
                                            <StatusBadge
                                              tone={STATUS[s.status].tone}
                                              pulse={STATUS[s.status].pulse}
                                            >
                                              {STATUS[s.status].label}
                                            </StatusBadge>
                                          </TD>
                                          <TD align="right" className="af-num text-[12.5px]">
                                            {duracao(s.duracao)}
                                          </TD>
                                          <TD
                                            align="right"
                                            className="af-num font-mono text-[12px] text-muted"
                                          >
                                            {s.ip ?? "—"}
                                          </TD>
                                        </TR>
                                      ))}
                                    </TBody>
                                  </Table>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
              </TBody>
            </Table>
          </TableWrap>
        )}

        {!erro && !carregando && filtradas.length > 0 && (
          <PanelFooter>
            <span className={cx("flex items-center gap-1.5")}>
              <ShieldCheck className="size-3.5" aria-hidden />
              Log append-only — registros não podem ser editados nem removidos
            </span>
            <span className="af-num">{filtradas.length} de 200</span>
          </PanelFooter>
        )}
      </Panel>
    </div>
  );
}

function VazioAuditoria({ busca }: { busca: string }) {
  return (
    <EmptyState
      icon={<History aria-hidden />}
      title={busca ? "Nenhuma sessão bate com a busca" : "Nenhuma sessão registrada ainda"}
      description={
        busca
          ? "Tente o ID completo do dispositivo ou o e-mail do técnico."
          : "Assim que o primeiro atendimento for aberto pelo painel, ele aparece aqui."
      }
    />
  );
}
