import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/stat-card";
import {
  History,
  ChevronDown,
  ChevronRight,
  Radio,
  Users,
  ShieldAlert,
  Search,
  X,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/auditoria")({
  head: () => ({
    meta: [{ title: "Auditoria — Acessofast" }, { name: "robots", content: "noindex" }],
  }),
  component: AuditoriaPage,
});

/**
 * Marcador que o session-ingest grava em `notes` quando a sessão nasce fora do
 * painel (o .exe conectando direto). É o único sinal de origem que existe hoje
 * no registro, e é por isso que a comparação é por prefixo e não por igualdade:
 * se amanhã o texto ganhar um sufixo, o filtro continua funcionando.
 */
const MARCA_EXTERNO = "Acesso externo";

const JANELAS = {
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  tudo: Number.POSITIVE_INFINITY,
} as const;
type Periodo = keyof typeof JANELAS;

const ROTULO_PERIODO: Record<Periodo, string> = {
  "24h": "últimas 24h",
  "7d": "últimos 7 dias",
  "30d": "últimos 30 dias",
  tudo: "todo o período",
};

const TODOS = "__todos__";

/** Teto de linhas por consulta. Quando é atingido, a tela diz — ver `noTeto`. */
const TETO = 500;

/**
 * Leitores de linha. Ficam no módulo, e não dentro do componente, porque são
 * funções puras da linha: dentro do componente seriam recriadas a cada render e
 * entrariam como dependência instável dos useMemo abaixo, invalidando o cache
 * em todo render — exatamente o oposto do que o memo existe para fazer.
 *
 * Os parâmetros são tipados pela forma, não pelo tipo da consulta, para não
 * precisarem do genérico do PostgREST.
 */
type ComTecnico = { profiles: { full_name: string | null } | null; technician_email: string | null };
type ComMaquina = { address_book: { alias: string | null; clients: { name: string } | null } | null };

/** Nome do técnico, com queda para e-mail quando o RLS esconde o perfil. */
const nomeTecnico = (l: ComTecnico) => l.profiles?.full_name?.trim() || l.technician_email || null;
const ehExterno = (l: { notes: string | null }) => (l.notes ?? "").startsWith(MARCA_EXTERNO);
const nomeMaquina = (l: ComMaquina) => l.address_book?.alias?.trim() || null;
const nomeCliente = (l: ComMaquina) => l.address_book?.clients?.name ?? null;

