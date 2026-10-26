import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BadgeCheck,
  Check,
  ChevronRight,
  Copy,
  Handshake,
  Link2,
  MousePointerClick,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/hooks/use-me";
import { StatCard } from "@/components/stat-card";
import type { KpiInfo } from "@/components/kpi-info";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ---------------------------------------------------------------------------
// Indicacoes: revendedores com link proprio (acessofast.com.br/r/<codigo>). E da
// plataforma: so a ASP cadastra revendedor, ve os numeros e marca a comissao
// como paga. As regras (R$ 50 por empresa no 1o pagamento, pago ate o dia 30)
// estao na migracao 20261026150000_indicacoes.
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_authenticated/indicacoes")({
  head: () => ({
    meta: [{ title: "Indicações — Acessofast" }, { name: "robots", content: "noindex" }],
  }),
  component: IndicacoesPage,
});

const SITE = "https://acessofast.com.br";
const linkDeIndicacao = (codigo: string) => `${SITE}/r/${codigo}`;
// A pagina do revendedor e uma rota publica do proprio painel.
const linkDoRevendedor = (chave: string) => `${window.location.origin}/revendedor/${chave}`;

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const RESUMO_KEY = ["indicacoes-resumo"] as const;
const listaKey = (revendedorId: string) => ["indicacoes-do-revendedor", revendedorId] as const;

// Mesmo formato que o banco aceita (ck_revendedores_codigo).
const CODIGO_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

type Revendedor = {
  id: string;
  codigo: string;
  nome: string;
  contato: string | null;
  pix: string | null;
  ativo: boolean;
  chave_painel: string;
  created_at: string;
  cliques: number;
  cadastros: number;
  vendas: number;
  a_pagar_cents: number;
  pago_cents: number;
};

type Indicacao = {
  id: string;
  origem: string;
  created_at: string;
  empresa: string;
  tenant_id: string | null;
  em_teste: boolean;
  gratis: boolean;
  aguardando_pagamento: boolean;
  venda_em: string | null;
  competencia: string | null;
  comissao_cents: number | null;
  comissao_paga_em: string | null;
};

type Periodo = "mes" | "mes_passado" | "tudo";

const PERIODOS: { valor: Periodo; rotulo: string }[] = [
  { valor: "mes", rotulo: "Este mês" },
  { valor: "mes_passado", rotulo: "Mês passado" },
  { valor: "tudo", rotulo: "Desde o início" },
];

/** Primeiro dia do mês, AAAA-MM-DD, deslocado em `meses` a partir de hoje. */
function inicioDoMes(meses: number): string {
  const hoje = new Date();
  const alvo = new Date(hoje.getFullYear(), hoje.getMonth() + meses, 1);
  return `${alvo.getFullYear()}-${String(alvo.getMonth() + 1).padStart(2, "0")}-01`;
}

function intervalo(periodo: Periodo): { p_inicio?: string; p_fim?: string } {
  if (periodo === "mes") return { p_inicio: inicioDoMes(0), p_fim: inicioDoMes(1) };
  if (periodo === "mes_passado") return { p_inicio: inicioDoMes(-1), p_fim: inicioDoMes(0) };
  return {};
}

// A competência vem como AAAA-MM-01. Meio-dia para o fuso não puxar para o mês anterior.
function nomeDoMes(competencia: string) {
  const s = new Date(`${competencia}T12:00:00`).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// A comissão do mês é paga até o dia 30; em fevereiro, até o último dia.
function prazoDePagamento(competencia: string) {
  const [ano, mes] = competencia.split("-").map(Number);
  const ultimoDia = new Date(ano, mes, 0).getDate();
  return `${String(Math.min(30, ultimoDia)).padStart(2, "0")}/${String(mes).padStart(2, "0")}`;
}

const dataCurta = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

/** Sugestão de código a partir do nome: "João da Silva" vira "joao-da-silva". */
function codigoDoNome(nome: string) {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 32)
    .replace(/-+$/, "");
}

function traduzirErro(msg: string) {
  if (msg.includes("revendedores_codigo_key")) return "Já existe um revendedor com esse código.";
  if (msg.includes("ck_revendedores_codigo"))
    return "Código inválido: use letras minúsculas, números e hífen, de 3 a 32 caracteres.";
  if (msg.includes("empresa_ja_indicada")) return "Essa empresa já está ligada a um revendedor.";
  if (msg.includes("comissao_ja_paga"))
    return "A comissão dessa empresa já foi paga, então o vínculo não pode sair.";
  if (msg.includes("forbidden")) return "Sem permissão.";
  return msg;
}

