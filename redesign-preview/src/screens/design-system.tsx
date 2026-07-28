import * as React from "react";
import {
  Activity,
  Coins,
  Copy,
  Cpu,
  Monitor,
  MoreHorizontal,
  Plus,
  Radio,
  Trash2,
  Users,
} from "lucide-react";
import { VizIcon, type VizTone } from "@preview/components/ui/viz";
import { Button, IconButton } from "@preview/components/ui/button";
import { Badge, Dot, StatusBadge } from "@preview/components/ui/badge";
import { Panel, PanelHeader, PanelBody } from "@preview/components/ui/panel";
import {
  Checkbox,
  Field,
  Input,
  RadioGroup,
  SearchField,
  Select,
  Switch,
  Textarea,
} from "@preview/components/ui/field";
import {
  ConfirmDialog,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
  DropdownTrigger,
  Modal,
  Tooltip,
} from "@preview/components/ui/overlay";
import { PageHeader, Section, Segmented } from "@preview/components/ui/page";
import { Alert, EmptyState, ErrorState, Progress, Skeleton } from "@preview/components/ui/states";
import { Table, TBody, TD, TH, THead, TR, TableWrap } from "@preview/components/ui/table";

/**
 * Referência do design system — página exclusiva do preview.
 * Não é uma tela do produto: existe para documentar tokens, componentes e
 * estados em um lugar só, e servir de checklist na hora de aplicar o redesign.
 */
