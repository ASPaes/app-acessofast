import * as React from "react";
import { Search, Send, UserCheck, UserPlus, UserX, Users } from "lucide-react";
import { Button } from "@preview/components/ui/button";
import { Badge, StatusBadge } from "@preview/components/ui/badge";
import { Panel, PanelHeader, PanelFooter } from "@preview/components/ui/panel";
import { Field, Input, SearchField, Select } from "@preview/components/ui/field";
import { ConfirmDialog, Modal, Tooltip } from "@preview/components/ui/overlay";
import { PageHeader, Toolbar } from "@preview/components/ui/page";
import { Table, TBody, TD, TH, THead, TR, TableWrap, Truncate } from "@preview/components/ui/table";
import { EmptyState, ErrorState, SkeletonRows } from "@preview/components/ui/states";
import { dataCurta } from "@preview/lib/format";
import { usePreview } from "@preview/data/preview-state";
import { EMPRESAS_SELECT, ROTULO_PAPEL, USUARIOS, type Usuario } from "@preview/data/mock";

export function UsuariosScreen() {
  const { isSuper, dados } = usePreview();
  const [busca, setBusca] = React.useState("");
  const [empresa, setEmpresa] = React.useState("all");
  const [convidando, setConvidando] = React.useState(false);
  const [desativando, setDesativando] = React.useState<Usuario | null>(null);

  const carregando = dados === "carregando";
  const erro = dados === "erro";
  const base = dados === "vazio" || erro || carregando ? [] : USUARIOS;

  const lista = base.filter((u) => {
    if (!isSuper && u.empresa !== "NorteTI Suporte") return false;
    if (isSuper && empresa !== "all" && u.empresa !== empresa) return false;
    const t = busca.trim().toLowerCase();
    if (!t) return true;
    return (u.nome ?? "").toLowerCase().includes(t) || u.email.toLowerCase().includes(t);
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Usuários"
        description="Membros do painel. Convites e mudança de papel são operações do backend."
        actions={
          <Button onClick={() => setConvidando(true)}>
            <UserPlus aria-hidden />
            Convidar membro
          </Button>
        }
      />

      <Toolbar>
        <SearchField
          className="w-full min-w-[220px] sm:w-[320px]"
          value={busca}
          onValueChange={setBusca}
          placeholder="Buscar por nome ou e-mail…"
          aria-label="Buscar usuários"
        />
        {isSuper && (
          <Select
            selectSize="sm"
            className="w-[210px]"
            aria-label="Filtrar por empresa"
            value={empresa}
            onChange={(e) => setEmpresa(e.target.value)}
          >
            <option value="all">Todas as empresas</option>
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
          title="Membros"
          icon={<Users aria-hidden />}
          description={carregando ? "Carregando…" : `${lista.length} usuário(s)`}
        />
        {erro ? (
          <ErrorState onRetry={() => undefined} />
        ) : (
          <TableWrap className="rounded-none border-x-0 border-b-0" minWidth={900}>
            <Table>
              <THead>
                <TR>
                  <TH>Membro</TH>
                  {isSuper && <TH>Empresa</TH>}
                  <TH>Papel</TH>
                  <TH>Situação</TH>
                  <TH>Criado em</TH>
                  <TH align="right">Ações</TH>
                </TR>
              </THead>
              <TBody>
                {carregando && <SkeletonRows rows={5} cols={isSuper ? 6 : 5} />}
                {!carregando && lista.length === 0 && (
                  <tr>
                    <td colSpan={isSuper ? 6 : 5} className="border-b-0">
                      <EmptyState
                        icon={busca ? <Search aria-hidden /> : <Users aria-hidden />}
                        title={
                          busca
                            ? "Nenhum usuário encontrado"
                            : "Nenhum usuário visível para o seu papel"
                        }
                        description={
                          busca
                            ? "Revise o nome ou o e-mail digitado."
                            : "Convide o primeiro técnico para começar a distribuir os atendimentos."
                        }
                        action={
                          busca ? undefined : (
                            <Button onClick={() => setConvidando(true)}>
                              <UserPlus aria-hidden />
                              Convidar membro
                            </Button>
                          )
                        }
                      />
                    </td>
                  </tr>
                )}
                {!carregando &&
                  lista.map((u) => (
                    <TR key={u.id} muted={!u.ativo}>
                      <TD>
                        <div className="flex items-center gap-2.5">
                          <Avatar nome={u.nome ?? u.email} />
                          <div className="min-w-0">
                            <span className="block truncate text-[13.5px] font-medium text-ink">
                              {u.nome ?? "—"}
                            </span>
                            <span className="block truncate text-[11.5px] text-muted">
                              {u.email}
                            </span>
                          </div>
                        </div>
                      </TD>
                      {isSuper && (
                        <TD>
                          {u.empresa ? (
                            <Truncate className="text-[12.5px] text-ink-2">{u.empresa}</Truncate>
                          ) : (
                            <Badge tone="primary">Plataforma</Badge>
                          )}
                        </TD>
                      )}
                      <TD>
                        <Badge tone={u.papel === "super_admin" ? "primary" : "neutral"}>
                          {ROTULO_PAPEL[u.papel]}
                        </Badge>
                      </TD>
                      <TD>
                        <StatusBadge tone={u.ativo ? "success" : "neutral"}>
                          {u.ativo ? "ativo" : "inativo"}
                        </StatusBadge>
                      </TD>
                      <TD className="af-num text-[12.5px] text-muted">{dataCurta(u.criadoEm)}</TD>
                      <TD align="right">
                        <div className="flex items-center justify-end gap-1.5">
                          {u.papel !== "super_admin" && (
                            <Tooltip content={`Reenviar convite para ${u.email}`}>
                              <Button variant="ghost" size="sm">
                                <Send aria-hidden />
                                Reenviar convite
                              </Button>
                            </Tooltip>
                          )}
                          {u.papel !== "super_admin" &&
                            (u.ativo ? (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setDesativando(u)}
                              >
                                <UserX aria-hidden />
                                Desativar
                              </Button>
                            ) : (
                              <Button variant="secondary" size="sm">
                                <UserCheck aria-hidden />
                                Reativar
                              </Button>
                            ))}
                        </div>
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
              {lista.filter((u) => u.ativo).length} ativos · {lista.filter((u) => !u.ativo).length}{" "}
              inativos
            </span>
          </PanelFooter>
        )}
      </Panel>

      <ConvidarDialog open={convidando} onClose={() => setConvidando(false)} isSuper={isSuper} />

      <ConfirmDialog
        open={desativando !== null}
        onOpenChange={(v) => !v && setDesativando(null)}
        title="Desativar usuário?"
        description="Ele deixa de conseguir obter senhas de dispositivos pelo painel. A sessão aberta dele não é encerrada e as senhas que ele já viu continuam válidas. Você pode reativá-lo depois."
        confirmLabel="Desativar"
        destructive
        onConfirm={() => undefined}
      />
    </div>
  );
}

function Avatar({ nome }: { nome: string }) {
  const p = nome.trim().split(/\s+/);
  const ini = ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1]![0] : "")).toUpperCase();
  return (
    <span
      aria-hidden
      className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-2 text-[11px] font-semibold text-ink-2"
    >
      {ini}
    </span>
  );
}

function ConvidarDialog({
  open,
  onClose,
  isSuper,
}: {
  open: boolean;
  onClose: () => void;
  isSuper: boolean;
}) {
  const [email, setEmail] = React.useState("");
  const [nome, setNome] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setEmail("");
      setNome("");
      setErro(null);
    }
  }, [open]);

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Convidar membro"
      description="O convidado receberá acesso ao seu tenant após definir a senha."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
          <Button
            onClick={() => {
              if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
                setErro("Informe um e-mail válido.");
                return;
              }
              onClose();
            }}
          >
            Convidar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="E-mail" htmlFor="inv-email" required error={erro}>
          <Input
            id="inv-email"
            type="email"
            value={email}
            invalid={!!erro}
            placeholder="nome@empresa.com.br"
            onChange={(e) => {
              setEmail(e.target.value);
              setErro(null);
            }}
          />
        </Field>
        <Field label="Nome" htmlFor="inv-nome">
          <Input id="inv-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
        </Field>
        {isSuper && (
          <Field label="Empresa" htmlFor="inv-empresa" required>
            <Select id="inv-empresa" defaultValue="">
              <option value="" disabled>
                Selecione a empresa
              </option>
              {EMPRESAS_SELECT.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field
          label="Papel"
          htmlFor="inv-papel"
          hint="Define o que a pessoa enxerga dentro do painel."
        >
          <Select id="inv-papel" defaultValue="tech">
            <option value="tech">Técnico</option>
            <option value="admin">Admin</option>
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