const INFO: Record<"cliques" | "cadastros" | "vendas" | "aPagar", KpiInfo> = {
  cliques: {
    oQue: "Quantas pessoas abriram os links de indicação no período.",
    porQue: "Mostra o alcance de cada revendedor antes de qualquer cadastro.",
    comoCalculamos:
      "Uma abertura por navegador por dia. Abrir o link de novo no mesmo dia não conta outra vez, e robôs de prévia de link ficam de fora.",
  },
  cadastros: {
    oQue: "Contas criadas no site por quem veio de um link: teste grátis, plano gratuito ou contratação paga.",
    porQue: "É o meio do caminho entre o clique e a venda.",
    comoCalculamos:
      "Pela data do cadastro. Quem abriu o pagamento e não concluiu ainda não tem conta e não entra.",
  },
  vendas: {
    oQue: "Empresas indicadas que fizeram o primeiro pagamento de plano.",
    porQue: "É o que gera comissão: R$ 50 por empresa, uma vez só.",
    comoCalculamos:
      "Pelo mês do pagamento. Mensalidades seguintes e compra de créditos não contam como venda.",
  },
  aPagar: {
    oQue: "Comissões de vendas já feitas que ainda não foram marcadas como pagas.",
    porQue: "A comissão de cada mês é paga até o dia 30.",
    comoCalculamos:
      "Soma das comissões sem pagamento registrado, de qualquer mês. Não segue o filtro de período.",
  },
};

