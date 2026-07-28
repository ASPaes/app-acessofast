import * as React from "react";
import { Clock, Coins, CreditCard, ExternalLink, Receipt } from "lucide-react";
import { cx } from "@preview/lib/cx";
import { Button } from "@preview/components/ui/button";
import { Badge, StatusBadge } from "@preview/components/ui/badge";
import { Panel, PanelHeader, PanelBody } from "@preview/components/ui/panel";
import { PageHeader, Section, Segmented } from "@preview/components/ui/page";
import { Modal } from "@preview/components/ui/overlay";
import { Table, TBody, TD, TH, THead, TR, TableWrap, Truncate } from "@preview/components/ui/table";
import { EmptyState, ErrorState, SkeletonRows } from "@preview/components/ui/states";
import { dataCurta, dataHora, emReais } from "@preview/lib/format";
import { usePreview } from "@preview/data/preview-state";
import { CARTEIRA, HISTORICO_CREDITOS, PACOTES_CREDITO, PLANOS } from "@preview/data/mock";

const ROTULO_LANCAMENTO: Record<string, string> = {
  purchase: "Compra",
  consume: "Consumo",
  refund: "Estorno",
  adjust: "Ajuste",
  expire: "Expiração",
};

export function FinanceiroScreen() {
  const { isSuper, dados } = usePreview();
  const [picker, setPicker] = React.useState(false);

  const carregando = dados === "carregando";
  const erro = dados === "erro";
  const historico = dados === "vazio" || erro || carregando ? [] : HISTORICO_CREDITOS;

  if (isSuper) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Financeiro"
          description="A cobrança é por empresa. Selecione uma empresa em Empresas para ver o financeiro dela."
        />
        <Panel>
          <PanelBody>
            <EmptyState
              icon={<Receipt aria-hidden />}
              title="Visão por empresa"
              description="Como super_admin você não tem carteira própria. A cobrança acontece no nível de cada tenant."
            />
          </PanelBody>
        </Panel>
      </div>
    );
  }

  const emPlano = CARTEIRA.billing_mode === "plan";
  const individual = !emPlano;
  const dias = Math.max(
    0,
    Math.ceil((new Date(CARTEIRA.planoExpiraEm).getTime() - Date.now()) / 86_400_000),
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Financeiro"
        description={
          emPlano ? "Assinatura e faturas da sua empresa." : "Créditos e faturas da sua conta."
        }
        actions={
          <Button variant="secondary" onClick={() => setPicker(true)}>
            <CreditCard aria-hidden />
            {emPlano ? "Trocar plano" : "Conhecer os planos"}
          </Button>
        }
      />

      {emPlano && (
        <Panel>
          <PanelHeader
            title="Plano e assinatura"
            icon={<CreditCard aria-hidden />}
            description={`Plano ${CARTEIRA.planoNome}`}
            actions={
              <Button size="sm" asChild>
                <a href={CARTEIRA.faturaUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink aria-hidden />
                  Ver fatura atual
                </a>
              </Button>
            }
          />
          <PanelBody className="flex flex-wrap gap-x-10 gap-y-4">
            <DadoPlano label="Situação">
              <StatusBadge tone={CARTEIRA.status === "active" ? "success" : "warning"}>
                {CARTEIRA.status === "active" ? "Ativo" : "Pagamento pendente"}
              </StatusBadge>
            </DadoPlano>
            <DadoPlano label="Vence em">
              <span className="af-num flex items-center gap-1.5 text-[13.5px] text-ink">
                <Clock className="size-3.5 text-muted" aria-hidden />
                {dataCurta(CARTEIRA.planoExpiraEm)}
                <span className="text-muted">
                  ({dias === 0 ? "hoje" : dias === 1 ? "amanhã" : `${dias} dias`})
                </span>
              </span>
            </DadoPlano>
            <DadoPlano label="Assentos">
              <span className="af-num text-[13.5px] text-ink">5 de 8 técnicos</span>
            </DadoPlano>
          </PanelBody>
        </Panel>
      )}

      {individual && (
        <>
          <Panel>
            <PanelHeader
              title="Créditos"
              icon={<Coins aria-hidden />}
              description="Cada crédito cobre 1 atendimento por dispositivo (janela de 3h)."
              actions={
                <div className="text-right">
                  <p className="af-num text-[26px] font-semibold leading-none text-ink">
                    {CARTEIRA.creditos}
                  </p>
                  <p className="text-[11px] text-muted">disponíveis</p>
                </div>
              }
            />
            <PanelBody>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {PACOTES_CREDITO.map((p) => (
                  <article
                    key={p.code}
                    className={cx(
                      "flex flex-col gap-1.5 rounded-lg border border-line-subtle bg-surface-2 p-4",
                      "transition-colors duration-[var(--af-dur-hover)] hover:border-line",
                    )}
                  >
                    <p className="af-num text-[22px] font-semibold leading-none text-ink">
                      {p.creditos}
                      <span className="text-[13px] font-normal text-muted"> créditos</span>
                    </p>
                    <p className="af-num text-[13px] text-ink-2">{emReais(p.preco_cents)}</p>
                    <p className="af-num text-[11.5px] text-muted">
                      {emReais(p.preco_cents / p.creditos)} por crédito
                    </p>
                    <Button size="sm" className="mt-3">
                      Comprar
                    </Button>
                  </article>
                ))}
              </div>
            </PanelBody>
          </Panel>

          <Panel flush>
            <PanelHeader
              title="Histórico de créditos"
              description="Compras, consumos e estornos."
              icon={<Receipt aria-hidden />}
            />
            {erro ? (
              <ErrorState compact onRetry={() => undefined} />
            ) : (
              <TableWrap className="rounded-none border-x-0 border-b-0" minWidth={680}>
                <Table>
                  <THead>
                    <TR>
                      <TH>Data</TH>
                      <TH>Tipo</TH>
                      <TH>Descrição</TH>
                      <TH align="right">Créditos</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {carregando && <SkeletonRows rows={5} cols={4} />}
                    {!carregando && historico.length === 0 && (
                      <tr>
                        <td colSpan={4} className="border-b-0">
                          <EmptyState
                            compact
                            icon={<Receipt aria-hidden />}
                            title="Nenhum lançamento ainda"
                            description="Compras e consumos de crédito aparecem aqui assim que acontecerem."
                          />
                        </td>
                      </tr>
                    )}
                    {!carregando &&
                      historico.map((h) => (
                        <TR key={h.id}>
                          <TD className="af-num text-[12.5px] text-muted">
                            {dataHora(h.criadoEm)}
                          </TD>
                          <TD>
                            <Badge
                              tone={
                                h.tipo === "purchase"
                                  ? "success"
                                  : h.tipo === "consume"
                                    ? "neutral"
                                    : h.tipo === "expire"
                                      ? "danger"
                                      : "info"
                              }
                            >
                              {ROTULO_LANCAMENTO[h.tipo]}
                            </Badge>
                          </TD>
                          <TD>
                            <Truncate className="text-[12.5px] text-ink-2" max="max-w-[320px]">
                              {h.nota ?? "—"}
                            </Truncate>
                          </TD>
                          <TD
                            align="right"
                            className={cx(
                              "af-num text-[13px] font-medium",
                              h.creditos >= 0 ? "text-success" : "text-ink-2",
                            )}
                          >
                            {h.creditos >= 0 ? `+${h.creditos}` : h.creditos}
                          </TD>
                        </TR>
                      ))}
                  </TBody>
                </Table>
              </TableWrap>
            )}
          </Panel>

          <p className="text-[12.5px] text-muted">
            Faz muitos atendimentos por mês?{" "}
            <button
              type="button"
              onClick={() => setPicker(true)}
              className="font-medium text-primary-light underline-offset-4 hover:underline"
            >
              Conheça os planos com uso ilimitado.
            </button>
          </p>
        </>
      )}

      <PlanPicker open={picker} onClose={() => setPicker(false)} />
    </div>
  );
}

