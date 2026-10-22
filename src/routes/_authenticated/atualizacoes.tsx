import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppWindow, Cpu, FlaskConical, Loader2, Rocket, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/hooks/use-me";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

// ---------------------------------------------------------------------------
// Atualizações da frota: liberar versão nova do agente e do app para os computadores.
// É da plataforma (super_admin). Tudo passa pelas funções do banco liberar_versao e
// testar_versao, que conferem o super_admin e só aceitam versão do catálogo — o painel não
// tem permissão de escrita nas tabelas de versão (ver a migration 20261022150000).
//
// A ordem da casa: testar num computador, olhar, e só então liberar para todas. Voltar para
// uma versão anterior é o mesmo botão, escolhendo a versão antiga.
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_authenticated/atualizacoes")({
  head: () => ({
    meta: [{ title: "Atualizações — Acessofast" }, { name: "robots", content: "noindex" }],
  }),
  component: AtualizacoesPage,
});

const RESUMO_KEY = ["atualizacoes-resumo"] as const;

type Produto = "agente" | "app";
type Versao = { versao: string; criada_em: string };
type Fatia = { versao: string | null; maquinas: number };
type Fixada = { id: string; nome: string; fixada: string; atual: string | null };
type ResumoProduto = {
  alvo: string | null;
  versoes: Versao[];
  frota: Fatia[];
  fixadas: Fixada[];
  empresas_fixadas: number;
};
type Historico = {
  produto: Produto;
  versao: string | null;
  anterior: string | null;
  alcance: "todas" | "computador";
  computador: string | null;
  por: string | null;
  em: string;
};
type Resumo = { agente: ResumoProduto; app: ResumoProduto; historico: Historico[] };

const PRODUTO: Record<Produto, { titulo: string; descricao: string; icone: typeof Cpu }> = {
  agente: {
    titulo: "Agente",
    descricao:
      "O programa que roda por trás em cada computador: registra os acessos, cuida da senha e instala o app. Troca sozinho, só com o computador sem nenhum acesso.",
    icone: Cpu,
  },
  app: {
    titulo: "App AcessoFast",
    descricao:
      "O AcessoFast que o técnico e o cliente abrem. Quem instala é o agente, só com o computador sem nenhum acesso em nenhum sentido.",
    icone: AppWindow,
  },
};

// As funções novas ainda não estão nos tipos gerados do Supabase.
async function chamar<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await (
    supabase.rpc as unknown as (
      fn: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>
  )(fn, args);
  if (error) {
    if (error.code === "42501") throw new Error("Só a equipe AcessoFast pode fazer isso.");
    throw new Error(error.message);
  }
  return data as T;
}

function quando(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AtualizacoesPage() {
  const { data: me, isPending: mePending } = useMe();
  const isSuper = me?.role === "super_admin";

  const resumo = useQuery({
    queryKey: RESUMO_KEY,
    enabled: isSuper,
    refetchInterval: 30000,
    queryFn: () => chamar<Resumo>("atualizacoes_resumo"),
  });

  if (!mePending && !isSuper) {
    return (
      <div className="space-y-6 p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Atualizações</h1>
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Esta tela é da equipe do AcessoFast.
          </CardContent>
        </Card>
      </div>
    );
  }

  const dados = resumo.data;
  // Agente novo ainda não liberado: o app deve esperar (o agente é quem instala o app).
  const agenteAtrasado =
    !!dados && !!dados.agente.versoes[0] && dados.agente.versoes[0].versao !== dados.agente.alvo;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Atualizações</h1>
        <p className="text-sm text-muted-foreground">
          Libere a versão nova do agente e do app para os computadores. Teste primeiro em um
          computador; quando estiver tudo certo, libere para todas as máquinas. A contagem considera
          os computadores vistos nos últimos 7 dias e se atualiza sozinha.
        </p>
      </div>

      {resumo.isError && (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Não foi possível carregar as atualizações: {(resumo.error as Error).message}
          </CardContent>
        </Card>
      )}

      {!dados && !resumo.isError && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      )}

      {dados && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <CartaoProduto produto="agente" dados={dados.agente} />
            <CartaoProduto
              produto="app"
              dados={dados.app}
              aviso={
                agenteAtrasado
                  ? "Tem versão nova do agente ainda não liberada. Libere o agente antes do app: é o agente que instala o app."
                  : undefined
              }
            />
          </div>
          <CartaoHistorico historico={dados.historico} />
        </>
      )}
    </div>
  );
}