function AuditoriaPage() {
  /**
   * O `select` embute técnico e máquina por chave estrangeira. As duas relações
   * precisam ser nomeadas pelo constraint (`!connection_logs_..._fkey`) porque
   * `connection_logs` aponta para `profiles` uma vez e para `address_book`
   * outra, e o PostgREST recusa o embed ambíguo sem o nome.
   *
   * `profiles` pode voltar null mesmo com technician_id preenchido: a policy
   * profiles_select só deixa super_admin e admin lerem perfis de terceiros, um
   * técnico enxerga apenas o próprio. Por isso o nome sempre cai de volta para
   * technician_email, que é coluna do próprio log e não depende de join.
   */
  const [view, setView] = useState<"grouped" | "flat">("flat");
  const [expandedRustdeskId, setExpandedRustdeskId] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>("7d");
  const [tecnico, setTecnico] = useState<string>(TODOS);
  const [origem, setOrigem] = useState<string>(TODOS);

  /**
   * O período vai para o servidor, não para o filtro em memória. Filtrar por
   * data no cliente sobre uma janela fixa de N linhas produz uma tela que
   * mente: ela mostra "últimos 30 dias" quando na verdade mostra os 30 dias
   * que couberam nas N linhas mais recentes. Com o corte no banco, o que
   * chega é o período inteiro — e o teto só aparece quando é atingido de fato.
   */
  const { data, isLoading } = useQuery({
    queryKey: ["connection_logs", periodo],
    queryFn: async () => {
      let q = supabase
        .from("connection_logs")
        .select(
          `id, rustdesk_id, technician_email, status, session_start, session_end,
           duration_seconds, technician_ip, notes,
           profiles!connection_logs_technician_id_fkey ( full_name ),
           address_book!connection_logs_address_book_id_fkey (
             alias, os, clients ( name )
           )`,
        )
        .order("session_start", { ascending: false })
        .limit(TETO);
      const janela = JANELAS[periodo];
      if (Number.isFinite(janela)) {
        q = q.gte("session_start", new Date(Date.now() - janela).toISOString());
      }
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  type LogRow = NonNullable<typeof data>[number];

  const tecnicos = useMemo(() => {
    const set = new Set<string>();
    for (const l of data ?? []) {
      const n = nomeTecnico(l);
      if (n) set.add(n);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [data]);

  // O período já veio recortado do banco; aqui só restam os filtros que não
  // existem como coluna (nome do técnico depende de join, origem depende de
  // texto em `notes`).
  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (data ?? []).filter((l) => {
      if (tecnico !== TODOS && nomeTecnico(l) !== tecnico) return false;
      if (origem !== TODOS) {
        const externo = ehExterno(l);
        if (origem === "externo" && !externo) return false;
        if (origem === "painel" && externo) return false;
      }
      if (!termo) return true;
      // Uma busca só: quem procura um acesso lembra do nome do técnico, do nome
      // da máquina ou do cliente — não do campo onde aquilo está guardado.
      return [
        nomeTecnico(l),
        nomeMaquina(l),
        nomeCliente(l),
        l.rustdesk_id,
        l.technician_ip as unknown as string,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(termo));
    });
  }, [data, tecnico, origem, busca]);

  /** Atingiu o teto: existe mais registro do que a tela está mostrando. */
  const noTeto = (data?.length ?? 0) >= TETO;

  const chips = [
    periodo !== "tudo" && {
      k: "periodo",
      label: `período: ${ROTULO_PERIODO[periodo]}`,
      limpar: () => setPeriodo("tudo"),
    },
    tecnico !== TODOS && {
      k: "tecnico",
      label: `técnico: ${tecnico}`,
      limpar: () => setTecnico(TODOS),
    },
    origem !== TODOS && {
      k: "origem",
      label: `origem: ${origem === "externo" ? "fora do painel" : "pelo painel"}`,
      limpar: () => setOrigem(TODOS),
    },
    busca.trim() !== "" && {
      k: "busca",
      label: `"${busca.trim()}"`,
      limpar: () => setBusca(""),
    },
  ].filter(Boolean) as Array<{ k: string; label: string; limpar: () => void }>;

  const limparTudo = () => {
    setPeriodo("tudo");
    setTecnico(TODOS);
    setOrigem(TODOS);
    setBusca("");
  };

  const ativas = filtradas.filter((l) => l.status === "active").length;
  const falhas = filtradas.filter((l) => l.status === "failed").length;
  const externas = filtradas.filter(ehExterno).length;
  const tecnicosNoPeriodo = new Set(filtradas.map(nomeTecnico).filter(Boolean)).size;

  const grupos = useMemo(() => {
    const map = new Map<string, LogRow[]>();
    for (const l of filtradas) {
      const arr = map.get(l.rustdesk_id) ?? [];
      arr.push(l);
      map.set(l.rustdesk_id, arr);
    }
    return Array.from(map.entries())
      .map(([rustdesk_id, sessoes]) => {
        const ordenadas = [...sessoes].sort(
          (a, b) => new Date(b.session_start).getTime() - new Date(a.session_start).getTime(),
        );
        const ultimo = ordenadas[0];
        return {
          rustdesk_id,
          ultimo,
          maquina: nomeMaquina(ultimo),
          cliente: nomeCliente(ultimo),
          tecnico: nomeTecnico(ultimo),
          acessos: ordenadas.filter((s) => s.status === "active" || s.status === "ended").length,
          sessoes: ordenadas,
        };
      })
      .sort(
        (a, b) =>
          new Date(b.ultimo.session_start).getTime() - new Date(a.ultimo.session_start).getTime(),
      );
  }, [filtradas]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Auditoria</h1>
        <p className="text-sm text-muted-foreground">
          Quem acessou qual máquina, quando e por qual caminho. Registro append-only — nenhum
          técnico apaga um log, nem você.
        </p>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Sessões no período"
          value={filtradas.length}
          icon={History}
          hint={noTeto ? `teto de ${TETO} — reduza o período` : ROTULO_PERIODO[periodo]}
          loading={isLoading}
          color="blue"
        />
        <StatCard
          title="Em andamento"
          value={ativas}
          icon={Radio}
          hint="Sessões abertas agora"
          loading={isLoading}
          color="amber"
        />
        <StatCard
          title="Técnicos"
          value={tecnicosNoPeriodo}
          icon={Users}
          hint="Distintos no período"
          loading={isLoading}
          color="emerald"
        />
        {/* Acesso iniciado fora do painel é o sinal que o administrador
            acompanhava em Monitoramento. Passou a morar aqui, junto do registro
            que permite investigar cada um. */}
        <StatCard
          title="Fora do painel"
          value={externas}
          icon={ShieldAlert}
          hint="Iniciadas pelo instalador"
          loading={isLoading}
          color="violet"
        />
      </div>

      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <History className="h-4 w-4 text-primary" />
                {view === "flat" ? "Sessões" : "Máquinas acessadas"}
              </CardTitle>
              <CardDescription>
                {isLoading
                  ? "Carregando…"
                  : view === "flat"
                    ? `${filtradas.length} registro(s)`
                    : `${grupos.length} máquina(s)`}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={view === "flat" ? "default" : "outline"}
                onClick={() => setView("flat")}
              >
                Todas as sessões
              </Button>
              <Button
                size="sm"
                variant={view === "grouped" ? "default" : "outline"}
                onClick={() => setView("grouped")}
              >
                Por máquina
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-[320px]">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Técnico, máquina, cliente, IP ou ID…"
                aria-label="Buscar na auditoria"
                className="pl-8"
              />
            </div>
            <Select value={periodo} onValueChange={(v) => setPeriodo(v as Periodo)}>
              <SelectTrigger className="w-[170px]" aria-label="Período">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">Últimas 24h</SelectItem>
                <SelectItem value="7d">Últimos 7 dias</SelectItem>
                <SelectItem value="30d">Últimos 30 dias</SelectItem>
                <SelectItem value="tudo">Todo o período</SelectItem>
              </SelectContent>
            </Select>
            <Select value={tecnico} onValueChange={setTecnico}>
              <SelectTrigger className="w-[190px]" aria-label="Técnico">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos os técnicos</SelectItem>
                {tecnicos.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={origem} onValueChange={setOrigem}>
              <SelectTrigger className="w-[170px]" aria-label="Origem do acesso">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Toda origem</SelectItem>
                <SelectItem value="painel">Pelo painel</SelectItem>
                <SelectItem value="externo">Fora do painel</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Filtro que não se vê é filtro que engana: a lista parece completa e
              não está. Cada um sai sozinho, sem precisar caçar o controle. */}
          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
                Filtrando por
              </span>
              {chips.map((c) => (
                <button
                  key={c.k}
                  type="button"
                  onClick={c.limpar}
                  className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {c.label}
                  <X className="h-3 w-3" />
                </button>
              ))}
              <button
                type="button"
                onClick={limparTudo}
                className="ml-1 text-[11.5px] font-medium text-primary underline-offset-4 hover:underline"
              >
                limpar tudo
              </button>
            </div>
          )}
        </CardHeader>

        <CardContent>
          <div className="rounded-md border border-border/60 overflow-hidden">
            {view === "flat" ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quando</TableHead>
                    <TableHead>Técnico</TableHead>
                    <TableHead>Máquina</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duração</TableHead>
                    <TableHead>IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading &&
                    Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 8 }).map((_, j) => (
                          <TableCell key={j}>
                            <Skeleton className="h-4 w-24" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  {!isLoading && filtradas.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                        <VazioComFiltro temFiltro={chips.length > 0} limpar={limparTudo} />
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading &&
                    filtradas.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {new Date(l.session_start).toLocaleString("pt-BR")}
                        </TableCell>
                        <TableCell className="text-xs">{nomeTecnico(l) ?? "—"}</TableCell>
                        <TableCell className="text-xs">
                          <CelulaMaquina apelido={nomeMaquina(l)} id={l.rustdesk_id} />
                        </TableCell>
                        <TableCell className="text-xs">{nomeCliente(l) ?? "—"}</TableCell>
                        <TableCell>
                          <OrigemBadge externo={ehExterno(l)} />
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={l.status} />
                        </TableCell>
                        <TableCell className="tabular-nums text-xs">
                          {formatDuration(l.duration_seconds)}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {(l.technician_ip as unknown as string) ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Máquina</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Último acesso</TableHead>
                    <TableHead>Técnico</TableHead>
                    <TableHead className="text-right">Acessos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading &&
                    Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 6 }).map((_, j) => (
                          <TableCell key={j}>
                            <Skeleton className="h-4 w-24" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  {!isLoading && grupos.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                        <VazioComFiltro temFiltro={chips.length > 0} limpar={limparTudo} />
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading &&
                    grupos.map((g) => {
                      const aberto = expandedRustdeskId === g.rustdesk_id;
                      return (
                        <Fragment key={g.rustdesk_id}>
                          <TableRow
                            className="cursor-pointer"
                            onClick={() => setExpandedRustdeskId(aberto ? null : g.rustdesk_id)}
                          >
                            <TableCell>
                              {aberto ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                            </TableCell>
                            <TableCell className="text-xs">
                              <CelulaMaquina apelido={g.maquina} id={g.rustdesk_id} />
                            </TableCell>
                            <TableCell className="text-xs">{g.cliente ?? "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">
                              {new Date(g.ultimo.session_start).toLocaleString("pt-BR")}
                            </TableCell>
                            <TableCell className="text-xs">{g.tecnico ?? "—"}</TableCell>
                            <TableCell className="text-right tabular-nums text-xs">
                              {g.acessos}
                            </TableCell>
                          </TableRow>
                          {aberto && (
                            <TableRow>
                              <TableCell colSpan={6} className="bg-muted/30 p-0">
                                <div className="p-3">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead>Início</TableHead>
                                        <TableHead>Técnico</TableHead>
                                        <TableHead>Origem</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Duração</TableHead>
                                        <TableHead>IP</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {g.sessoes.map((s) => (
                                        <TableRow key={s.id}>
                                          <TableCell className="text-xs whitespace-nowrap">
                                            {new Date(s.session_start).toLocaleString("pt-BR")}
                                          </TableCell>
                                          <TableCell className="text-xs">
                                            {nomeTecnico(s) ?? "—"}
                                          </TableCell>
                                          <TableCell>
                                            <OrigemBadge externo={ehExterno(s)} />
                                          </TableCell>
                                          <TableCell>
                                            <StatusBadge status={s.status} />
                                          </TableCell>
                                          <TableCell className="tabular-nums text-xs">
                                            {formatDuration(s.duration_seconds)}
                                          </TableCell>
                                          <TableCell className="font-mono text-xs text-muted-foreground">
                                            {(s.technician_ip as unknown as string) ?? "—"}
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                </TableBody>
              </Table>
            )}
          </div>
          {/* Truncagem silenciosa faz a tela parecer completa sem estar. Se o
              teto foi atingido, quem audita precisa saber antes de concluir
              qualquer coisa a partir do que está vendo. */}
          {noTeto && (
            <p className="mt-3 text-xs text-warning">
              Mostrando as {TETO} sessões mais recentes de {ROTULO_PERIODO[periodo]} — há mais
              registros no período. Reduza o intervalo para ver o restante.
            </p>
          )}
          {falhas > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {falhas} tentativa(s) de conexão falharam no período filtrado.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Apelido em cima, ID embaixo. O ID sozinho era o que tornava a tela ilegível —
 * ninguém decora "351 227 894" —, mas ele não some: é o que o técnico confere
 * contra a tela do programa quando precisa ter certeza da máquina.
 */
function CelulaMaquina({ apelido, id }: { apelido: string | null; id: string }) {
  if (!apelido) return <span className="font-mono">{id}</span>;
  return (
    <div className="flex flex-col leading-tight">
      <span className="font-medium text-foreground">{apelido}</span>
      <span className="font-mono text-[11px] text-muted-foreground">{id}</span>
    </div>
  );
}

function OrigemBadge({ externo }: { externo: boolean }) {
  if (!externo) {
    return (
      <Badge variant="outline" className="text-muted-foreground font-normal">
        painel
      </Badge>
    );
  }
  return (
    <Badge className="gap-1 bg-warning/15 text-warning border-warning/30 hover:bg-warning/15 font-normal">
      fora do painel
    </Badge>
  );
}

function VazioComFiltro({ temFiltro, limpar }: { temFiltro: boolean; limpar: () => void }) {
  if (!temFiltro) return <>Nenhuma sessão registrada ainda.</>;
  return (
    <span className="inline-flex flex-col items-center gap-2">
      <span>Nenhum registro com esses filtros.</span>
      <Button size="sm" variant="outline" onClick={limpar}>
        Limpar filtros
      </Button>
    </span>
  );
}

function StatusBadge({ status }: { status: "active" | "ended" | "failed" }) {
  const map = {
    active: { label: "ativa", variant: "default" as const },
    ended: { label: "encerrada", variant: "secondary" as const },
    failed: { label: "falhou", variant: "destructive" as const },
  };
  const s = map[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