function DadoPlano({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="af-eyebrow mb-1.5">{label}</p>
      {children}
    </div>
  );
}

export function PlanPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [ciclo, setCiclo] = React.useState<"monthly" | "annual">("annual");
  const compraveis = PLANOS.filter((p) => !p.sob_medida);

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Escolha seu plano"
      description="Selecione o plano e a forma de cobrança para ativar o acesso completo."
      size="xl"
      footer={
        <p className="mr-auto text-[12px] text-muted">
          Precisa de mais?{" "}
          <a
            href="https://acessofast.com.br/#contato"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-light underline underline-offset-2"
          >
            Fale com o time para o plano Enterprise.
          </a>
        </p>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Segmented
            label="Ciclo de cobrança"
            value={ciclo}
            onChange={setCiclo}
            options={[
              { value: "monthly", label: "Mensal", title: "Cobrança mensal" },
              { value: "annual", label: "Anual", title: "Cobrança anual" },
            ]}
          />
          <Badge tone="success">economize 2 meses no anual</Badge>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {compraveis.map((p) => {
            const preco = ciclo === "annual" ? p.preco_ano : p.preco_mes;
            const atual = p.code === CARTEIRA.planoAtual;
            return (
              <article
                key={p.code}
                className={cx(
                  "flex flex-col gap-2 rounded-xl border p-4",
                  atual
                    ? "border-[color-mix(in_oklab,var(--af-primary)_40%,transparent)] bg-primary-soft"
                    : "border-line-subtle bg-surface-2",
                )}
              >
                <div className="flex items-center gap-2">
                  <p className="text-[14px] font-semibold text-ink">{p.nome}</p>
                  {atual && <Badge tone="primary">Plano atual</Badge>}
                </div>
                <p className="af-num text-[24px] font-semibold leading-none text-ink">
                  {preco ? emReais(ciclo === "annual" ? preco / 12 : preco) : "—"}
                  <span className="text-[13px] font-normal text-muted">/mês</span>
                </p>
                {ciclo === "annual" && preco ? (
                  <p className="af-num text-[11.5px] text-muted">cobrado {emReais(preco)}/ano</p>
                ) : null}
                <ul className="mt-1 space-y-1 text-[12.5px] text-ink-2">
                  <li>
                    {p.max_users === null ? "Usuários ilimitados" : `Até ${p.max_users} usuários`}
                  </li>
                  <li>
                    {p.max_concurrent === null
                      ? "Sessões simultâneas sem limite"
                      : `${p.max_concurrent} sessões simultâneas por técnico`}
                  </li>
                </ul>
                <Button className="mt-auto" size="sm" variant={atual ? "secondary" : "primary"}>
                  {atual ? "Renovar com este plano" : "Assinar este plano"}
                </Button>
              </article>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
