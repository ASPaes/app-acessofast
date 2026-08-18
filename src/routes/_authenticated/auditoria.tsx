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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { filtrarIgnorandoPontuacao, formatarDocumento } from "@/lib/clientes";
import { useMe } from "@/hooks/use-me";
import {
  History,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Check,
  Radio,
  Users,
  ShieldAlert,
  Search,
  X,
  Building2,
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
type ComEmpresa = { tenant_id: string; tenants: { name: string } | null };

/** Nome do técnico, com queda para e-mail quando o RLS esconde o perfil. */
const nomeTecnico = (l: ComTecnico) => l.profiles?.full_name?.trim() || l.technician_email || null;
const ehExterno = (l: { notes: string | null }) => (l.notes ?? "").startsWith(MARCA_EXTERNO);
const nomeMaquina = (l: ComMaquina) => l.address_book?.alias?.trim() || null;
const nomeCliente = (l: ComMaquina) => l.address_book?.clients?.name ?? null;
/**
 * "Empresa" aqui é o tenant dono do log — a conta que contratou o AcessoFast —,
 * e não o `clients.name` da coluna Cliente, que é o cliente final atendido por
 * aquela conta. São dois níveis diferentes, e confundi-los numa tela de
 * auditoria trocaria "quem paga" por "quem foi atendido".
 */
const nomeEmpresa = (l: ComEmpresa) => l.tenants?.name?.trim() || null;

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
  const { data: me } = useMe();
  /**
   * Empresa é recorte de plataforma: o RLS de connection_logs já entrega a um
   * admin só o próprio tenant, então o filtro só existe para quem enxerga mais
   * de uma conta. Para os demais ele não é escondido por política de tela — é
   * inútil, e um seletor de uma opção só é ruído.
   */
  const isSuper = me?.role === "super_admin";

  const [view, setView] = useState<"grouped" | "flat" | "empresa">("flat");
  const [expandedRustdeskId, setExpandedRustdeskId] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>("7d");
  const [tecnico, setTecnico] = useState<string>(TODOS);
  const [origem, setOrigem] = useState<string>(TODOS);
  const [empresa, setEmpresa] = useState<string>(TODOS);

  /**
   * A lista do seletor vem de `tenants`, não das empresas presentes nos logs:
   * uma conta sem nenhum acesso no período precisa poder ser escolhida — é
   * justamente escolhendo-a que se descobre que ela não acessou nada.
   *
   * O CNPJ vem junto porque é por ele que se procura uma conta cujo nome de
   * cadastro não é o nome pelo qual ela é conhecida — e porque nome de empresa
   * repete ("Silva Informática" em duas cidades), documento não.
   */
  const { data: empresas } = useQuery({
    queryKey: ["tenants-auditoria"],
    enabled: !!isSuper,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenants").select("id, name, cnpj").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const [empresaAberta, setEmpresaAberta] = useState(false);

  /**
   * O período vai para o servidor, não para o filtro em memória. Filtrar por
   * data no cliente sobre uma janela fixa de N linhas produz uma tela que
   * mente: ela mostra "últimos 30 dias" quando na verdade mostra os 30 dias
   * que couberam nas N linhas mais recentes. Com o corte no banco, o que
   * chega é o período inteiro — e o teto só aparece quando é atingido de fato.
   *
   * A empresa desce junto pelo mesmo motivo, e não como filtro em memória: as
   * TETO linhas mais recentes são as de todas as contas, e recortar depois
   * mostraria só os acessos da empresa que couberam nessa fatia. Com o `eq` no
   * banco, o teto passa a ser da empresa escolhida.
   */
  const { data, isLoading } = useQuery({
    queryKey: ["connection_logs", periodo, empresa],
    queryFn: async () => {
      let q = supabase
        .from("connection_logs")
        .select(
          `id, rustdesk_id, technician_email, status, session_start, session_end,
           duration_seconds, technician_ip, notes, tenant_id,
           profiles!connection_logs_technician_id_fkey ( full_name ),
           tenants!connection_logs_tenant_id_fkey ( name ),
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
      if (empresa !== TODOS) q = q.eq("tenant_id", empresa);
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

  const nomeEmpresaFiltrada =
    empresa === TODOS ? null : (empresas?.find((t) => t.id === empresa)?.name ?? null);

  /**
   * A coluna e o cartão de empresa só ganham espaço quando há mais de uma
   * empresa em jogo. Com uma conta escolhida, repetir o mesmo nome em todas as
   * linhas custa largura numa tabela que já tem oito colunas e não diz nada
   * que o chip de filtro no topo não esteja dizendo.
   */
  const mostraEmpresa = !!isSuper && empresa === TODOS;
  /**
   * A visão por empresa é a única que depende do papel. Quem trocar de conta
   * numa aba já aberta cai aqui com `view` em "empresa" e sem direito a ela —
   * a tela volta para as sessões em vez de renderizar um agrupamento que o
   * usuário não pode ver.
   */
  const visao = view === "empresa" && !isSuper ? "flat" : view;
  /** Colunas das tabelas — o colSpan do estado vazio precisa acompanhar. */
  const COLUNAS_FLAT = mostraEmpresa ? 9 : 8;
  const COLUNAS_MAQUINA = mostraEmpresa ? 7 : 6;

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
    empresa !== TODOS && {
      k: "empresa",
      label: `empresa: ${nomeEmpresaFiltrada ?? "selecionada"}`,
      limpar: () => setEmpresa(TODOS),
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
    setEmpresa(TODOS);
    setBusca("");
  };

  const ativas = filtradas.filter((l) => l.status === "active").length;
  const falhas = filtradas.filter((l) => l.status === "failed").length;
  const externas = filtradas.filter(ehExterno).length;
  const tecnicosNoPeriodo = new Set(filtradas.map(nomeTecnico).filter(Boolean)).size;
  const empresasNoPeriodo = new Set(filtradas.map((l) => l.tenant_id)).size;

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
          empresa: nomeEmpresa(ultimo),
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

  /**
   * Quantos acessos cada empresa fez. A ordenação é por acessos, e não por
   * data: a pergunta que essa visão responde é "quem usa mais", e a lista
   * ordenada por último acesso responderia "quem usou por último".
   *
   * `acessos` conta ativa + encerrada, a mesma regra da visão por máquina —
   * tentativa que falhou não é acesso, e contá-la inflaria o uso de uma conta
   * que na prática não entrou em máquina nenhuma. As falhas aparecem à parte.
   */
  const porEmpresa = useMemo(() => {
    const map = new Map<string, LogRow[]>();
    for (const l of filtradas) {
      const arr = map.get(l.tenant_id) ?? [];
      arr.push(l);
      map.set(l.tenant_id, arr);
    }
    return Array.from(map.entries())
      .map(([tenant_id, sessoes]) => {
        const ordenadas = [...sessoes].sort(
          (a, b) => new Date(b.session_start).getTime() - new Date(a.session_start).getTime(),
        );
        return {
          tenant_id,
          empresa: nomeEmpresa(ordenadas[0]),
          acessos: ordenadas.filter((s) => s.status === "active" || s.status === "ended").length,
          falhas: ordenadas.filter((s) => s.status === "failed").length,
          externas: ordenadas.filter(ehExterno).length,
          tecnicos: new Set(ordenadas.map(nomeTecnico).filter(Boolean)).size,
          maquinas: new Set(ordenadas.map((s) => s.rustdesk_id)).size,
          ultimo: ordenadas[0],
        };
      })
      .sort(
        (a, b) =>
          b.acessos - a.acessos ||
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

      <div
        className={`grid gap-4 grid-cols-2 ${mostraEmpresa ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}
      >
        <StatCard
          title={nomeEmpresaFiltrada ? "Acessos da empresa" : "Sessões no período"}
          value={filtradas.length}
          icon={History}
          hint={
            noTeto
              ? `teto de ${TETO} — reduza o período`
              : nomeEmpresaFiltrada
                ? `${nomeEmpresaFiltrada} · ${ROTULO_PERIODO[periodo]}`
                : ROTULO_PERIODO[periodo]
          }
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
        {/* Só aparece para quem enxerga mais de uma conta, e só enquanto
            nenhuma está escolhida: com o filtro aplicado o número seria
            sempre 1, e um cartão que só sabe dizer "um" não é informação. */}
        {mostraEmpresa && (
          <StatCard
            title="Empresas"
            value={empresasNoPeriodo}
            icon={Building2}
            hint="Com acesso no período"
            loading={isLoading}
            color="cyan"
          />
        )}
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
                {visao === "flat"
                  ? "Sessões"
                  : visao === "grouped"
                    ? "Máquinas acessadas"
                    : "Acessos por empresa"}
              </CardTitle>
              <CardDescription>
                {isLoading
                  ? "Carregando…"
                  : visao === "flat"
                    ? `${filtradas.length} registro(s)`
                    : visao === "grouped"
                      ? `${grupos.length} máquina(s)`
                      : `${porEmpresa.length} empresa(s)`}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={visao === "flat" ? "default" : "outline"}
                onClick={() => setView("flat")}
              >
                Todas as sessões
              </Button>
              <Button
                size="sm"
                variant={visao === "grouped" ? "default" : "outline"}
                onClick={() => setView("grouped")}
              >
                Por máquina
              </Button>
              {isSuper && (
                <Button
                  size="sm"
                  variant={visao === "empresa" ? "default" : "outline"}
                  onClick={() => setView("empresa")}
                >
                  Por empresa
                </Button>
              )}
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
            {/* Empresa é o único filtro cuja lista cresce com o negócio: os
                outros três têm um punhado de opções fixas, este tem uma por
                conta vendida. Por isso ele é o único que abre com campo de
                busca — rolar uma lista de centenas atrás de um nome é o que
                faz um filtro deixar de ser usado. */}
            {isSuper && (
              <Popover open={empresaAberta} onOpenChange={setEmpresaAberta}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={empresaAberta}
                    aria-label="Empresa"
                    className="w-[240px] justify-between font-normal"
                  >
                    <span
                      className={`truncate ${empresa === TODOS ? "text-muted-foreground" : ""}`}
                    >
                      {nomeEmpresaFiltrada ?? "Todas as empresas"}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[320px] p-0" align="start">
                  {/* O filtro do cmdk enxerga só o `value` do item — é por isso
                      que o CNPJ entra nele, e é `filtrarIgnorandoPontuacao` que
                      faz "14.632.051/0001-40" e "14632051000140" acharem a
                      mesma empresa. */}
                  <Command filter={filtrarIgnorandoPontuacao}>
                    <CommandInput placeholder="Buscar por nome ou CNPJ…" />
                    {/* Barra de rolagem escondida, rolagem preservada: com o
                        campo de busca logo acima, chegar ao fim da lista é
                        trabalho de digitar, não de arrastar. A roda e as setas
                        continuam funcionando. */}
                    <CommandList className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      <CommandEmpty>Nenhuma empresa encontrada.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="__todas__"
                          onSelect={() => {
                            setEmpresa(TODOS);
                            setEmpresaAberta(false);
                          }}
                        >
                          <span className="text-muted-foreground">Todas as empresas</span>
                          {empresa === TODOS && <Check className="ml-auto h-4 w-4" />}
                        </CommandItem>
                      </CommandGroup>
                      <CommandGroup>
                        {(empresas ?? []).map((t) => (
                          <CommandItem
                            key={t.id}
                            value={`${t.name} ${t.cnpj ?? ""}`}
                            onSelect={() => {
                              setEmpresa(t.id);
                              setEmpresaAberta(false);
                            }}
                          >
                            <span className="truncate">{t.name}</span>
                            {t.cnpj && (
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {formatarDocumento(t.cnpj, "cnpj")}
                              </span>
                            )}
                            {t.id === empresa && <Check className="ml-auto h-4 w-4" />}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
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
            {visao === "flat" ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quando</TableHead>
                    <TableHead>Técnico</TableHead>
                    <TableHead>Máquina</TableHead>
                    <TableHead>Cliente</TableHead>
                    {mostraEmpresa && <TableHead>Empresa</TableHead>}
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
                        {Array.from({ length: COLUNAS_FLAT }).map((_, j) => (
                          <TableCell key={j}>
                            <Skeleton className="h-4 w-24" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  {!isLoading && filtradas.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={COLUNAS_FLAT}
                        className="text-center text-muted-foreground py-10"
                      >
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
                        {mostraEmpresa && (
                          <TableCell className="text-xs">{nomeEmpresa(l) ?? "—"}</TableCell>
                        )}
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
            ) : visao === "grouped" ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Máquina</TableHead>
                    <TableHead>Cliente</TableHead>
                    {mostraEmpresa && <TableHead>Empresa</TableHead>}
                    <TableHead>Último acesso</TableHead>
                    <TableHead>Técnico</TableHead>
                    <TableHead className="text-right">Acessos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading &&
                    Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: COLUNAS_MAQUINA }).map((_, j) => (
                          <TableCell key={j}>
                            <Skeleton className="h-4 w-24" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  {!isLoading && grupos.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={COLUNAS_MAQUINA}
                        className="text-center text-muted-foreground py-10"
                      >
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
                            {mostraEmpresa && (
                              <TableCell className="text-xs">{g.empresa ?? "—"}</TableCell>
                            )}
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
                              <TableCell colSpan={COLUNAS_MAQUINA} className="bg-muted/30 p-0">
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
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empresa</TableHead>
                    <TableHead className="text-right">Acessos</TableHead>
                    <TableHead className="text-right">Máquinas</TableHead>
                    <TableHead className="text-right">Técnicos</TableHead>
                    <TableHead className="text-right">Fora do painel</TableHead>
                    <TableHead className="text-right">Falhas</TableHead>
                    <TableHead>Último acesso</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading &&
                    Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 7 }).map((_, j) => (
                          <TableCell key={j}>
                            <Skeleton className="h-4 w-24" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  {!isLoading && porEmpresa.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                        <VazioComFiltro temFiltro={chips.length > 0} limpar={limparTudo} />
                      </TableCell>
                    </TableRow>
                  )}
                  {/* Clicar numa empresa não abre um sub-nível: leva para as
                      sessões dela já filtradas. O detalhe que interessa depois
                      de ver o total é sempre o registro linha a linha, e ele
                      já existe na primeira visão. */}
                  {!isLoading &&
                    porEmpresa.map((e) => (
                      <TableRow
                        key={e.tenant_id}
                        className="cursor-pointer"
                        onClick={() => {
                          setEmpresa(e.tenant_id);
                          setView("flat");
                        }}
                      >
                        <TableCell className="text-xs font-medium">{e.empresa ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {e.acessos}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {e.maquinas}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {e.tecnicos}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {e.externas > 0 ? (
                            <span className="text-warning">{e.externas}</span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                          {e.falhas}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {new Date(e.ultimo.session_start).toLocaleString("pt-BR")}
                        </TableCell>
                      </TableRow>
                    ))}
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
