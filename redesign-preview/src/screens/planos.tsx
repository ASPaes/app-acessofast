import * as React from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@preview/components/ui/button";
import { Badge } from "@preview/components/ui/badge";
import { Panel, PanelHeader, PanelFooter } from "@preview/components/ui/panel";
import { Field, Input, SearchField, Select } from "@preview/components/ui/field";
import { Modal } from "@preview/components/ui/overlay";
import { PageHeader, Toolbar } from "@preview/components/ui/page";
import { Table, TBody, TD, TH, THead, TR, TableWrap, Truncate } from "@preview/components/ui/table";
import { Alert, EmptyState, ErrorState, SkeletonRows } from "@preview/components/ui/states";
import { usePreview } from "@preview/data/preview-state";
import { EMPRESAS, PLANOS, type Empresa } from "@preview/data/mock";
import { RestritoPlataforma } from "./empresas";

const SEM_LIMITE = "sem limite";

export function PlanosScreen() {
  const { isSuper, dados } = usePreview();
  const [busca, setBusca] = React.useState("");
  const [editando, setEditando] = React.useState<Empresa | null>(null);

  if (!isSuper) return <RestritoPlataforma titulo="Planos" />;

  const carregando = dados === "carregando";
  const erro = dados === "erro";
  const base = dados === "vazio" || erro || carregando ? [] : EMPRESAS;
  const lista = base.filter((e) => e.nome.toLowerCase().includes(busca.trim().toLowerCase()));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Planos"
        description="Ajuste manual de plano, técnicos e sessões simultâneas por empresa."
      />

      <Alert tone="neutral" title="Precedência dos limites">
        Um valor definido na empresa sobrepõe o padrão do plano. Campo vazio significa herdar do
        plano. O super_admin não entra na conta de sessões simultâneas.
      </Alert>

      <Toolbar>
        <SearchField
          className="w-full min-w-[220px] sm:w-[320px]"
          value={busca}
          onValueChange={setBusca}
          placeholder="Buscar empresa…"
          aria-label="Buscar empresas"
        />
      </Toolbar>

      <Panel flush>
        <PanelHeader
          title="Empresas e limites"
          icon={<SlidersHorizontal aria-hidden />}
          description={carregando ? "Carregando…" : `${lista.length} empresa(s)`}
        />
        {erro ? (
          <ErrorState onRetry={() => undefined} />
        ) : (
          <TableWrap className="rounded-none border-x-0 border-b-0" minWidth={880}>
            <Table>
              <THead>
                <TR>
                  <TH>Empresa</TH>
                  <TH>Plano</TH>
                  <TH align="right">Técnicos</TH>
                  <TH align="right">Simultâneas por técnico</TH>
                  <TH>Cobrança</TH>
                  <TH align="right">Ações</TH>
                </TR>
              </THead>
              <TBody>
                {carregando && <SkeletonRows rows={4} cols={6} />}
                {!carregando && lista.length === 0 && (
                  <tr>
                    <td colSpan={6} className="border-b-0">
                      <EmptyState
                        icon={<SlidersHorizontal aria-hidden />}
                        title="Nenhuma empresa cadastrada ainda"
                        description="Provisione um tenant em Empresas para aparecer aqui."
                      />
                    </td>
                  </tr>
                )}
                {!carregando &&
                  lista.map((e) => (
                    <TR key={e.id} muted={!e.ativa}>
                      <TD>
                        <Truncate
                          className="text-[13.5px] font-medium text-ink"
                          max="max-w-[220px]"
                        >
                          {e.nome}
                        </Truncate>
                        {!e.ativa && (
                          <Badge tone="neutral" className="mt-1">
                            inativa
                          </Badge>
                        )}
                      </TD>
                      <TD className="text-[13px] text-ink-2">
                        {e.plano ?? <span className="text-muted">sem plano</span>}
                      </TD>
                      <TD align="right" className="af-num text-[13px]">
                        {e.membros}
                        <span className="text-muted"> / {e.assentos}</span>
                        {e.membros > e.assentos && (
                          <Badge tone="danger" className="ml-2">
                            acima
                          </Badge>
                        )}
                      </TD>
                      <TD align="right" className="af-num text-[13px]">
                        {e.simultaneas ?? <span className="text-muted">{SEM_LIMITE}</span>}
                        {e.simultaneasOverride && (
                          <Badge tone="info" className="ml-2">
                            override
                          </Badge>
                        )}
                      </TD>
                      <TD className="text-[12px] text-muted">
                        {e.billing_mode} · {e.billing_status}
                      </TD>
                      <TD align="right">
                        <Button variant="secondary" size="sm" onClick={() => setEditando(e)}>
                          Editar
                        </Button>
                      </TD>
                    </TR>
                  ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
        {!erro && !carregando && lista.length > 0 && (
          <PanelFooter>
            <span>Catálogo com {PLANOS.length} planos ativos</span>
          </PanelFooter>
        )}
      </Panel>

      <EditarPlanoDialog empresa={editando} onClose={() => setEditando(null)} />
    </div>
  );
}

function EditarPlanoDialog({ empresa, onClose }: { empresa: Empresa | null; onClose: () => void }) {
  const [codigo, setCodigo] = React.useState("");
  const [assentos, setAssentos] = React.useState("");
  const [simultaneas, setSimultaneas] = React.useState("");

  React.useEffect(() => {
    if (!empresa) return;
    setCodigo(PLANOS.find((p) => p.nome === empresa.plano)?.code ?? "");
    setAssentos(String(empresa.assentos));
    setSimultaneas(empresa.simultaneas === null ? "" : String(empresa.simultaneas));
  }, [empresa]);

  const plano = PLANOS.find((p) => p.code === codigo);
  const excede =
    plano?.max_users !== null &&
    plano !== undefined &&
    empresa !== null &&
    empresa.membros > (plano.max_users ?? 0) &&
    assentos.trim() === "";

  return (
    <Modal
      open={empresa !== null}
      onOpenChange={(v) => !v && onClose()}
      title={`Editar plano — ${empresa?.nome ?? ""}`}
      description="Deixe um campo numérico vazio para herdar o valor do plano."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={onClose}>Salvar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Plano" htmlFor="pl-codigo" required>
          <Select id="pl-codigo" value={codigo} onChange={(e) => setCodigo(e.target.value)}>
            <option value="">Escolha um plano</option>
            {PLANOS.map((p) => (
              <option key={p.code} value={p.code}>
                {p.nome}
                {p.sob_medida ? " · sob medida" : ""}
                {p.ativo ? "" : " · inativo"}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Técnicos (assentos)"
          htmlFor="pl-assentos"
          hint={`Padrão do plano: ${plano?.max_users ?? SEM_LIMITE}`}
        >
          <Input
            id="pl-assentos"
            type="number"
            min={1}
            step={1}
            value={assentos}
            placeholder="herdar do plano"
            onChange={(e) => setAssentos(e.target.value)}
          />
        </Field>

        <Field
          label="Sessões simultâneas por técnico"
          htmlFor="pl-simultaneas"
          hint={`Padrão do plano: ${plano?.max_concurrent ?? SEM_LIMITE} · super_admin não entra nessa conta.`}
        >
          <Input
            id="pl-simultaneas"
            type="number"
            min={1}
            step={1}
            value={simultaneas}
            placeholder="herdar do plano"
            onChange={(e) => setSimultaneas(e.target.value)}
          />
        </Field>

        {excede && (
          <Alert tone="warning" title="Assentos abaixo do uso atual">
            A empresa tem {empresa?.membros} usuário(s) e este plano dá {plano?.max_users}{" "}
            assento(s). Informe um número em Técnicos para não reduzir.
          </Alert>
        )}
      </div>
    </Modal>
  );
}