function CartaoProduto({
  produto,
  dados,
  aviso,
}: {
  produto: Produto;
  dados: ResumoProduto;
  aviso?: string;
}) {
  const qc = useQueryClient();
  const info = PRODUTO[produto];
  const Icone = info.icone;

  const [escolhida, setEscolhida] = useState<string | undefined>(dados.versoes[0]?.versao);
  const [confirmar, setConfirmar] = useState(false);
  const [soltarFixadas, setSoltarFixadas] = useState(true);
  const [testar, setTestar] = useState(false);

  const total = dados.frota.reduce((s, f) => s + f.maquinas, 0);
  const naLiberada = dados.frota.find((f) => f.versao === dados.alvo)?.maquinas ?? 0;
  const idxEscolhida = dados.versoes.findIndex((v) => v.versao === escolhida);
  const idxAlvo = dados.versoes.findIndex((v) => v.versao === dados.alvo);
  const jaLiberada = !!escolhida && escolhida === dados.alvo;
  const voltando = idxAlvo >= 0 && idxEscolhida > idxAlvo;

  const liberar = useMutation({
    mutationFn: () =>
      chamar<{ anterior: string | null; computadores_soltos: number }>("liberar_versao", {
        p_produto: produto,
        p_versao: escolhida,
        p_soltar_fixadas: soltarFixadas,
      }),
    onSuccess: () => {
      toast.success(
        `${info.titulo} ${escolhida} liberado para todas as máquinas. Cada computador troca nos próximos minutos, quando ninguém estiver acessando.`,
      );
      setConfirmar(false);
      qc.invalidateQueries({ queryKey: RESUMO_KEY });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const tirarTeste = useMutation({
    mutationFn: (deviceId: string) =>
      chamar("testar_versao", { p_produto: produto, p_versao: null, p_device_id: deviceId }),
    onSuccess: () => {
      toast.success("Teste encerrado: o computador volta a seguir a versão liberada para todas.");
      qc.invalidateQueries({ queryKey: RESUMO_KEY });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icone className="h-4 w-4" />
          {info.titulo}
        </CardTitle>
        <CardDescription>{info.descricao}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Liberada para todas:</span>
            {dados.alvo ? (
              <Badge variant="secondary" className="font-mono">
                {dados.alvo}
              </Badge>
            ) : (
              <span>nenhuma (atualização automática desligada)</span>
            )}
          </div>
          {dados.alvo && total > 0 && (
            <>
              <Progress value={(naLiberada / total) * 100} />
              <p className="text-xs text-muted-foreground">
                {naLiberada} de {total} computadores já estão nela.
              </p>
            </>
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">Versões nos computadores</p>
          <ul className="space-y-1 text-sm">
            {dados.frota.slice(0, 6).map((f) => (
              <li key={f.versao ?? "sem"} className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs">
                  {f.versao ?? <span className="font-sans text-muted-foreground">sem versão</span>}
                  {f.versao && f.versao === dados.alvo && (
                    <Badge variant="outline" className="ml-2 font-sans text-[10px]">
                      liberada
                    </Badge>
                  )}
                </span>
                <span className="tabular-nums text-muted-foreground">{f.maquinas}</span>
              </li>
            ))}
          </ul>
        </div>

        {(dados.fixadas.length > 0 || dados.empresas_fixadas > 0) && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Em teste</p>
            <ul className="space-y-1 text-sm">
              {dados.fixadas.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2">
                  <span>
                    {f.nome}{" "}
                    <span className="font-mono text-xs text-muted-foreground">
                      → {f.fixada}
                      {f.atual === f.fixada ? " (já instalada)" : " (aguardando)"}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={tirarTeste.isPending}
                    onClick={() => tirarTeste.mutate(f.id)}
                  >
                    Tirar do teste
                  </Button>
                </li>
              ))}
            </ul>
            {dados.empresas_fixadas > 0 && (
              <p className="text-xs text-muted-foreground">
                {dados.empresas_fixadas} empresa(s) com versão fixada também.
              </p>
            )}
          </div>
        )}

        {aviso && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            {aviso}
          </p>
        )}

        <div className="space-y-2 border-t pt-4">
          <Label>Versão</Label>
          <Select value={escolhida} onValueChange={setEscolhida}>
            <SelectTrigger aria-label="Versão">
              <SelectValue placeholder="Nenhuma versão no catálogo" />
            </SelectTrigger>
            <SelectContent>
              {dados.versoes.map((v, i) => (
                <SelectItem key={v.versao} value={v.versao}>
                  <span className="font-mono">{v.versao}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {i === 0 ? "mais nova" : quando(v.criada_em)}
                    {v.versao === dados.alvo ? " · liberada" : ""}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="outline" disabled={!escolhida} onClick={() => setTestar(true)}>
              <FlaskConical className="h-4 w-4" />
              Testar em um computador
            </Button>
            <Button disabled={!escolhida || jaLiberada} onClick={() => setConfirmar(true)}>
              {voltando ? <Undo2 className="h-4 w-4" /> : <Rocket className="h-4 w-4" />}
              {jaLiberada
                ? "Já liberada para todas"
                : voltando
                  ? "Voltar todas para esta versão"
                  : "Liberar para todas as máquinas"}
            </Button>
          </div>
        </div>
      </CardContent>

      <AlertDialog open={confirmar} onOpenChange={setConfirmar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {voltando ? "Voltar todas as máquinas para" : "Liberar"} {info.titulo} {escolhida}
              {voltando ? "?" : " para todas as máquinas?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Cada computador troca sozinho nos próximos minutos, sempre que ninguém estiver
              acessando ele. Hoje {total - naLiberada} de {total} computadores estão em outra
              versão.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {dados.fixadas.length + dados.empresas_fixadas > 0 && (
            <div className="flex items-start gap-2">
              <Checkbox
                id={`soltar-${produto}`}
                checked={soltarFixadas}
                onCheckedChange={(v) => setSoltarFixadas(v === true)}
              />
              <Label htmlFor={`soltar-${produto}`} className="text-sm font-normal leading-snug">
                Incluir também quem está em teste ({dados.fixadas.length} computador(es)
                {dados.empresas_fixadas > 0 ? ` e ${dados.empresas_fixadas} empresa(s)` : ""}): eles
                passam a seguir esta liberação.
              </Label>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={liberar.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={liberar.isPending}
              onClick={(e) => {
                e.preventDefault();
                liberar.mutate();
              }}
            >
              {liberar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {voltando ? "Voltar todas" : "Liberar para todas"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {testar && escolhida && (
        <DialogTestar produto={produto} versao={escolhida} onClose={() => setTestar(false)} />
      )}
    </Card>
  );
}

type Computador = {
  id: string;
  alias: string | null;
  rustdesk_id: string;
  last_online: string | null;
  agent_version: string | null;
  client_version: string | null;
};

function DialogTestar({
  produto,
  versao,
  onClose,
}: {
  produto: Produto;
  versao: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [escolhido, setEscolhido] = useState<Computador | null>(null);

  const computadores = useQuery({
    queryKey: ["atualizacoes-computadores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("address_book")
        .select("id, alias, rustdesk_id, last_online, agent_version, client_version")
        .eq("is_active", true)
        .order("last_online", { ascending: false, nullsFirst: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as unknown as Computador[];
    },
  });

  const online = useMemo(() => {
    const limite = Date.now() - 3 * 60 * 1000;
    return (c: Computador) => !!c.last_online && new Date(c.last_online).getTime() > limite;
  }, []);

  const testar = useMutation({
    mutationFn: () =>
      chamar("testar_versao", { p_produto: produto, p_versao: versao, p_device_id: escolhido?.id }),
    onSuccess: () => {
      toast.success(
        `${PRODUTO[produto].titulo} ${versao} vai para ${escolhido?.alias ?? escolhido?.rustdesk_id}. Ele troca no próximo sinal (até uns 3 minutos), sem ninguém acessando.`,
      );
      qc.invalidateQueries({ queryKey: RESUMO_KEY });
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Testar {PRODUTO[produto].titulo} {versao}
          </DialogTitle>
          <DialogDescription>
            Escolha o computador. Só ele recebe esta versão; os outros continuam na liberada para
            todas.
          </DialogDescription>
        </DialogHeader>
        <Command className="rounded-md border">
          <CommandInput placeholder="Buscar pelo nome ou ID" />
          <CommandList className="max-h-72">
            <CommandEmpty>
              {computadores.isPending ? "Carregando..." : "Nenhum computador encontrado."}
            </CommandEmpty>
            {(computadores.data ?? []).map((c) => (
              <CommandItem
                key={c.id}
                value={`${c.alias ?? ""} ${c.rustdesk_id}`}
                onSelect={() => setEscolhido(c)}
                className={escolhido?.id === c.id ? "bg-accent" : undefined}
              >
                <span
                  className={`mr-2 h-2 w-2 shrink-0 rounded-full ${online(c) ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
                />
                <span className="flex-1 truncate">{c.alias ?? c.rustdesk_id}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {produto === "agente" ? c.agent_version : c.client_version}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={testar.isPending}>
            Cancelar
          </Button>
          <Button disabled={!escolhido || testar.isPending} onClick={() => testar.mutate()}>
            {testar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {escolhido
              ? `Testar em ${escolhido.alias ?? escolhido.rustdesk_id}`
              : "Escolha um computador"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CartaoHistorico({ historico }: { historico: Historico[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Últimas liberações</CardTitle>
        <CardDescription>Quem liberou o quê, e quando.</CardDescription>
      </CardHeader>
      <CardContent>
        {historico.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma liberação feita por esta tela ainda.
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {historico.map((h, i) => (
              <li key={i} className="flex flex-wrap gap-x-2">
                <span className="tabular-nums text-muted-foreground">{quando(h.em)}</span>
                <span>
                  <strong>{h.por ?? "Alguém"}</strong> {fraseHistorico(h)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function fraseHistorico(h: Historico): string {
  const nome = PRODUTO[h.produto].titulo.toLowerCase();
  if (h.alcance === "todas") {
    return `liberou ${nome} ${h.versao} para todas as máquinas${h.anterior ? ` (antes: ${h.anterior})` : ""}.`;
  }
  if (h.versao === null) {
    return `tirou ${h.computador ?? "um computador"} do teste do ${nome}.`;
  }
  return `testou ${nome} ${h.versao} em ${h.computador ?? "um computador"}.`;
}