export function DesignSystemScreen() {
  const [modal, setModal] = React.useState(false);
  const [confirma, setConfirma] = React.useState(false);
  const [sw, setSw] = React.useState(true);
  const [cb, setCb] = React.useState(true);
  const [radio, setRadio] = React.useState("free");
  const [seg, setSeg] = React.useState("a");
  const [busca, setBusca] = React.useState("");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Design system"
        description="Referência do preview: tokens, componentes e estados. Esta página não existe no app real — é material de apoio para a aplicação do redesign."
      />

      <Section title="Superfícies" description="Profundidade vem da superfície, não da sombra.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
          {[
            ["--af-bg", "Fundo"],
            ["--af-bg-secondary", "Fundo 2"],
            ["--af-sidebar", "Sidebar"],
            ["--af-surface", "Painel"],
            ["--af-surface-2", "Painel 2"],
            ["--af-surface-raised", "Elevada"],
            ["--af-surface-hover", "Hover"],
          ].map(([token, nome]) => (
            <div key={token} className="overflow-hidden rounded-lg border border-line-subtle">
              <div className="h-14 w-full" style={{ background: `var(${token})` }} />
              <div className="bg-surface px-2.5 py-2">
                <p className="text-[12px] text-ink">{nome}</p>
                <p className="font-mono text-[10.5px] text-muted">{token}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Cores semânticas" description="Nunca usadas isoladas — sempre com rótulo.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {[
            ["--af-primary", "Primária"],
            ["--af-primary-light", "Primária clara"],
            ["--af-success", "Sucesso"],
            ["--af-warning", "Aviso"],
            ["--af-danger", "Erro"],
            ["--af-info", "Informação"],
          ].map(([token, nome]) => (
            <div key={token} className="overflow-hidden rounded-lg border border-line-subtle">
              <div className="h-14 w-full" style={{ background: `var(${token})` }} />
              <div className="bg-surface px-2.5 py-2">
                <p className="text-[12px] text-ink">{nome}</p>
                <p className="font-mono text-[10.5px] text-muted">{token}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Cores categóricas de métrica"
        description="Cada métrica tem cor fixa — é o que deixa CPU, disco ou créditos reconhecível antes de ler o rótulo. Nunca carrega significado sozinha: o rótulo está sempre junto."
      >
        <Panel>
          <PanelBody className="flex flex-wrap gap-3">
            {(
              [
                ["blue", "Usuários", <Users key="u" aria-hidden />],
                ["emerald", "Dispositivos / rede", <Monitor key="d" aria-hidden />],
                ["amber", "Sessões ativas / disco", <Radio key="s" aria-hidden />],
                ["violet", "Sessões 24h / memória", <Activity key="a" aria-hidden />],
                ["cyan", "CPU / grátis hoje", <Cpu key="c" aria-hidden />],
                ["lime", "Créditos", <Coins key="cr" aria-hidden />],
              ] as Array<[VizTone, string, React.ReactNode]>
            ).map(([tone, uso, ico]) => (
              <div
                key={tone}
                className="flex min-w-[200px] flex-1 items-center gap-3 rounded-lg border border-line-subtle bg-surface-2 px-3.5 py-3"
              >
                <VizIcon tone={tone}>{ico}</VizIcon>
                <div className="min-w-0">
                  <p className="text-[12.5px] text-ink">{uso}</p>
                  <p className="font-mono text-[10.5px] text-muted">--af-viz-{tone}</p>
                </div>
              </div>
            ))}
          </PanelBody>
        </Panel>
      </Section>

      <Section title="Tipografia">
        <Panel>
          <PanelBody className="space-y-4">
            <p className="text-[26px] font-bold leading-tight tracking-[-0.02em] text-ink">
              Título de página · 26 / 700
            </p>
            <p className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
              Título de seção · 17 / 600
            </p>
            <p className="text-[15px] font-semibold text-ink">Título de painel · 15 / 600</p>
            <p className="text-[13.5px] text-ink-2">
              Texto padrão · 13,5 / 400 — corpo das tabelas, formulários e descrições.
            </p>
            <p className="text-[12.5px] text-muted">
              Texto auxiliar · 12,5 / 400 — dicas e metadados.
            </p>
            <p className="af-eyebrow">Label de categoria · 11 / 600 · caixa alta</p>
            <p className="af-num text-[22px] font-semibold text-ink">
              1.284 · 47,6% · 18,42 Mbps — numerais tabulares
            </p>
          </PanelBody>
        </Panel>
      </Section>

      <Section title="Botões" description="O destaque visual representa a prioridade real da ação.">
        <Panel>
          <PanelBody className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button>Ação principal</Button>
              <Button variant="secondary">Secundária</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">
                <Trash2 aria-hidden />
                Destrutiva
              </Button>
              <Button variant="link">Link inline</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm">Pequeno</Button>
              <Button size="md">Médio</Button>
              <Button size="lg">Grande</Button>
              <Button loading>Carregando</Button>
              <Button disabled>Desabilitado</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip content="Copiar ID do dispositivo">
                <IconButton label="Copiar ID">
                  <Copy aria-hidden />
                </IconButton>
              </Tooltip>
              <IconButton label="Mais ações" variant="secondary">
                <MoreHorizontal aria-hidden />
              </IconButton>
              <IconButton label="Adicionar" variant="primary">
                <Plus aria-hidden />
              </IconButton>
              <Segmented
                label="Exemplo"
                value={seg}
                onChange={setSeg}
                options={[
                  { value: "a", label: "Opção A", title: "Opção A" },
                  { value: "b", label: "Opção B", title: "Opção B" },
                ]}
              />
            </div>
          </PanelBody>
        </Panel>
      </Section>

      <Section title="Estados e badges">
        <Panel>
          <PanelBody className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="success">Online</StatusBadge>
            <StatusBadge tone="warning" pulse>
              Em atendimento
            </StatusBadge>
            <StatusBadge tone="neutral">Offline · há 6 h</StatusBadge>
            <StatusBadge tone="warning">Aguardando coletor</StatusBadge>
            <StatusBadge tone="danger">Falhou</StatusBadge>
            <Badge tone="info">override</Badge>
            <Badge tone="neutral">Técnico</Badge>
            <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
              <Dot tone="success" /> ponto isolado
            </span>
          </PanelBody>
        </Panel>
      </Section>

      <Section
        title="Campos de formulário"
        description="Padrão, foco, erro, sucesso, somente leitura e desabilitado."
      >
        <Panel>
          <PanelBody className="grid gap-5 md:grid-cols-2">
            <Field label="Padrão" htmlFor="ds-1" hint="Texto de apoio abaixo do campo.">
              <Input id="ds-1" placeholder="Digite algo" />
            </Field>
            <Field label="Com erro" htmlFor="ds-2" error="Informe um e-mail válido.">
              <Input id="ds-2" invalid defaultValue="nome@" />
            </Field>
            <Field label="Sucesso" htmlFor="ds-3" success="Documento validado.">
              <Input id="ds-3" valid defaultValue="18.452.399/0001-74" mono />
            </Field>
            <Field label="Somente leitura" htmlFor="ds-4">
              <Input id="ds-4" readOnly defaultValue="kR7-2xVq-9Tem" mono />
            </Field>
            <Field label="Desabilitado" htmlFor="ds-5">
              <Input id="ds-5" disabled defaultValue="Indisponível" />
            </Field>
            <Field label="Seleção" htmlFor="ds-6">
              <Select id="ds-6" defaultValue="a">
                <option value="a">Todas as empresas</option>
                <option value="b">NorteTI Suporte</option>
              </Select>
            </Field>
            <Field label="Busca" htmlFor="ds-7">
              <SearchField value={busca} onValueChange={setBusca} placeholder="Buscar…" />
            </Field>
            <Field label="Área de texto" htmlFor="ds-8">
              <Textarea id="ds-8" placeholder="Observações" />
            </Field>
            <div className="space-y-3">
              <Switch id="ds-sw" checked={sw} onCheckedChange={setSw} label="Mostrar inativos" />
              <Checkbox id="ds-cb" checked={cb} onCheckedChange={setCb} label="Manter conectado" />
              <RadioGroup
                name="ds-radio"
                value={radio}
                onValueChange={setRadio}
                options={[
                  { value: "free", label: "Acesso gratuito", hint: "até 2h conectado" },
                  { value: "credit", label: "Gastar 1 crédito", hint: "sem limite de 2h" },
                ]}
              />
            </div>
          </PanelBody>
        </Panel>
      </Section>

      <Section title="Sobreposições">
        <Panel>
          <PanelBody className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => setModal(true)}>
              Abrir modal
            </Button>
            <Button variant="secondary" onClick={() => setConfirma(true)}>
              Abrir confirmação destrutiva
            </Button>
            <Dropdown>
              <DropdownTrigger asChild>
                <Button variant="secondary">
                  Menu de ações
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownTrigger>
              <DropdownContent align="start">
                <DropdownItem icon={<Copy />}>Copiar ID</DropdownItem>
                <DropdownItem icon={<Monitor />}>Conectar</DropdownItem>
                <DropdownSeparator />
                <DropdownItem icon={<Trash2 />} destructive>
                  Inativar
                </DropdownItem>
              </DropdownContent>
            </Dropdown>
          </PanelBody>
        </Panel>
      </Section>

      <Section title="Feedback do sistema">
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel>
            <PanelHeader title="Faixas de aviso" />
            <PanelBody className="space-y-2.5">
              <Alert tone="info" title="Informação">
                O coletor envia uma amostra por minuto.
              </Alert>
              <Alert tone="warning" title="Atenção">
                A última amostra chegou há 4 minutos.
              </Alert>
              <Alert tone="danger" title="Erro">
                Não foi possível falar com o provedor de pagamento.
              </Alert>
              <Alert tone="success" title="Pronto">
                Plano e limites atualizados.
              </Alert>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Progresso e carregamento" />
            <PanelBody className="space-y-4">
              <div className="space-y-1.5">
                <p className="text-[12.5px] text-muted">RAM · 47,6%</p>
                <Progress value={47.6} label="Memória" />
              </div>
              <div className="space-y-1.5">
                <p className="text-[12.5px] text-muted">Disco · 88% (atenção)</p>
                <Progress value={88} tone="danger" label="Disco" />
              </div>
              <div className="space-y-2 pt-1">
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-4/5" />
                <Skeleton className="h-3.5 w-2/5" />
              </div>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Estado vazio" />
            <PanelBody>
              <EmptyState
                compact
                icon={<Monitor aria-hidden />}
                title="Nenhum dispositivo cadastrado"
                description="Cadastre o primeiro endpoint para começar a atender."
                action={<Button size="sm">Adicionar dispositivo</Button>}
              />
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Estado de erro" />
            <PanelBody>
              <ErrorState compact onRetry={() => undefined} />
            </PanelBody>
          </Panel>
        </div>
      </Section>

      <Section
        title="Tabela"
        description="Cabeçalho fixo, divisores sutis, altura de linha por token."
      >
        <Panel flush>
          <TableWrap className="rounded-none border-0" minWidth={520}>
            <Table>
              <THead>
                <TR>
                  <TH>Coluna de texto</TH>
                  <TH>Estado</TH>
                  <TH align="right">Numérico</TH>
                  <TH align="right">Ações</TH>
                </TR>
              </THead>
              <TBody>
                {["Primeira linha", "Segunda linha", "Terceira linha"].map((t, i) => (
                  <TR key={t}>
                    <TD className="text-ink">{t}</TD>
                    <TD>
                      <StatusBadge tone={i === 0 ? "success" : i === 1 ? "primary" : "neutral"}>
                        {i === 0 ? "Online" : i === 1 ? "Em atendimento" : "Offline"}
                      </StatusBadge>
                    </TD>
                    <TD align="right" className="af-num">
                      {(1284 * (i + 1)).toLocaleString("pt-BR")}
                    </TD>
                    <TD align="right">
                      <Button size="sm" variant="ghost">
                        Editar
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </Panel>
      </Section>

      <Modal
        open={modal}
        onOpenChange={setModal}
        title="Título do modal"
        description="Descrição curta explicando o que a pessoa está prestes a fazer."
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(false)}>
              Cancelar
            </Button>
            <Button onClick={() => setModal(false)}>Confirmar</Button>
          </>
        }
      >
        <Field label="Campo dentro do modal" htmlFor="ds-modal-campo">
          <Input id="ds-modal-campo" placeholder="Digite algo" />
        </Field>
      </Modal>

      <ConfirmDialog
        open={confirma}
        onOpenChange={setConfirma}
        title="Inativar dispositivo?"
        description="O dispositivo ficará indisponível para novas conexões. Você pode reativá-lo depois."
        confirmLabel="Inativar"
        destructive
        onConfirm={() => undefined}
      />
    </div>
  );
}