function IndicacoesPage() {
  const { data: me, isPending: mePending } = useMe();
  const isSuper = me?.role === "super_admin";
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [aberto, setAberto] = useState<string | null>(null);
  const [editando, setEditando] = useState<Revendedor | "novo" | null>(null);

  const resumo = useQuery({
    queryKey: [...RESUMO_KEY, periodo],
    enabled: isSuper,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("indicacoes_resumo", intervalo(periodo));
      if (error) throw error;
      return (data ?? []) as Revendedor[];
    },
  });

  if (!mePending && !isSuper) {
    return (
      <div className="space-y-6 p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Indicações</h1>
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Esta tela é da equipe do AcessoFast.
          </CardContent>
        </Card>
      </div>
    );
  }

  const revendedores = resumo.data ?? [];
  const soma = (campo: "cliques" | "cadastros" | "vendas" | "a_pagar_cents") =>
    revendedores.reduce((total, r) => total + Number(r[campo]), 0);
  const selecionado = revendedores.find((r) => r.id === aberto) ?? null;
  const carregando = resumo.isPending;
  const rotuloPeriodo = PERIODOS.find((p) => p.valor === periodo)?.rotulo.toLowerCase();

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Indicações</h1>
          <p className="text-sm text-muted-foreground">
            Revendedores com link próprio. Cada empresa trazida por eles que paga o primeiro plano
            rende R$ 50 de comissão, paga até o dia 30 do mês.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={periodo} onValueChange={(v) => setPeriodo(v as Periodo)}>
            <SelectTrigger className="w-44" aria-label="Período">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODOS.map((p) => (
                <SelectItem key={p.valor} value={p.valor}>
                  {p.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => setEditando("novo")}>
            <Plus className="mr-1.5 h-4 w-4" />
            Novo revendedor
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Cliques"
          value={soma("cliques")}
          icon={MousePointerClick}
          hint={`Aberturas dos links, ${rotuloPeriodo}`}
          loading={carregando}
          color="blue"
          info={INFO.cliques}
        />
        <StatCard
          title="Cadastros"
          value={soma("cadastros")}
          icon={UserPlus}
          hint={`Contas criadas pelo link, ${rotuloPeriodo}`}
          loading={carregando}
          color="violet"
          info={INFO.cadastros}
        />
        <StatCard
          title="Vendas"
          value={soma("vendas")}
          icon={BadgeCheck}
          hint={`Primeiro pagamento de plano, ${rotuloPeriodo}`}
          loading={carregando}
          color="emerald"
          info={INFO.vendas}
        />
        <StatCard
          title="A pagar"
          value={brl.format(soma("a_pagar_cents") / 100)}
          icon={Wallet}
          hint="Comissões ainda não pagas, de todos os meses"
          loading={carregando}
          color="amber"
          info={INFO.aPagar}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Handshake className="h-4 w-4 text-primary" />
            Revendedores
          </CardTitle>
          <CardDescription>
            Abra um revendedor para ver as empresas que ele trouxe e marcar a comissão como paga.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {resumo.isError ? (
            <p className="text-sm text-muted-foreground">
              Não foi possível carregar as indicações. Tente de novo em instantes.
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Revendedor</TableHead>
                    <TableHead className="text-right">Cliques</TableHead>
                    <TableHead className="text-right">Cadastros</TableHead>
                    <TableHead className="text-right">Vendas</TableHead>
                    <TableHead className="text-right">Conversão</TableHead>
                    <TableHead className="text-right">A pagar</TableHead>
                    <TableHead className="w-24 text-right">
                      <span className="sr-only">Ações</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {carregando &&
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 7 }).map((_, j) => (
                          <TableCell key={j}>
                            <Skeleton className="h-4 w-16" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  {!carregando && revendedores.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                        Nenhum revendedor ainda. Cadastre o primeiro em Novo revendedor.
                      </TableCell>
                    </TableRow>
                  )}
                  {!carregando &&
                    revendedores.map((r) => (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer"
                        onClick={() => setAberto(r.id)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{r.nome}</span>
                            {!r.ativo && (
                              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                                inativo
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">/r/{r.codigo}</p>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.cliques}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.cadastros}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.vendas}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {r.cliques > 0
                            ? `${((r.vendas / r.cliques) * 100).toLocaleString("pt-BR", {
                                maximumFractionDigits: 1,
                              })}%`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.a_pagar_cents > 0 ? brl.format(r.a_pagar_cents / 100) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <BotaoCopiar
                              texto={linkDeIndicacao(r.codigo)}
                              rotulo="Copiar link de indicação"
                            />
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <RevendedorDialog
        key={editando === "novo" ? "novo" : (editando?.id ?? "fechado")}
        alvo={editando}
        onClose={() => setEditando(null)}
        onSalvo={(id, novo) => {
          setEditando(null);
          // Revendedor novo abre direto no detalhe, que é onde estão os links para mandar a ele.
          if (novo) setAberto(id);
        }}
      />

      <DetalheRevendedor
        revendedor={selecionado}
        onClose={() => setAberto(null)}
        onEditar={() => selecionado && setEditando(selecionado)}
      />
    </div>
  );
}

function BotaoCopiar({ texto, rotulo }: { texto: string; rotulo: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <Button
      size="icon"
      variant="ghost"
      className="h-8 w-8"
      aria-label={rotulo}
      title={rotulo}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(texto);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 1500);
        } catch {
          toast.error("Não foi possível copiar. Selecione o link e copie à mão.");
        }
      }}
    >
      {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

function RevendedorDialog({
  alvo,
  onClose,
  onSalvo,
}: {
  alvo: Revendedor | "novo" | null;
  onClose: () => void;
  onSalvo: (id: string, novo: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const novo = alvo === "novo";
  const atual = alvo && alvo !== "novo" ? alvo : null;
  const [nome, setNome] = useState(atual?.nome ?? "");
  const [codigo, setCodigo] = useState(atual?.codigo ?? "");
  // Enquanto ninguém mexeu no código, ele acompanha o nome.
  const [codigoEditado, setCodigoEditado] = useState(false);
  const [contato, setContato] = useState(atual?.contato ?? "");
  const [pix, setPix] = useState(atual?.pix ?? "");
  const [ativo, setAtivo] = useState(atual?.ativo ?? true);

  const codigoValido = CODIGO_RE.test(codigo);
  const podeSalvar = nome.trim().length > 0 && (!novo || codigoValido);

  const salvar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("salvar_revendedor", {
        p_nome: nome.trim(),
        p_contato: contato,
        p_pix: pix,
        ...(novo ? { p_codigo: codigo } : { p_id: atual?.id, p_ativo: ativo }),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (id) => {
      toast.success(novo ? "Revendedor cadastrado." : "Revendedor atualizado.");
      await queryClient.invalidateQueries({ queryKey: RESUMO_KEY });
      onSalvo(id, novo);
    },
    onError: (e: Error) => toast.error(traduzirErro(e.message)),
  });

  return (
    <Dialog open={alvo !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{novo ? "Novo revendedor" : `Editar ${atual?.nome ?? ""}`}</DialogTitle>
          <DialogDescription>
            {novo
              ? "O código vai no link que ele vai divulgar e não muda depois de criado."
              : "O código do link não muda, para não quebrar o link que ele já divulgou."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rev-nome">Nome</Label>
            <Input
              id="rev-nome"
              value={nome}
              maxLength={120}
              onChange={(e) => {
                setNome(e.target.value);
                if (novo && !codigoEditado) setCodigo(codigoDoNome(e.target.value));
              }}
              placeholder="Nome do revendedor ou da empresa dele"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rev-codigo">Código do link</Label>
            <Input
              id="rev-codigo"
              value={codigo}
              maxLength={32}
              disabled={!novo}
              onChange={(e) => {
                setCodigoEditado(true);
                setCodigo(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
              }}
              placeholder="joao-silva"
            />
            <p className="text-xs text-muted-foreground">
              {codigo ? linkDeIndicacao(codigo) : "Letras minúsculas, números e hífen."}
              {novo && codigo && !codigoValido && " · de 3 a 32 caracteres, sem hífen nas pontas"}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rev-contato">Contato</Label>
              <Input
                id="rev-contato"
                value={contato}
                onChange={(e) => setContato(e.target.value)}
                placeholder="Telefone ou e-mail"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rev-pix">Chave Pix</Label>
              <Input
                id="rev-pix"
                value={pix}
                onChange={(e) => setPix(e.target.value)}
                placeholder="Para pagar a comissão"
              />
            </div>
          </div>

          {!novo && (
            <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
              <div>
                <p className="text-sm font-medium">Ativo</p>
                <p className="text-xs text-muted-foreground">
                  Inativo, o link para de marcar indicações novas. O que já foi indicado continua.
                </p>
              </div>
              <Switch checked={ativo} onCheckedChange={setAtivo} aria-label="Ativo" />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!podeSalvar || salvar.isPending} onClick={() => salvar.mutate()}>
            {salvar.isPending ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type MesDeComissao = {
  competencia: string;
  vendas: number;
  valorCents: number;
  pendentes: number;
  pagaEm: string | null;
};

function situacao(i: Indicacao): { rotulo: string; classe: string } {
  if (i.venda_em)
    return { rotulo: `Venda em ${dataCurta(i.venda_em)}`, classe: "bg-success/15 text-success" };
  if (i.aguardando_pagamento)
    return {
      rotulo: "Abriu o pagamento e não concluiu",
      classe: "bg-muted text-muted-foreground",
    };
  if (!i.tenant_id) return { rotulo: "Conta excluída", classe: "bg-muted text-muted-foreground" };
  if (i.em_teste) return { rotulo: "Em teste grátis", classe: "bg-warning/15 text-warning" };
  if (i.gratis) return { rotulo: "Plano gratuito", classe: "bg-primary/10 text-primary" };
  return { rotulo: "Sem pagamento ainda", classe: "bg-muted text-muted-foreground" };
}

function DetalheRevendedor({
  revendedor,
  onClose,
  onEditar,
}: {
  revendedor: Revendedor | null;
  onClose: () => void;
  onEditar: () => void;
}) {
  const queryClient = useQueryClient();
  const [vinculando, setVinculando] = useState(false);
  const [removendo, setRemovendo] = useState<Indicacao | null>(null);

  const lista = useQuery({
    queryKey: listaKey(revendedor?.id ?? ""),
    enabled: !!revendedor,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("indicacoes_do_revendedor", {
        p_revendedor_id: revendedor!.id,
      });
      if (error) throw error;
      return (data ?? []) as Indicacao[];
    },
  });

  const meses = useMemo<MesDeComissao[]>(() => {
    const porMes = new Map<string, MesDeComissao>();
    for (const i of lista.data ?? []) {
      if (!i.venda_em || !i.competencia) continue;
      const m = porMes.get(i.competencia) ?? {
        competencia: i.competencia,
        vendas: 0,
        valorCents: 0,
        pendentes: 0,
        pagaEm: null,
      };
      m.vendas += 1;
      m.valorCents += i.comissao_cents ?? 0;
      if (!i.comissao_paga_em) m.pendentes += 1;
      else if (!m.pagaEm || i.comissao_paga_em > m.pagaEm) m.pagaEm = i.comissao_paga_em;
      porMes.set(i.competencia, m);
    }
    return [...porMes.values()].sort((a, b) => b.competencia.localeCompare(a.competencia));
  }, [lista.data]);

  const atualizar = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: RESUMO_KEY }),
      revendedor && queryClient.invalidateQueries({ queryKey: listaKey(revendedor.id) }),
    ]);

  const marcar = useMutation({
    mutationFn: async (vars: { competencia: string; paga: boolean }) => {
      const { error } = await supabase.rpc("marcar_comissao_paga", {
        p_revendedor_id: revendedor!.id,
        p_competencia: vars.competencia,
        p_paga: vars.paga,
      });
      if (error) throw error;
    },
    onSuccess: async (_d, vars) => {
      toast.success(vars.paga ? "Comissão marcada como paga." : "Pagamento desfeito.");
      await atualizar();
    },
    onError: (e: Error) => toast.error(traduzirErro(e.message)),
  });

  const remover = useMutation({
    mutationFn: async (indicacaoId: string) => {
      const { error } = await supabase.rpc("desvincular_indicacao", {
        p_indicacao_id: indicacaoId,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Empresa tirada deste revendedor.");
      setRemovendo(null);
      await atualizar();
    },
    onError: (e: Error) => toast.error(traduzirErro(e.message)),
  });

  return (
    <Sheet open={revendedor !== null} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {revendedor && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                {revendedor.nome}
                {!revendedor.ativo && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
                    inativo
                  </span>
                )}
              </SheetTitle>
              <SheetDescription>
                {[revendedor.contato, revendedor.pix && `Pix: ${revendedor.pix}`]
                  .filter(Boolean)
                  .join(" · ") || "Sem contato nem Pix cadastrados."}
              </SheetDescription>
              <div>
                <Button size="sm" variant="outline" onClick={onEditar}>
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  Editar
                </Button>
              </div>
            </SheetHeader>

            <div className="mt-6 space-y-6">
              <section className="space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Link2 className="h-4 w-4 text-primary" />
                  Links para mandar ao revendedor
                </h3>
                <LinhaDeLink
                  titulo="Link de indicação"
                  explicacao="É o que ele divulga. Quem abre e contrata fica ligado a ele."
                  link={linkDeIndicacao(revendedor.codigo)}
                />
                <LinhaDeLink
                  titulo="Página das vendas dele"
                  explicacao="Sem senha. Mostra só quantas vendas ele fez, sem empresas nem valores."
                  link={linkDoRevendedor(revendedor.chave_painel)}
                />
              </section>

              <section className="space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Wallet className="h-4 w-4 text-primary" />
                  Comissões
                </h3>
                {lista.isPending ? (
                  <Skeleton className="h-16 w-full" />
                ) : meses.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma venda ainda.</p>
                ) : (
                  <div className="divide-y divide-border/60 rounded-md border border-border/60">
                    {meses.map((m) => (
                      <div
                        key={m.competencia}
                        className="flex flex-wrap items-center justify-between gap-2 p-3"
                      >
                        <div>
                          <p className="text-sm font-medium">{nomeDoMes(m.competencia)}</p>
                          <p className="text-xs text-muted-foreground">
                            {m.vendas} {m.vendas === 1 ? "venda" : "vendas"} ·{" "}
                            {brl.format(m.valorCents / 100)}
                            {m.pendentes > 0
                              ? ` · pagar até ${prazoDePagamento(m.competencia)}`
                              : m.pagaEm && ` · paga em ${dataCurta(m.pagaEm)}`}
                          </p>
                        </div>
                        {m.pendentes > 0 ? (
                          <Button
                            size="sm"
                            disabled={marcar.isPending}
                            onClick={() =>
                              marcar.mutate({ competencia: m.competencia, paga: true })
                            }
                          >
                            Marcar como paga
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={marcar.isPending}
                            onClick={() =>
                              marcar.mutate({ competencia: m.competencia, paga: false })
                            }
                          >
                            Desfazer
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <UserPlus className="h-4 w-4 text-primary" />
                    Empresas indicadas
                  </h3>
                  <Button size="sm" variant="outline" onClick={() => setVinculando(true)}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Vincular empresa
                  </Button>
                </div>
                {lista.isPending ? (
                  <Skeleton className="h-24 w-full" />
                ) : lista.isError ? (
                  <p className="text-sm text-muted-foreground">
                    Não foi possível carregar as empresas.
                  </p>
                ) : !lista.data?.length ? (
                  <p className="text-sm text-muted-foreground">
                    Ninguém se cadastrou pelo link ainda. Venda fechada pelo comercial, ou de quem
                    abriu o link num aparelho e contratou em outro, entra em Vincular empresa.
                  </p>
                ) : (
                  <div className="divide-y divide-border/60 rounded-md border border-border/60">
                    {lista.data.map((i) => {
                      const s = situacao(i);
                      return (
                        <div key={i.id} className="flex items-start justify-between gap-2 p-3">
                          <div className="min-w-0 space-y-1">
                            <p className="truncate text-sm font-medium">{i.empresa}</p>
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              <span
                                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${s.classe}`}
                              >
                                {s.rotulo}
                              </span>
                              <span>
                                {i.origem === "manual" ? "vinculada à mão" : "veio pelo link"} em{" "}
                                {dataCurta(i.created_at)}
                              </span>
                            </div>
                          </div>
                          {!i.comissao_paga_em && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 shrink-0"
                              aria-label={`Tirar ${i.empresa} deste revendedor`}
                              title="Tirar deste revendedor"
                              onClick={() => setRemovendo(i)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>

            <VincularEmpresaDialog
              key={vinculando ? "aberto" : "fechado"}
              revendedor={vinculando ? revendedor : null}
              onClose={() => setVinculando(false)}
              onVinculada={async () => {
                setVinculando(false);
                await atualizar();
              }}
            />

            <AlertDialog open={removendo !== null} onOpenChange={(v) => !v && setRemovendo(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Tirar «{removendo?.empresa}» deste revendedor?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {removendo?.venda_em
                      ? "A venda dessa empresa sai da comissão dele, que ainda não foi paga. A empresa não é afetada."
                      : "A empresa deixa de contar para ele. Ela mesma não é afetada."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={remover.isPending}
                    onClick={(e) => {
                      e.preventDefault();
                      if (removendo) remover.mutate(removendo.id);
                    }}
                  >
                    {remover.isPending ? "Tirando..." : "Tirar"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function LinhaDeLink({
  titulo,
  explicacao,
  link,
}: {
  titulo: string;
  explicacao: string;
  link: string;
}) {
  return (
    <div className="rounded-md border border-border/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{titulo}</p>
          <p className="truncate font-mono text-xs text-muted-foreground" title={link}>
            {link}
          </p>
        </div>
        <BotaoCopiar texto={link} rotulo={`Copiar ${titulo.toLowerCase()}`} />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{explicacao}</p>
    </div>
  );
}

type EmpresaParaVincular = { id: string; name: string };

function VincularEmpresaDialog({
  revendedor,
  onClose,
  onVinculada,
}: {
  revendedor: Revendedor | null;
  onClose: () => void;
  onVinculada: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [escolhida, setEscolhida] = useState<EmpresaParaVincular | null>(null);
  const [jaPagou, setJaPagou] = useState(false);

  const empresas = useQuery({
    queryKey: ["indicacoes-empresas"],
    enabled: revendedor !== null,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenants").select("id, name").order("name");
      if (error) throw error;
      return (data ?? []) as EmpresaParaVincular[];
    },
  });

  const termo = busca.trim().toLowerCase();
  const filtradas = (empresas.data ?? [])
    .filter((e) => !termo || e.name.toLowerCase().includes(termo))
    .slice(0, 50);

  const vincular = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("vincular_indicacao", {
        p_revendedor_id: revendedor!.id,
        p_tenant_id: escolhida!.id,
        p_ja_pagou: jaPagou,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Empresa vinculada.");
      onVinculada();
    },
    onError: (e: Error) => toast.error(traduzirErro(e.message)),
  });

  return (
    <Dialog open={revendedor !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vincular empresa a {revendedor?.nome}</DialogTitle>
          <DialogDescription>
            Para a venda que o comercial fechou, ou de quem abriu o link num aparelho e contratou em
            outro. Uma empresa fica com um revendedor só.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar empresa pelo nome"
            aria-label="Buscar empresa"
          />
          <div className="max-h-60 overflow-y-auto rounded-md border border-border/60">
            {empresas.isPending ? (
              <Skeleton className="m-2 h-20" />
            ) : filtradas.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">Nenhuma empresa com esse nome.</p>
            ) : (
              filtradas.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setEscolhida(e)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent ${
                    escolhida?.id === e.id ? "bg-accent font-medium" : ""
                  }`}
                >
                  <span className="truncate">{e.name}</span>
                  {escolhida?.id === e.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              ))
            )}
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={jaPagou}
              onCheckedChange={(v) => setJaPagou(v === true)}
              className="mt-0.5"
            />
            <span>
              A empresa já pagou o plano. A venda entra na comissão de{" "}
              {nomeDoMes(inicioDoMes(0)).toLowerCase()}.
              <span className="block text-xs text-muted-foreground">
                Sem marcar, a venda conta sozinha quando chegar o primeiro pagamento.
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!escolhida || vincular.isPending} onClick={() => vincular.mutate()}>
            {vincular.isPending ? "Vinculando..." : "Vincular"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
