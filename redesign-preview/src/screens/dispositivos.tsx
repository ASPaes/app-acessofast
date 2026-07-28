import * as React from "react";
import {
  Activity,
  Check,
  ChevronDown,
  ChevronRight,
  Coins,
  Copy,
  ExternalLink,
  FolderTree,
  Gift,
  KeyRound,
  LayoutGrid,
  List,
  Monitor,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Search,
  Star,
  Tag,
  X,
} from "lucide-react";
import { cx } from "@preview/lib/cx";
import { Button, IconButton } from "@preview/components/ui/button";
import { Badge, Dot } from "@preview/components/ui/badge";
import { Panel, PanelHeader, PanelFooter } from "@preview/components/ui/panel";
import { Field, Input, SearchField, Select, Switch } from "@preview/components/ui/field";
import {
  ConfirmDialog,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
  DropdownTrigger,
  Modal,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
} from "@preview/components/ui/overlay";
import {
  PageHeader,
  Segmented,
  StatCell,
  StatStrip,
  Toolbar,
  ToolbarDivider,
} from "@preview/components/ui/page";
import { Table, TBody, TD, TH, THead, TR, TableWrap, Truncate } from "@preview/components/ui/table";
import { Alert, EmptyState, ErrorState, SkeletonRows } from "@preview/components/ui/states";
import {
  ConsumoBadge,
  DeviceGlyph,
  DeviceStatus,
  MarkerChip,
  MarkerDot,
} from "@preview/components/domain/device-bits";
import { documento, tempoRelativo } from "@preview/lib/format";
import { usePreview } from "@preview/data/preview-state";
import {
  CARTEIRA,
  CLIENTES,
  DISPOSITIVOS,
  EMPRESAS_SELECT,
  MARCADORES,
  SENHA_EXEMPLO,
  type Dispositivo,
} from "@preview/data/mock";

type Visao = "list" | "grid" | "grouped";

