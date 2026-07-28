import * as React from "react";
import { Pencil, Plus, Search, Store } from "lucide-react";
import { Button } from "@preview/components/ui/button";
import { Badge } from "@preview/components/ui/badge";
import { Panel, PanelHeader, PanelFooter } from "@preview/components/ui/panel";
import { Field, Input, SearchField, Select } from "@preview/components/ui/field";
import { Modal } from "@preview/components/ui/overlay";
import { PageHeader, Toolbar } from "@preview/components/ui/page";
import { Table, TBody, TD, TH, THead, TR, TableWrap, Truncate } from "@preview/components/ui/table";
import { EmptyState, ErrorState, SkeletonRows } from "@preview/components/ui/states";
import { documento } from "@preview/lib/format";
import { usePreview } from "@preview/data/preview-state";
import { CLIENTES, EMPRESAS_SELECT, type Cliente } from "@preview/data/mock";

export function ClientesScreen() {
  const { isSuper, dados } = usePreview();
  const [busca, setBusca] = React.useState("");
  const [empresa, setEmpresa] = React.useState(isSuper ? "" : EMPRESAS_SELECT[0]);
  const [editando, setEditando] = React.useState<Cliente | null>(null);
  const [criando, setCriando] = React.useState(false);

  const carregando = dados === "carregando";
  const erro = dados === "erro";
  const base = dados === "vazio" || erro || carregando ? [] : CLIENTES;

  const semEmpresa = isSuper && !empresa;
  const lista = base.filter((c) => {
    const t = busca.trim().toLowerCase();
    if (!t) return true;
    const digitos = t.replace(/\D/g, "");
    return (
      c.nome.toLowerCase().includes(t) ||
      (digitos.length > 0 && (c.documento ?? "").includes(digitos))
    );
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Clientes"
        description="Clientes cadastrados na empresa e o vínculo deles com os dispositivos."
        actions={
          <Button disabled={semEmpresa} onClick={() => setCriando(true)}>
            <Plus aria-hidden />
            Novo cliente
          </Button>
        }
      />

      <Toolbar>
        <SearchField
          className="w-full min-w-[220px] sm:w-[320px]"
          value={busca}
          onValueChange={setBusca}
          placeholder="Buscar por nome ou documento…"
          aria-label="Buscar clientes"
        />
        {isSuper && (
          <Select
            selectSize="sm"
            className="w-[220px]"
            aria-label="Empresa"
            value={empresa}
            onChange={(e) => setEmpresa(e.target.value)}
          >
            <option value="">Selecione uma empresa</option>
            {EMPRESAS_SELECT.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </Select>
        )}
      </Toolbar>

      <Panel flush>
        <PanelHeader
          title="Clientes cadastrados"
          icon={<Store aria-hidden />}
          description={
            semEmpresa
              ? "Selecione uma empresa"
              : carregando
                ? "Carregando…"
                : `${lista.length} cliente${lista.length === 1 ? "" : "s"}`
          }
        />
        {erro ? (
          <ErrorState onRetry={() => undefined} />
        ) : (
          <TableWrap className="rounded-none border-x-0 border-b-0" minWidth={620}>
            <Table>
              <THead>
                <TR>
                  <TH>Cliente</TH>
                  <TH>CNPJ / CPF</TH>
                  <TH align="right">Dispositivos</TH>
                  <TH align="right">Ações</TH>
                </TR>
              </THead>
              <TBody>
                {carregando && <SkeletonRows rows={5} cols={4} />}
                {!carregando && semEmpresa && (
                  <tr>
                    <td colSpan={4} className="border-b-0">
                      <EmptyState
                        icon={<Store aria-hidden />}
                        title="Selecione uma empresa"
                        description="A carteira de clientes é por empresa. Escolha uma no filtro acima para listar."
                      />
                    </td>
                  </tr>
                )}
                {!carregando && !semEmpresa && lista.length === 0 && (
                  <tr>
                    <td colSpan={4} className="border-b-0">
                      <EmptyState
                        icon={busca ? <Search aria-hidden /> : <Store aria-hidden />}
                        title={
                          busca ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado ainda"
                        }
                        description={
                          busca
                            ? "Revise o termo da busca ou o documento digitado."
                            : "Cadastre a primeira empresa atendida para agrupar os dispositivos dela."
                        }
                        action={
                          busca ? undefined : (
                            <Button onClick={() => setCriando(true)}>
                              <Plus aria-hidden />
                              Novo cliente
                            </Button>
                          )
                        }
                      />
                    </td>
                  </tr>
                )}
                {!carregando &&
                  !semEmpresa &&
                  lista.map((c) => (
                    <TR key={c.id}>
                      <TD>
                        <Truncate
                          className="text-[13.5px] font-medium text-ink"
                          max="max-w-[280px]"
                        >
                          {c.nome}
                        </Truncate>
                      </TD>
                      <TD className="af-num text-[12.5px] text-muted">
                        {documento(c.documento, c.tipo) ?? "—"}
                      </TD>
                      <TD align="right">
                        {c.dispositivos > 0 ? (
                          <Badge tone="neutral" className="af-num">
                            {c.dispositivos}
                          </Badge>
                        ) : (
                          <span className="text-muted">0</span>
                        )}
                      </TD>
                      <TD align="right">
                        <Button variant="ghost" size="sm" onClick={() => setEditando(c)}>
                          <Pencil aria-hidden />
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
            <span>
              {lista.length} cliente{lista.length === 1 ? "" : "s"} ·{" "}
              {lista.reduce((s, c) => s + c.dispositivos, 0)} dispositivos vinculados
            </span>
          </PanelFooter>
        )}
      </Panel>

      <ClienteDialog
        open={criando || editando !== null}
        cliente={editando}
        onClose={() => {
          setCriando(false);
          setEditando(null);
        }}
      />
    </div>
  );
}

function ClienteDialog({
  open,
  cliente,
  onClose,
}: {
  open: boolean;
  cliente: Cliente | null;
  onClose: () => void;
}) {
  const [nome, setNome] = React.useState("");
  const [doc, setDoc] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setNome(cliente?.nome ?? "");
      setDoc(cliente?.documento ?? "");
      setErro(null);
    }
  }, [open, cliente]);

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={cliente ? "Editar cliente" : "Novo cliente"}
      description={
        cliente
          ? "Atualize os dados do cliente."
          : "Cadastre um novo cliente na empresa selecionada."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              if (!nome.trim()) {
                setErro("Informe o nome do cliente.");
                return;
              }
              onClose();
            }}
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nome" htmlFor="cliente-nome" required error={erro}>
          <Input
            id="cliente-nome"
            value={nome}
            invalid={!!erro}
            onChange={(e) => {
              setNome(e.target.value);
              setErro(null);
            }}
          />
        </Field>
        <Field
          label="CNPJ ou CPF"
          htmlFor="cliente-doc"
          hint="Somente dígitos — 14 para CNPJ, 11 para CPF."
        >
          <Input id="cliente-doc" mono value={doc} onChange={(e) => setDoc(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
