import * as React from "react";
import { Building2, Check, Copy, Lock } from "lucide-react";
import { Button } from "@preview/components/ui/button";
import { Badge, StatusBadge } from "@preview/components/ui/badge";
import { Panel, PanelHeader, PanelBody, PanelFooter } from "@preview/components/ui/panel";
import { Field, Input, SearchField } from "@preview/components/ui/field";
import { Modal } from "@preview/components/ui/overlay";
import { PageHeader, Toolbar } from "@preview/components/ui/page";
import { Table, TBody, TD, TH, THead, TR, TableWrap, Truncate } from "@preview/components/ui/table";
import { Alert, EmptyState, ErrorState, SkeletonRows } from "@preview/components/ui/states";
import { dataCurta } from "@preview/lib/format";
import { usePreview } from "@preview/data/preview-state";
import { EMPRESAS } from "@preview/data/mock";

export function EmpresasScreen() {
  const { isSuper, dados } = usePreview();
  const [busca, setBusca] = React.useState("");
  const [provisionar, setProvisionar] = React.useState(false);

  if (!isSuper) return <RestritoPlataforma titulo="Empresas" />;

  const carregando = dados === "carregando";
  const erro = dados === "erro";
  const base = dados === "vazio" || erro || carregando ? [] : EMPRESAS;
  const lista = base.filter((e) => e.nome.toLowerCase().includes(busca.trim().toLowerCase()));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Empresas"
        description="Empresas que utilizam o sistema, com assentos, dispositivos e situação de cobrança."
        actions={
          <Button variant="secondary" onClick={() => setProvisionar(true)}>
            <Building2 aria-hidden />
            Provisionar novo tenant
          </Button>
        }
      />

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
          title="Empresas cadastradas"
          icon={<Building2 aria-hidden />}
          description={carregando ? "Carregando…" : `${lista.length} empresa(s)`}
        />
        {erro ? (
          <ErrorState onRetry={() => undefined} />
        ) : (
          <TableWrap className="rounded-none border-x-0 border-b-0" minWidth={820}>
            <Table>
              <THead>
                <TR>
                  <TH>Empresa</TH>
                  <TH align="right">Membros</TH>
                  <TH align="right">Dispositivos</TH>
                  <TH align="right">Assentos</TH>
                  <TH>Situação</TH>
                  <TH align="right">Criada em</TH>
                </TR>
              </THead>
              <TBody>
                {carregando && <SkeletonRows rows={4} cols={6} />}
                {!carregando && lista.length === 0 && (
                  <tr>
                    <td colSpan={6} className="border-b-0">
                      <EmptyState
                        icon={<Building2 aria-hidden />}
                        title={
                          busca ? "Nenhuma empresa encontrada" : "Nenhuma empresa cadastrada ainda"
                        }
                        description={
                          busca
                            ? "Revise o termo da busca."
                            : "Provisione o primeiro tenant para começar a operar a plataforma."
                        }
                        action={
                          busca ? undefined : (
                            <Button onClick={() => setProvisionar(true)}>
                              <Building2 aria-hidden />
                              Provisionar novo tenant
                            </Button>
                          )
                        }
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
                          max="max-w-[240px]"
                        >
                          {e.nome}
                        </Truncate>
                        <span className="mt-0.5 block text-[11.5px] text-muted">
                          {e.plano ?? "sem plano"} · {e.billing_mode}
                        </span>
                      </TD>
                      <TD align="right" className="af-num text-[13px]">
                        {e.membros}
                      </TD>
                      <TD align="right" className="af-num text-[13px]">
                        {e.dispositivos}
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
                      <TD>
                        <StatusBadge
                          tone={
                            !e.ativa
                              ? "neutral"
                              : e.billing_status === "active"
                                ? "success"
                                : e.billing_status === "past_due"
                                  ? "warning"
                                  : "danger"
                          }
                        >
                          {!e.ativa
                            ? "inativa"
                            : e.billing_status === "active"
                              ? "ativa"
                              : e.billing_status === "past_due"
                                ? "pagamento pendente"
                                : "suspensa"}
                        </StatusBadge>
                      </TD>
                      <TD align="right" className="af-num text-[12.5px] text-muted">
                        {dataCurta(e.criadaEm)}
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
              {lista.reduce((s, e) => s + e.membros, 0)} membros ·{" "}
              {lista.reduce((s, e) => s + e.dispositivos, 0)} dispositivos na plataforma
            </span>
          </PanelFooter>
        )}
      </Panel>

      <ProvisionarDialog open={provisionar} onClose={() => setProvisionar(false)} />
    </div>
  );
}

export function RestritoPlataforma({ titulo }: { titulo: string }) {
  return (
    <div className="space-y-5">
      <PageHeader title={titulo} description="Área da equipe da plataforma." />
      <Panel>
        <PanelBody>
          <EmptyState
            icon={<Lock aria-hidden />}
            title="Acesso restrito à equipe da plataforma"
            description="Esta tela é visível apenas para o papel super_admin. Se você precisa desses dados, fale com o administrador da conta."
          />
        </PanelBody>
      </Panel>
    </div>
  );
}

function ProvisionarDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [nome, setNome] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [assentos, setAssentos] = React.useState("1");
  const [link, setLink] = React.useState<string | null>(null);
  const [copiado, setCopiado] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setNome("");
      setEmail("");
      setAssentos("1");
      setLink(null);
      setCopiado(false);
    }
  }, [open]);

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Provisionar novo tenant"
      description="Cria um novo tenant e convida o usuário informado como admin."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
          <Button
            onClick={() => setLink("https://painel.acessofast.com.br/definir-senha?token_hash=…")}
          >
            Provisionar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nome do tenant" htmlFor="prov-nome" required>
          <Input id="prov-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
        </Field>
        <Field label="E-mail do admin" htmlFor="prov-email" required>
          <Input
            id="prov-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field
          label="Limite de assentos"
          htmlFor="prov-assentos"
          hint="Número inteiro maior ou igual a 1."
        >
          <Input
            id="prov-assentos"
            type="number"
            min={1}
            step={1}
            value={assentos}
            onChange={(e) => setAssentos(e.target.value)}
          />
        </Field>

        {link && (
          <Alert tone="info" title="E-mail automático não configurado">
            <p className="mb-2">Compartilhe este link com o convidado para definir a senha:</p>
            <div className="flex items-center gap-2">
              <Input readOnly value={link} mono />
              <Button
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard?.writeText(link);
                  setCopiado(true);
                  setTimeout(() => setCopiado(false), 1800);
                }}
              >
                {copiado ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copiado ? "Copiado" : "Copiar"}
              </Button>
            </div>
          </Alert>
        )}
      </div>
    </Modal>
  );
}