export function DispositivosScreen() {
  const { isSuper, dados } = usePreview();

  const [busca, setBusca] = React.useState("");
  const [empresa, setEmpresa] = React.useState("all");
  const [soFavoritos, setSoFavoritos] = React.useState(false);
  const [mostrarInativos, setMostrarInativos] = React.useState(false);
  const [marcadores, setMarcadores] = React.useState<Set<string>>(new Set());
  const [visao, setVisao] = React.useState<Visao>("list");
  const [gruposAbertos, setGruposAbertos] = React.useState<Set<string>>(
    () => new Set(["Padaria São Jorge"]),
  );

  // Modais
  const [conectando, setConectando] = React.useState<string | null>(null);
  const [conexao, setConexao] = React.useState<Dispositivo | null>(null);
  const [escolha, setEscolha] = React.useState<Dispositivo | null>(null);
  const [editando, setEditando] = React.useState<Dispositivo | null>(null);
  const [adicionando, setAdicionando] = React.useState(false);
  const [confirmarInativar, setConfirmarInativar] = React.useState<Dispositivo | null>(null);
  const [confirmarRedefinir, setConfirmarRedefinir] = React.useState<Dispositivo | null>(null);
  const [senhaRedefinida, setSenhaRedefinida] = React.useState<Dispositivo | null>(null);

  const [agora, setAgora] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const carregando = dados === "carregando";
  const erro = dados === "erro";
  const base = React.useMemo(
    () => (dados === "vazio" || dados === "erro" || dados === "carregando" ? [] : DISPOSITIVOS),
    [dados],
  );

  const filtrados = React.useMemo(() => {
    const t = busca.trim().toLowerCase();
    return base.filter((d) => {
      if (!mostrarInativos && !d.ativo) return false;
      if (soFavoritos && !d.favorito) return false;
      if (isSuper && empresa !== "all" && d.empresa !== empresa) return false;
      if (marcadores.size > 0 && !d.marcadores.some((m) => marcadores.has(m))) return false;
      if (t) {
        const digitos = t.replace(/\D/g, "");
        const bate =
          d.rustdesk_id.toLowerCase().includes(t) ||
          (d.alias ?? "").toLowerCase().includes(t) ||
          (d.device_group ?? "").toLowerCase().includes(t) ||
          (d.cliente?.nome ?? "").toLowerCase().includes(t) ||
          (digitos.length > 0 && (d.cliente?.documento ?? "").includes(digitos));
        if (!bate) return false;
      }
      return true;
    });
  }, [base, busca, empresa, isSuper, marcadores, mostrarInativos, soFavoritos]);

  const contagem = React.useMemo(() => {
    let online = 0;
    let atendimento = 0;
    let offline = 0;
    for (const d of base) {
      if (!d.ativo) continue;
      if (d.status === "atendimento") atendimento++;
      else if (d.status === "online") online++;
      else offline++;
    }
    return { online, atendimento, offline };
  }, [base]);

  const metered = !isSuper;
  const sessoesAtivas = base.filter((d) => d.consumo).length;
  const filtrosAtivos =
    busca.trim().length > 0 || soFavoritos || marcadores.size > 0 || (isSuper && empresa !== "all");

  const grupos = React.useMemo(() => {
    const mapa = new Map<string, Dispositivo[]>();
    for (const d of filtrados) {
      const chave = d.device_group?.trim() || "Sem grupo";
      if (!mapa.has(chave)) mapa.set(chave, []);
      mapa.get(chave)!.push(d);
    }
    return Array.from(mapa.entries())
      .map(([label, devices]) => ({
        label,
        devices,
        online: devices.filter((d) => d.ativo && d.status === "online").length,
        atendimento: devices.filter((d) => d.ativo && d.status === "atendimento").length,
        offline: devices.filter(
          (d) => d.ativo && (d.status === "offline" || d.status === "inativo"),
        ).length,
        documento: devices.find((d) => d.cliente?.documento)?.cliente ?? null,
        ultimo: devices.reduce<string | null>(
          (acc, d) => (d.last_online && (!acc || d.last_online > acc) ? d.last_online : acc),
          null,
        ),
      }))
      .sort((a, b) =>
        a.label === "Sem grupo"
          ? 1
          : b.label === "Sem grupo"
            ? -1
            : a.label.localeCompare(b.label, "pt-BR"),
      );
  }, [filtrados]);

  function conectar(d: Dispositivo) {
    setConectando(d.id);
    // Simula a ida ao servidor: contas individuais com grátis E crédito
    // recebem a pergunta antes de a senha ser emitida (mesmo fluxo atual).
    setTimeout(() => {
      setConectando(null);
      if (metered && CARTEIRA.gratisRestante > 0 && CARTEIRA.creditos > 0 && !d.consumo) {
        setEscolha(d);
      } else {
        setConexao(d);
      }
    }, 450);
  }

  const colunas = 4 + (isSuper ? 1 : 0) + (metered ? 1 : 0) + 1;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dispositivos"
        description="Endpoints AcessoFast cadastrados no address book do seu tenant. É daqui que sai o atendimento."
        actions={
          <>
            <Button variant="secondary" onClick={() => setVisao("grouped")}>
              <FolderTree aria-hidden />
              Ver por cliente
            </Button>
            <Button onClick={() => setAdicionando(true)}>
              <Plus aria-hidden />
              Adicionar dispositivo
            </Button>
          </>
        }
      />

      {/* Resumo de estado + carteira, lado a lado. Substitui os dois cards
          soltos que hoje ficam empilhados acima da tabela. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto]">
        <StatStrip>
          <StatCell
            label="Online"
            value={contagem.online}
            hint="prontos para conexão"
            icon={<Dot tone="success" />}
            tone="success"
            loading={carregando}
          />
          <StatCell
            label="Em atendimento"
            value={contagem.atendimento}
            hint="sessão em andamento"
            icon={<Dot tone="warning" />}
            tone="warning"
            loading={carregando}
          />
          <StatCell
            label="Offline"
            value={contagem.offline}
            hint="sem heartbeat recente"
            icon={<Dot tone="neutral" />}
            tone="neutral"
            loading={carregando}
          />
        </StatStrip>

        {metered && (
          <StatStrip>
            {CARTEIRA.billing_mode === "free" && (
              <StatCell
                label="Grátis hoje"
                value={
                  <>
                    {CARTEIRA.gratisRestante}
                    <span className="text-[15px] font-normal text-muted">
                      /{CARTEIRA.gratisCap}
                    </span>
                  </>
                }
                hint="renova à meia-noite"
                icon={<Gift />}
                viz="cyan"
              />
            )}
            <StatCell
              label="Créditos"
              value={CARTEIRA.creditos}
              hint="saldo disponível"
              icon={<Coins />}
              viz="lime"
            />
            <StatCell
              label="Sessões ativas"
              value={sessoesAtivas}
              hint={sessoesAtivas === 1 ? "atendimento aberto" : "atendimentos abertos"}
              icon={<Activity />}
              // âmbar, o mesmo tom que "Sessões ativas" tem na Visão geral. Uma
              // métrica com duas cores anula o código de cor: a pessoa deixa de
              // reconhecer o cartão pela cor e volta a ter que ler o rótulo.
              viz="amber"
            />
          </StatStrip>
        )}
      </div>

      {/* Toolbar: buscar | filtrar | visualizar — três blocos, nessa ordem. */}
      <Toolbar
        end={
          <Segmented<Visao>
            label="Modo de visualização"
            value={visao}
            onChange={setVisao}
            options={[
              { value: "list", icon: <List aria-hidden />, title: "Lista" },
              { value: "grid", icon: <LayoutGrid aria-hidden />, title: "Grade" },
              { value: "grouped", icon: <FolderTree aria-hidden />, title: "Agrupar por cliente" },
            ]}
          />
        }
      >
        <SearchField
          className="w-full min-w-[220px] sm:w-[320px]"
          value={busca}
          onValueChange={setBusca}
          placeholder="Buscar por ID, alias, cliente ou CNPJ…"
          aria-label="Buscar dispositivos"
        />

        {isSuper && (
          <Select
            selectSize="sm"
            aria-label="Filtrar por empresa"
            className="w-[190px]"
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

        <FiltroMarcadores selecionados={marcadores} onChange={setMarcadores} />

        <ToolbarDivider />

        <Switch
          id="so-favoritos"
          checked={soFavoritos}
          onCheckedChange={setSoFavoritos}
          label="Só favoritos"
          icon={<Star className="size-3.5" aria-hidden />}
        />
        <Switch
          id="mostrar-inativos"
          checked={mostrarInativos}
          onCheckedChange={setMostrarInativos}
          label="Mostrar inativos"
        />
      </Toolbar>

      <Panel flush>
        <PanelHeader
          title="Address book"
          description={
            carregando
              ? "Carregando…"
              : `${filtrados.length} de ${base.length} dispositivo${base.length === 1 ? "" : "s"}`
          }
          icon={<Monitor aria-hidden />}
          actions={
            filtrosAtivos ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setBusca("");
                  setSoFavoritos(false);
                  setMarcadores(new Set());
                  setEmpresa("all");
                }}
              >
                <X aria-hidden />
                Limpar filtros
              </Button>
            ) : null
          }
        />

        {erro ? (
          <ErrorState onRetry={() => undefined} />
        ) : visao === "list" ? (
          <TableWrap className="rounded-none border-x-0 border-b-0" minWidth={920}>
            <Table>
              <THead>
                <TR>
                  <TH className="w-10" />
                  <TH>Computador</TH>
                  <TH>Cliente</TH>
                  <TH>Sistema</TH>
                  {isSuper && <TH>Empresa</TH>}
                  <TH>Situação</TH>
                  {metered && <TH>Consumo</TH>}
                  <TH align="right">Ações</TH>
                </TR>
              </THead>
              <TBody>
                {carregando && <SkeletonRows rows={6} cols={colunas} />}
                {!carregando && filtrados.length === 0 && (
                  <tr>
                    <td colSpan={colunas} className="border-b-0">
                      <VazioDispositivos
                        filtros={filtrosAtivos}
                        onAdicionar={() => setAdicionando(true)}
                      />
                    </td>
                  </tr>
                )}
                {!carregando &&
                  filtrados.map((d) => (
                    <LinhaDispositivo
                      key={d.id}
                      d={d}
                      isSuper={isSuper}
                      metered={metered}
                      agora={agora}
                      conectando={conectando === d.id}
                      onConectar={() => conectar(d)}
                      onEditar={() => setEditando(d)}
                      onRedefinir={() => setConfirmarRedefinir(d)}
                      onInativar={() => setConfirmarInativar(d)}
                    />
                  ))}
              </TBody>
            </Table>
          </TableWrap>
        ) : visao === "grid" ? (
          <div className="p-5">
            {carregando ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="af-skeleton h-[186px] rounded-xl" />
                ))}
              </div>
            ) : filtrados.length === 0 ? (
              <VazioDispositivos filtros={filtrosAtivos} onAdicionar={() => setAdicionando(true)} />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {filtrados.map((d) => (
                  <CardDispositivo
                    key={d.id}
                    d={d}
                    isSuper={isSuper}
                    metered={metered}
                    agora={agora}
                    conectando={conectando === d.id}
                    onConectar={() => conectar(d)}
                    onEditar={() => setEditando(d)}
                    onRedefinir={() => setConfirmarRedefinir(d)}
                    onInativar={() => setConfirmarInativar(d)}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2.5 p-5">
            {carregando ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="af-skeleton h-14 rounded-lg" />
              ))
            ) : grupos.length === 0 ? (
              <VazioDispositivos filtros={filtrosAtivos} onAdicionar={() => setAdicionando(true)} />
            ) : (
              grupos.map((g) => {
                const aberto = gruposAbertos.has(g.label);
                return (
                  <div
                    key={g.label}
                    className="overflow-hidden rounded-lg border border-line-subtle"
                  >
                    <button
                      type="button"
                      aria-expanded={aberto}
                      onClick={() =>
                        setGruposAbertos((prev) => {
                          const n = new Set(prev);
                          if (n.has(g.label)) n.delete(g.label);
                          else n.add(g.label);
                          return n;
                        })
                      }
                      className={cx(
                        "flex w-full flex-wrap items-center gap-x-4 gap-y-2 bg-surface-2 px-4 py-3 text-left",
                        "transition-colors duration-[var(--af-dur-hover)] hover:bg-surface-hover",
                      )}
                    >
                      {aberto ? (
                        <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden />
                      ) : (
                        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-medium text-ink">
                          {g.label}
                        </span>
                        {g.documento?.documento ? (
                          <span className="af-num block text-[11px] text-muted">
                            {documento(g.documento.documento, g.documento.tipo)}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-[12px] text-muted">
                        {g.devices.length} dispositivo{g.devices.length === 1 ? "" : "s"}
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="af-num flex items-center gap-1.5 text-[12.5px] text-ink-2">
                          <Dot tone="success" />
                          {g.online}
                        </span>
                        <span className="af-num flex items-center gap-1.5 text-[12.5px] text-ink-2">
                          <Dot tone="primary" />
                          {g.atendimento}
                        </span>
                        <span className="af-num flex items-center gap-1.5 text-[12.5px] text-ink-2">
                          <Dot tone="neutral" />
                          {g.offline}
                        </span>
                      </span>
                      <span className="af-num ml-auto text-[12px] text-muted">
                        últ. acesso {tempoRelativo(g.ultimo)}
                      </span>
                    </button>
                    {aberto && (
                      <TableWrap className="rounded-none border-x-0 border-b-0" minWidth={820}>
                        <Table>
                          <TBody>
                            {g.devices.map((d) => (
                              <LinhaDispositivo
                                key={d.id}
                                d={d}
                                isSuper={isSuper}
                                metered={metered}
                                agora={agora}
                                semCliente
                                conectando={conectando === d.id}
                                onConectar={() => conectar(d)}
                                onEditar={() => setEditando(d)}
                                onRedefinir={() => setConfirmarRedefinir(d)}
                                onInativar={() => setConfirmarInativar(d)}
                              />
                            ))}
                          </TBody>
                        </Table>
                      </TableWrap>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {!erro && !carregando && filtrados.length > 0 && (
          <PanelFooter>
            <span>
              Exibindo {filtrados.length} de {base.length} dispositivos
            </span>
            <span className="af-num">Limite da consulta: 500 registros</span>
          </PanelFooter>
        )}
      </Panel>

      {/* ------------------------------- Modais ------------------------------- */}

      <ModalConectar dispositivo={conexao} onClose={() => setConexao(null)} />

      <ModalEscolhaFonte
        dispositivo={escolha}
        onClose={() => setEscolha(null)}
        onEscolher={(d) => {
          setEscolha(null);
          setConexao(d);
        }}
      />

      <ModalAdicionar open={adicionando} onClose={() => setAdicionando(false)} isSuper={isSuper} />

      <ModalEditar dispositivo={editando} onClose={() => setEditando(null)} />

      <ConfirmDialog
        open={confirmarInativar !== null}
        onOpenChange={(v) => !v && setConfirmarInativar(null)}
        title="Inativar dispositivo?"
        description="O dispositivo ficará indisponível para novas conexões. Você pode reativá-lo depois."
        confirmLabel="Inativar"
        destructive
        onConfirm={() => undefined}
      />

      <ConfirmDialog
        open={confirmarRedefinir !== null}
        onOpenChange={(v) => !v && setConfirmarRedefinir(null)}
        title="Redefinir senha de acesso?"
        description="Uma nova senha permanente será gerada. A senha atual deixa de funcionar até você aplicá-la como senha permanente no computador."
        confirmLabel="Redefinir"
        onConfirm={() => setSenhaRedefinida(confirmarRedefinir)}
      />

      <ModalSenhaRedefinida
        dispositivo={senhaRedefinida}
        onClose={() => setSenhaRedefinida(null)}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Linha da tabela                                                             */
/* -------------------------------------------------------------------------- */

type AcoesProps = {
  d: Dispositivo;
  isSuper: boolean;
  metered: boolean;
  agora: number;
  conectando: boolean;
  onConectar: () => void;
  onEditar: () => void;
  onRedefinir: () => void;
  onInativar: () => void;
};

function LinhaDispositivo({ semCliente = false, ...p }: AcoesProps & { semCliente?: boolean }) {
  const { d } = p;
  return (
    <TR muted={!d.ativo}>
      <TD className="pr-0">
        <BotaoFavorito favorito={d.favorito} />
      </TD>
      <TD>
        <div className="flex items-center gap-2.5">
          <DeviceGlyph status={d.status} />
          <div className="min-w-0">
            <span className="block truncate text-[13.5px] font-medium text-ink">
              {d.alias ?? "— sem alias —"}
            </span>
            <span className="af-num block font-mono text-[11.5px] text-muted">{d.rustdesk_id}</span>
            {d.marcadores.length > 0 && (
              <span className="mt-1 flex flex-wrap gap-1">
                {d.marcadores.map((m) => (
                  <MarkerChip key={m} id={m} />
                ))}
              </span>
            )}
          </div>
        </div>
      </TD>
      {!semCliente && (
        <TD>
          {d.cliente ? (
            <div className="min-w-0">
              <Truncate className="text-[13px] text-ink-2">{d.cliente.nome}</Truncate>
              {d.cliente.documento ? (
                <span className="af-num block text-[11px] text-muted">
                  {documento(d.cliente.documento, d.cliente.tipo)}
                </span>
              ) : null}
            </div>
          ) : (
            <span className="text-muted">—</span>
          )}
        </TD>
      )}
      <TD className="text-[12.5px] text-muted">{d.os ?? "—"}</TD>
      {p.isSuper && <TD className="text-[12.5px]">{d.empresa}</TD>}
      <TD>
        <DeviceStatus status={d.status} lastOnline={d.last_online} />
      </TD>
      {p.metered && (
        <TD>
          <ConsumoBadge consumo={d.consumo} agora={p.agora} />
        </TD>
      )}
      <TD align="right">
        <div className="flex items-center justify-end gap-1.5">
          <Button
            size="sm"
            loading={p.conectando}
            disabled={!d.ativo}
            onClick={p.onConectar}
            title={d.ativo ? undefined : "Dispositivo inativo — reative para conectar"}
          >
            {!p.conectando && <Monitor aria-hidden />}
            {p.conectando ? "Conectando…" : "Conectar"}
          </Button>
          <MenuAcoes
            d={d}
            onEditar={p.onEditar}
            onRedefinir={p.onRedefinir}
            onInativar={p.onInativar}
          />
        </div>
      </TD>
    </TR>
  );
}

function BotaoFavorito({ favorito }: { favorito: boolean }) {
  const [on, setOn] = React.useState(favorito);
  return (
    <IconButton
      size="sm"
      label={on ? "Remover dos favoritos" : "Adicionar aos favoritos"}
      onClick={() => setOn((v) => !v)}
      className={on ? "text-warning" : "text-muted"}
    >
      <Star className={on ? "fill-current" : ""} aria-hidden />
    </IconButton>
  );
}

function MenuAcoes({
  d,
  onEditar,
  onRedefinir,
  onInativar,
}: {
  d: Dispositivo;
  onEditar: () => void;
  onRedefinir: () => void;
  onInativar: () => void;
}) {
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <IconButton size="sm" label={`Mais ações para ${d.alias ?? d.rustdesk_id}`}>
          <MoreHorizontal aria-hidden />
        </IconButton>
      </DropdownTrigger>
      <DropdownContent>
        <DropdownItem icon={<Copy />}>Copiar ID</DropdownItem>
        <DropdownItem icon={<Pencil />} onSelect={onEditar}>
          Editar
        </DropdownItem>
        <DropdownSeparator />
        <DropdownItem icon={<KeyRound />} onSelect={onRedefinir}>
          Redefinir senha
        </DropdownItem>
        {d.ativo ? (
          <DropdownItem icon={<PowerOff />} destructive onSelect={onInativar}>
            Inativar
          </DropdownItem>
        ) : (
          <DropdownItem icon={<Power />}>Reativar</DropdownItem>
        )}
      </DropdownContent>
    </Dropdown>
  );
}

/* -------------------------------------------------------------------------- */
/* Card (visão em grade)                                                       */
/* -------------------------------------------------------------------------- */

function CardDispositivo(p: AcoesProps) {
  const { d } = p;
  return (
    <article
      className={cx(
        "af-panel-2 flex flex-col gap-3 rounded-xl border border-line-subtle bg-surface-2 p-4",
        "transition-colors duration-[var(--af-dur-hover)] hover:border-line hover:bg-surface-hover/40",
        !d.ativo && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <DeviceGlyph status={d.status} size="lg" />
        <BotaoFavorito favorito={d.favorito} />
      </div>

      <div className="min-w-0">
        <h3 className="truncate text-[14px] font-medium text-ink">{d.alias ?? "— sem alias —"}</h3>
        <p className="af-num font-mono text-[11.5px] text-muted">{d.rustdesk_id}</p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <DeviceStatus status={d.status} lastOnline={d.last_online} />
        {p.metered && d.consumo ? <ConsumoBadge consumo={d.consumo} agora={p.agora} /> : null}
        {d.marcadores.map((m) => (
          <MarkerChip key={m} id={m} />
        ))}
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line-subtle pt-3 text-[12px]">
        <div className="min-w-0">
          <dt className="af-eyebrow">Cliente</dt>
          <dd className="truncate text-ink-2">{d.cliente?.nome ?? "—"}</dd>
        </div>
        <div className="min-w-0">
          <dt className="af-eyebrow">Sistema</dt>
          <dd className="truncate text-ink-2">{d.os ?? "—"}</dd>
        </div>
        <div className="min-w-0">
          <dt className="af-eyebrow">CNPJ / CPF</dt>
          <dd className="af-num truncate text-ink-2">
            {documento(d.cliente?.documento ?? null, d.cliente?.tipo ?? null) ?? "—"}
          </dd>
        </div>
        {p.isSuper && (
          <div className="min-w-0">
            <dt className="af-eyebrow">Empresa</dt>
            <dd className="truncate text-ink-2">{d.empresa}</dd>
          </div>
        )}
      </dl>

      <div className="flex items-center gap-1.5 pt-0.5">
        <Button size="sm" block loading={p.conectando} disabled={!d.ativo} onClick={p.onConectar}>
          {!p.conectando && <Monitor aria-hidden />}
          {p.conectando ? "Conectando…" : "Conectar"}
        </Button>
        <MenuAcoes
          d={d}
          onEditar={p.onEditar}
          onRedefinir={p.onRedefinir}
          onInativar={p.onInativar}
        />
      </div>
    </article>
  );
}

/* -------------------------------------------------------------------------- */

function VazioDispositivos({
  filtros,
  onAdicionar,
}: {
  filtros: boolean;
  onAdicionar: () => void;
}) {
  if (filtros) {
    return (
      <EmptyState
        icon={<Search aria-hidden />}
        title="Nenhum dispositivo bate com os filtros"
        description="Ajuste a busca, os marcadores ou desligue “só favoritos” para ver mais resultados."
      />
    );
  }
  return (
    <EmptyState
      icon={<Monitor aria-hidden />}
      title="Nenhum dispositivo cadastrado"
      description="Abra o AcessoFast no computador do cliente, copie o ID que aparece na tela do programa e cadastre aqui."
      action={
        <Button onClick={onAdicionar}>
          <Plus aria-hidden />
          Adicionar dispositivo
        </Button>
      }
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Filtro de marcadores                                                        */
/* -------------------------------------------------------------------------- */

function FiltroMarcadores({
  selecionados,
  onChange,
}: {
  selecionados: Set<string>;
  onChange: (s: Set<string>) => void;
}) {
  const [busca, setBusca] = React.useState("");
  const lista = MARCADORES.filter((m) =>
    m.label.toLowerCase().includes(busca.trim().toLowerCase()),
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm">
          <Tag aria-hidden />
          Marcadores
          {selecionados.size > 0 && (
            <Badge tone="primary" className="af-num px-1.5 py-0">
              {selecionados.size}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <div className="border-b border-line-subtle p-2">
          <Input
            inputSize="sm"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar marcador…"
            aria-label="Buscar marcador"
            leading={<Search aria-hidden />}
          />
        </div>
        <ul className="max-h-[248px] overflow-y-auto p-1">
          {lista.length === 0 && (
            <li className="px-2.5 py-6 text-center text-[12.5px] text-muted">
              Nenhum marcador encontrado.
            </li>
          )}
          {lista.map((m) => {
            const on = selecionados.has(m.id);
            return (
              <li key={m.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => {
                    const n = new Set(selecionados);
                    if (on) n.delete(m.id);
                    else n.add(m.id);
                    onChange(n);
                  }}
                  className={cx(
                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px]",
                    "transition-colors duration-[var(--af-dur-hover)]",
                    on
                      ? "bg-primary-soft text-ink"
                      : "text-ink-2 hover:bg-surface-hover hover:text-ink",
                  )}
                >
                  <MarkerDot cor={m.cor} />
                  <span className="flex-1 truncate text-left">{m.label}</span>
                  {on && <Check className="size-4 shrink-0 text-primary-light" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
        {selecionados.size > 0 && (
          <div className="border-t border-line-subtle p-1">
            <button
              type="button"
              onClick={() => onChange(new Set())}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[12.5px] text-muted transition-colors duration-[var(--af-dur-hover)] hover:bg-surface-hover hover:text-ink"
            >
              <X className="size-3.5" aria-hidden />
              Limpar filtro
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/* -------------------------------------------------------------------------- */
/* Modais                                                                      */
/* -------------------------------------------------------------------------- */

function CampoCopiavel({
  label,
  value,
  id,
  mono = true,
}: {
  label: string;
  value: string;
  id: string;
  mono?: boolean;
}) {
  const [copiado, setCopiado] = React.useState(false);
  return (
    <Field label={label} htmlFor={id}>
      <div className="flex items-center gap-2">
        <Input id={id} readOnly value={value} mono={mono} />
        <Button
          variant="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            setCopiado(true);
            setTimeout(() => setCopiado(false), 1800);
          }}
        >
          {copiado ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copiado ? "Copiado" : "Copiar"}
        </Button>
      </div>
    </Field>
  );
}

function ModalConectar({
  dispositivo,
  onClose,
}: {
  dispositivo: Dispositivo | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={dispositivo !== null}
      onOpenChange={(v) => !v && onClose()}
      title="Conectar"
      description="Ao abrir a conexão, o AcessoFast vai pedir a senha abaixo. Cole-a para conectar."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
          <Button>
            <ExternalLink aria-hidden />
            Abrir conexão
          </Button>
        </>
      }
    >
      {dispositivo && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-line-subtle bg-surface-2 px-3.5 py-3">
            <DeviceGlyph status={dispositivo.status} />
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-medium text-ink">
                {dispositivo.alias ?? dispositivo.rustdesk_id}
              </p>
              <p className="truncate text-[12px] text-muted">
                {dispositivo.cliente?.nome ?? "sem cliente"} ·{" "}
                {dispositivo.os ?? "sistema não informado"}
              </p>
            </div>
            <span className="ml-auto shrink-0">
              <DeviceStatus status={dispositivo.status} lastOnline={dispositivo.last_online} />
            </span>
          </div>

          <CampoCopiavel id="conn-id" label="ID AcessoFast" value={dispositivo.rustdesk_id} />
          <CampoCopiavel id="conn-senha" label="Senha" value={SENHA_EXEMPLO} />
        </div>
      )}
    </Modal>
  );
}

function ModalEscolhaFonte({
  dispositivo,
  onClose,
  onEscolher,
}: {
  dispositivo: Dispositivo | null;
  onClose: () => void;
  onEscolher: (d: Dispositivo) => void;
}) {
  return (
    <Modal
      open={dispositivo !== null}
      onOpenChange={(v) => !v && onClose()}
      title="Como deseja conectar?"
      description="Esta é uma conexão individual. O acesso gratuito concede até 2 horas conectado; se o atendimento pode passar disso, use um crédito (sem esse limite)."
      footer={
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
      }
    >
      <div className="grid gap-2.5">
        <OpcaoFonte
          titulo="Usar acesso gratuito"
          detalhe={`${CARTEIRA.gratisRestante} restantes hoje · até 2h conectado`}
          icone={<Gift aria-hidden />}
          onClick={() => dispositivo && onEscolher(dispositivo)}
        />
        <OpcaoFonte
          titulo="Gastar 1 crédito"
          detalhe={`${CARTEIRA.creditos} disponíveis · sem limite de 2h`}
          icone={<Coins aria-hidden />}
          destaque
          onClick={() => dispositivo && onEscolher(dispositivo)}
        />
      </div>
    </Modal>
  );
}

function OpcaoFonte({
  titulo,
  detalhe,
  icone,
  destaque = false,
  onClick,
}: {
  titulo: string;
  detalhe: string;
  icone: React.ReactNode;
  destaque?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex items-center gap-3 rounded-lg border px-4 py-3 text-left",
        "transition-colors duration-[var(--af-dur-hover)]",
        destaque
          ? "border-[color-mix(in_oklab,var(--af-primary)_38%,transparent)] bg-primary-soft hover:bg-primary-soft-hover"
          : "border-line bg-surface-2 hover:bg-surface-hover",
      )}
    >
      <span
        className={cx(
          "grid size-9 shrink-0 place-items-center rounded-md [&_svg]:size-4",
          destaque ? "bg-primary-soft-hover text-primary-light" : "bg-surface-hover text-muted",
        )}
      >
        {icone}
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium text-ink">{titulo}</span>
        <span className="block text-[12px] text-muted">{detalhe}</span>
      </span>
      <ChevronRight className="ml-auto size-4 shrink-0 text-muted" aria-hidden />
    </button>
  );
}

function ModalAdicionar({
  open,
  onClose,
  isSuper,
}: {
  open: boolean;
  onClose: () => void;
  isSuper: boolean;
}) {
  const [etapa, setEtapa] = React.useState<"form" | "senha">("form");
  const [id, setId] = React.useState("");
  const [alias, setAlias] = React.useState("");
  const [cliente, setCliente] = React.useState("");
  const [marcados, setMarcados] = React.useState<Set<string>>(new Set());
  const [erroId, setErroId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setEtapa("form");
      setId("");
      setAlias("");
      setCliente("");
      setMarcados(new Set());
      setErroId(null);
    }
  }, [open]);

  if (etapa === "senha") {
    return (
      <Modal
        open={open}
        onOpenChange={(v) => !v && onClose()}
        title="Senha gerada"
        description="Configure esta senha como senha permanente (unattended) no client AcessoFast deste endpoint. Ela fica guardada cifrada e pode ser recuperada depois pelo botão Conectar."
        footer={
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
        }
      >
        <div className="space-y-4">
          <CampoCopiavel id="nova-senha" label="Senha permanente" value={SENHA_EXEMPLO} />
          <Alert tone="warning" title="Aplique antes de fechar">
            Esta senha só aparece uma vez nesta tela. Se perdê-la, use “Redefinir senha” na lista de
            dispositivos.
          </Alert>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Adicionar dispositivo"
      description="Digite o ID que aparece no AcessoFast do computador do cliente. O computador precisa ter o AcessoFast instalado e estar online."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              if (!id.replace(/\D/g, "")) {
                setErroId("Informe um AcessoFast ID válido — de 6 a 12 dígitos.");
                return;
              }
              setEtapa("senha");
            }}
          >
            Cadastrar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="AcessoFast ID"
          htmlFor="add-id"
          required
          error={erroId}
          hint={erroId ? undefined : "Somente dígitos, como aparece na tela do programa."}
        >
          <Input
            id="add-id"
            value={id}
            invalid={!!erroId}
            mono
            placeholder="418 902 337"
            onChange={(e) => {
              setId(e.target.value);
              setErroId(null);
            }}
          />
        </Field>

        <Field label="Alias" htmlFor="add-alias" hint="Como a máquina aparece na sua lista.">
          <Input
            id="add-alias"
            value={alias}
            placeholder="PDV-CAIXA-01"
            onChange={(e) => setAlias(e.target.value)}
          />
        </Field>

        <Field label="Cliente" htmlFor="add-cliente">
          <Select id="add-cliente" value={cliente} onChange={(e) => setCliente(e.target.value)}>
            <option value="">Sem cliente</option>
            {CLIENTES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Marcadores" htmlFor="add-marcadores">
          <SeletorMarcadores selecionados={marcados} onChange={setMarcados} />
        </Field>

        {isSuper && (
          <Field label="Tenant" htmlFor="add-tenant" required>
            <Select id="add-tenant" defaultValue="">
              <option value="" disabled>
                Selecione um tenant
              </option>
              {EMPRESAS_SELECT.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </Modal>
  );
}

function SeletorMarcadores({
  selecionados,
  onChange,
}: {
  selecionados: Set<string>;
  onChange: (s: Set<string>) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 rounded-md border border-line bg-surface-2 p-2">
      {MARCADORES.map((m) => {
        const on = selecionados.has(m.id);
        return (
          <button
            key={m.id}
            type="button"
            aria-pressed={on}
            onClick={() => {
              const n = new Set(selecionados);
              if (on) n.delete(m.id);
              else n.add(m.id);
              onChange(n);
            }}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px]",
              "transition-colors duration-[var(--af-dur-hover)]",
              on
                ? "border-[color-mix(in_oklab,var(--af-primary)_36%,transparent)] bg-primary-soft text-ink"
                : "border-line-subtle bg-surface text-muted hover:bg-surface-hover hover:text-ink",
            )}
          >
            <MarkerDot cor={m.cor} />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

function ModalEditar({
  dispositivo,
  onClose,
}: {
  dispositivo: Dispositivo | null;
  onClose: () => void;
}) {
  const [alias, setAlias] = React.useState("");
  const [so, setSo] = React.useState("");
  const [cliente, setCliente] = React.useState("");
  const [marcados, setMarcados] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    if (dispositivo) {
      setAlias(dispositivo.alias ?? "");
      setSo(dispositivo.os ?? "");
      setCliente(CLIENTES.find((c) => c.nome === dispositivo.cliente?.nome)?.id ?? "");
      setMarcados(new Set(dispositivo.marcadores));
    }
  }, [dispositivo]);

  return (
    <Modal
      open={dispositivo !== null}
      onOpenChange={(v) => !v && onClose()}
      title="Editar dispositivo"
      description="Atualize alias, cliente e sistema operacional. O ID AcessoFast e a senha não são alterados aqui."
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
        <Field label="Alias" htmlFor="edit-alias">
          <Input id="edit-alias" value={alias} onChange={(e) => setAlias(e.target.value)} />
        </Field>
        <Field label="Cliente" htmlFor="edit-cliente">
          <Select id="edit-cliente" value={cliente} onChange={(e) => setCliente(e.target.value)}>
            <option value="">Sem cliente</option>
            {CLIENTES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Marcadores" htmlFor="edit-marcadores">
          <SeletorMarcadores selecionados={marcados} onChange={setMarcados} />
        </Field>
        <Field label="Sistema operacional" htmlFor="edit-so">
          <Input id="edit-so" value={so} onChange={(e) => setSo(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function ModalSenhaRedefinida({
  dispositivo,
  onClose,
}: {
  dispositivo: Dispositivo | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={dispositivo !== null}
      onOpenChange={(v) => !v && onClose()}
      title="Nova senha gerada"
      description="Aplique esta senha como senha permanente (unattended) no client AcessoFast deste computador. A senha anterior não funciona mais."
      footer={
        <Button variant="secondary" onClick={onClose}>
          Fechar
        </Button>
      }
    >
      <div className="space-y-4">
        {dispositivo && (
          <CampoCopiavel id="redef-id" label="ID AcessoFast" value={dispositivo.rustdesk_id} />
        )}
        <CampoCopiavel id="redef-senha" label="Nova senha" value={SENHA_EXEMPLO} />
        <Alert tone="warning" title="A senha anterior deixou de funcionar">
          Enquanto a nova senha não for aplicada no computador, o acesso não supervisionado fica
          indisponível para esse endpoint.
        </Alert>
      </div>
    </Modal>
  );
}
