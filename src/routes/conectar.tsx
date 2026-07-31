import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { toast } from "sonner";
import { Monitor, Copy, Check, Loader2, Building2, ArrowLeftRight } from "lucide-react";
import { useState } from "react";
import { filtrarIgnorandoPontuacao, formatarDocumento } from "@/lib/clientes";

// ---------------------------------------------------------------------------
// Modo embed do painel, aberto pelo botao "Conectar" do chat do DoctorSaaS:
//
//   https://<painel>/conectar?conv=<conversation_id>
//
// Fica FORA de _authenticated de proposito: aquele layout embrulha tudo no
// AppShell (sidebar + topo), que nao cabe numa janela de 520px. A sessao e a
// mesma — vem do localStorage, herdada por estar no mesmo navegador.
//
// O DoctorSaaS nao implementa nada alem do window.open: lista, validacao de
// plano, cobranca, tratamento de erro e disparo do acessofast:// acontecem aqui,
// no mesmo codigo que ja roda na tela de Dispositivos.
// ---------------------------------------------------------------------------

// A tabela de vinculo nasce junto com esta tela. O client do Supabase e tipado
// por src/integrations/supabase/types.ts, que so passa a conhece-la depois da
// migration aplicada e dos tipos regenerados. Ate la o acesso fica destipado
// AQUI, num ponto so, em vez de espalhar cast pela tela.
const db = supabase as unknown as SupabaseClient;
const TABELA_VINCULOS = "doctorsaas_conversation_links";

type ConnectResult = {
  rustdesk_id?: string;
  password?: string;
  deep_link?: string;
  source?: "free" | "credit" | "plan" | null;
  charged?: boolean;
  // Billing B1: quando a conta precisa escolher entre free e credito, o
  // connect-device responde isto SEM emitir senha (needs_choice).
  needs_choice?: boolean;
  free_remaining?: number;
  credit_balance?: number;
  error?: string;
};

type ClienteRow = {
  id: string;
  name: string;
  document: string | null;
  document_type: string | null;
  tenant_id: string;
};

type DeviceRow = {
  id: string;
  rustdesk_id: string;
  alias: string | null;
  os: string | null;
  last_online: string | null;
  client_id: string | null;
  is_active: boolean;
};

async function invokeErrorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const b = await error.context.json();
      return b?.detail ?? b?.error ?? error.message;
    } catch {
      return error.message;
    }
  }
  return (error as { message?: string })?.message ?? "Erro ao chamar a função";
}

function tempoRelativo(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}

export const Route = createFileRoute("/conectar")({
  // Mesma razao do _authenticated: a sessao vive no localStorage e o servidor
  // nao a enxerga.
  ssr: false,
  head: () => ({
    meta: [{ title: "Conectar — Acessofast" }, { name: "robots", content: "noindex" }],
  }),
  validateSearch: (search: Record<string, unknown>): { conv?: string } => {
    const bruto = typeof search.conv === "string" ? search.conv.trim() : "";
    return { conv: bruto === "" ? undefined : bruto.slice(0, 200) };
  },
  component: ConectarPage,
});

function ConectarPage() {
  const { conv } = Route.useSearch();
  const queryClient = useQueryClient();

  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [disparado, setDisparado] = useState(false);
  const [trocando, setTrocando] = useState(false);
  const [busca, setBusca] = useState("");
  const [connectData, setConnectData] = useState<{
    rustdesk_id: string;
    password: string;
    deep_link: string;
  } | null>(null);
  const [choiceData, setChoiceData] = useState<{
    deviceId: string;
    free_remaining: number;
    credit_balance: number;
  } | null>(null);

  // --- sessao herdada do painel -------------------------------------------
  const sessao = useQuery({
    queryKey: ["conectar_sessao"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return { logado: false, tenantId: null as string | null };
      const { data: perfil } = await supabase
        .from("profiles")
        .select("tenant_id, role")
        .eq("id", data.user.id)
        .maybeSingle();
      return {
        logado: true,
        tenantId: perfil?.tenant_id ?? null,
        superAdmin: perfil?.role === "super_admin",
      };
    },
  });

  // --- vinculo conversa -> cliente ----------------------------------------
  const vinculo = useQuery({
    enabled: Boolean(conv) && sessao.data?.logado === true,
    queryKey: ["conectar_vinculo", conv],
    queryFn: async () => {
      const { data, error } = await db
        .from(TABELA_VINCULOS)
        .select("client_id, tenant_id")
        .eq("conversation_id", conv as string)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as { client_id: string; tenant_id: string } | null) ?? null;
    },
  });

  // --- o grupo do cliente, pela RAIZ do CNPJ ------------------------------
  // Secao 6 do contrato: matriz e filiais da mesma empresa aparecem como uma
  // lista so, porque o cadastro costuma divergir entre os dois sistemas — um
  // tem a matriz, o outro tem a filial onde as maquinas realmente estao. Em
  // contrapartida a lista exibe o CNPJ completo de cada unidade.
  const grupo = useQuery({
    enabled: Boolean(vinculo.data?.client_id),
    queryKey: ["conectar_grupo", vinculo.data?.client_id],
    queryFn: async () => {
      const { data: base, error: e1 } = await supabase
        .from("clients")
        .select("id, name, document, document_type, tenant_id")
        .eq("id", vinculo.data!.client_id)
        .maybeSingle();
      if (e1) throw e1;
      if (!base) return [] as ClienteRow[];

      const doc = (base.document ?? "").replace(/\D/g, "");
      // Raiz so faz sentido para CNPJ. CPF e cadastro sem documento ficam no
      // cliente exato, sem agrupar.
      if (base.document_type !== "cnpj" || doc.length !== 14) return [base as ClienteRow];

      const { data: irmaos, error: e2 } = await supabase
        .from("clients")
        .select("id, name, document, document_type, tenant_id")
        .eq("tenant_id", base.tenant_id)
        .eq("document_type", "cnpj")
        .eq("is_active", true)
        .like("document", `${doc.slice(0, 8)}%`)
        .order("document");
      if (e2) throw e2;

      const lista = (irmaos ?? []) as ClienteRow[];
      return lista.some((c) => c.id === base.id) ? lista : [base as ClienteRow, ...lista];
    },
  });

  const idsDoGrupo = (grupo.data ?? []).map((c) => c.id);

  // --- maquinas do grupo ---------------------------------------------------
  const devices = useQuery({
    enabled: idsDoGrupo.length > 0,
    queryKey: ["conectar_devices", idsDoGrupo.join(",")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("address_book")
        .select("id, rustdesk_id, alias, os, last_online, client_id, is_active")
        .in("client_id", idsDoGrupo)
        .eq("is_active", true)
        .order("alias");
      if (error) throw error;
      return (data ?? []) as DeviceRow[];
    },
  });

  // Mesma regra da tela de Dispositivos: online = visto nos ultimos 120s.
  const online = useQuery({
    enabled: idsDoGrupo.length > 0,
    queryKey: ["conectar_online"],
    refetchInterval: 30000,
    queryFn: async () => {
      const limite = new Date(Date.now() - 120000).toISOString();
      const { data, error } = await supabase
        .from("address_book")
        .select("id")
        .gt("last_online", limite);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.id as string));
    },
  });

  // --- clientes para a escolha manual --------------------------------------
  const precisaEscolher =
    Boolean(conv) &&
    sessao.data?.logado === true &&
    !vinculo.isPending &&
    (vinculo.data === null || trocando);

  const clientes = useQuery({
    enabled: precisaEscolher,
    queryKey: ["conectar_clientes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, document, document_type, tenant_id")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as ClienteRow[];
    },
  });

  const vincular = useMutation({
    mutationFn: async (cliente: ClienteRow) => {
      const { error } = await db.from(TABELA_VINCULOS).upsert(
        {
          tenant_id: cliente.tenant_id,
          conversation_id: conv as string,
          client_id: cliente.id,
        },
        { onConflict: "tenant_id,conversation_id" },
      );
      if (error) throw error;
    },
    onSuccess: async () => {
      setTrocando(false);
      setBusca("");
      await queryClient.invalidateQueries({ queryKey: ["conectar_vinculo", conv] });
    },
    onError: (e: unknown) => {
      toast.error((e as { message?: string })?.message ?? "Não foi possível vincular o cliente");
    },
  });

  // --- conexao (identico ao doConnect da tela de Dispositivos) -------------
  const doConnect = async (deviceId: string, source?: "free" | "credit") => {
    setConnectingId(deviceId);
    try {
      const { data, error } = await supabase.functions.invoke<ConnectResult>("connect-device", {
        body: source ? { device_id: deviceId, source } : { device_id: deviceId },
      });
      if (error || data?.error) {
        const raw = error ? await invokeErrorMessage(error) : (data?.error ?? "");
        if (raw.includes("sem_senha_provisionada")) {
          toast.error("Dispositivo sem senha provisionada. Provisione a senha antes de conectar.");
        } else if (raw.includes("quota_exceeded")) {
          toast.error(
            "Limite de sessões simultâneas do plano atingido. Encerre uma sessão ativa para conectar em outro dispositivo.",
          );
        } else if (raw.includes("no_credits")) {
          toast.error(
            "Sem acessos gratuitos e sem créditos disponíveis. Compre créditos ou conheça os planos para conectar.",
          );
        } else if (raw.includes("billing_blocked")) {
          toast.error(
            "Conta bloqueada por pendência de pagamento/trial. Regularize na aba Financeiro para voltar a conectar.",
          );
        } else if (raw.includes("free_requires_individual")) {
          toast.error(
            "O acesso gratuito só vale para uma conexão por vez. Use um crédito para conexões simultâneas.",
          );
        } else if (raw.includes("device_inativo")) {
          toast.error("Dispositivo inativo. Reative-o para conectar.");
        } else {
          toast.error(raw || "Falha ao conectar");
        }
        return;
      }
      if (data?.needs_choice) {
        setChoiceData({
          deviceId,
          free_remaining: data.free_remaining ?? 0,
          credit_balance: data.credit_balance ?? 0,
        });
        return;
      }
      if (!data?.rustdesk_id || !data?.password || !data?.deep_link) {
        toast.error("Resposta inválida do servidor");
        return;
      }
      setChoiceData(null);
      setConnectData({
        rustdesk_id: data.rustdesk_id,
        password: data.password,
        deep_link: data.deep_link,
      });
      setCopiado(false);
    } finally {
      setConnectingId(null);
    }
  };

  async function copiarSenha() {
    if (!connectData) return;
    try {
      await navigator.clipboard.writeText(connectData.password);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error("Não foi possível copiar a senha");
    }
  }

  function abrirConexao() {
    if (!connectData) return;
    window.location.href = connectData.deep_link;
    setDisparado(true);
    // Secao 5: a janela fecha sozinha ao disparar. window.close() so vale para
    // janela aberta por script — que e o caso (window.open do DoctorSaaS). Se o
    // navegador recusar, o aviso abaixo cobre.
    setTimeout(() => window.close(), 2500);
  }

  // ---------------------------------------------------------------------
  // Estados da tela
  // ---------------------------------------------------------------------
  if (!conv) {
    return (
      <Moldura titulo="Conectar">
        <Aviso>
          Esta janela precisa ser aberta pelo botão <strong>Conectar</strong> do chat do DoctorSaaS,
          que informa qual conversa está sendo atendida.
        </Aviso>
      </Moldura>
    );
  }

  if (sessao.isPending) {
    return (
      <Moldura titulo="Conectar">
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </Moldura>
    );
  }

  if (!sessao.data?.logado) {
    return (
      <Moldura titulo="Conectar">
        <Aviso>Você precisa estar logado no painel do AcessoFast neste mesmo navegador.</Aviso>
        <Button type="button" className="w-full" onClick={() => window.open("/auth", "_blank")}>
          Abrir o painel para entrar
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => void sessao.refetch()}
        >
          Já entrei, tentar de novo
        </Button>
      </Moldura>
    );
  }

  if (!sessao.data.tenantId && !sessao.data.superAdmin) {
    return (
      <Moldura titulo="Conectar">
        <Aviso>
          Sua conta ainda não está vinculada a uma empresa. Fale com o administrador do AcessoFast.
        </Aviso>
      </Moldura>
    );
  }

  // Escolha manual do cliente: primeira vez desta conversa, ou troca pedida.
  if (precisaEscolher) {
    return (
      <Moldura titulo={trocando ? "Trocar cliente" : "Qual cliente é esta conversa?"}>
        <p className="text-sm text-muted-foreground">
          {trocando
            ? "Escolha o cliente correto. O vínculo anterior será substituído."
            : "Escolha uma vez e o AcessoFast lembra: nas próximas vezes esta conversa já abre nas máquinas certas."}
        </p>
        <Command filter={filtrarIgnorandoPontuacao} className="rounded-md border">
          <CommandInput
            placeholder="Buscar por nome ou CNPJ…"
            value={busca}
            onValueChange={setBusca}
          />
          <CommandList className="max-h-72">
            {clientes.isPending ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : (
              <>
                <CommandEmpty>Nenhum cliente encontrado.</CommandEmpty>
                <CommandGroup>
                  {(clientes.data ?? []).map((c) => (
                    <CommandItem
                      key={c.id}
                      value={`${c.name} ${c.document ?? ""}`}
                      disabled={vincular.isPending}
                      onSelect={() => vincular.mutate(c)}
                    >
                      <Building2
                        className="mr-2 h-4 w-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {formatarDocumento(c.document, c.document_type) ?? "—"}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
        {trocando && (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setTrocando(false)}
          >
            Cancelar
          </Button>
        )}
      </Moldura>
    );
  }

  const carregando = vinculo.isPending || grupo.isPending || devices.isPending;
  const lista = devices.data ?? [];
  const clientesDoGrupo = grupo.data ?? [];

  return (
    <Moldura
      titulo="Conectar"
      acao={
        <Button type="button" variant="ghost" size="sm" onClick={() => setTrocando(true)}>
          <ArrowLeftRight className="mr-1 h-3.5 w-3.5" aria-hidden />
          Trocar cliente
        </Button>
      }
    >
      {carregando ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : lista.length === 0 ? (
        <Aviso>Este cliente não tem nenhuma máquina ativa cadastrada no AcessoFast.</Aviso>
      ) : (
        <div className="space-y-4">
          {clientesDoGrupo.map((cliente) => {
            const daUnidade = lista.filter((d) => d.client_id === cliente.id);
            if (daUnidade.length === 0) return null;
            return (
              <div key={cliente.id} className="space-y-1.5">
                {/* CNPJ completo por unidade: o tecnico precisa saber em qual
                    filial esta entrando quando o grupo tem mais de uma. */}
                <div className="flex items-baseline justify-between gap-2 border-b pb-1">
                  <span className="truncate text-sm font-medium">{cliente.name}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {formatarDocumento(cliente.document, cliente.document_type) ?? "—"}
                  </span>
                </div>
                {daUnidade.map((d) => {
                  const ativo = online.data?.has(d.id) ?? false;
                  return (
                    <div
                      key={d.id}
                      className="flex items-center gap-3 rounded-md border border-border/60 p-2.5"
                    >
                      <span
                        className={
                          "h-2 w-2 shrink-0 rounded-full " +
                          (ativo ? "bg-green-500" : "bg-muted-foreground/40")
                        }
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{d.alias || d.rustdesk_id}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {ativo
                            ? "Online"
                            : d.last_online
                              ? `Offline · ${tempoRelativo(d.last_online)}`
                              : "Offline"}
                          {d.os ? ` · ${d.os}` : ""}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        disabled={connectingId !== null}
                        onClick={() => void doConnect(d.id)}
                      >
                        {connectingId === d.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          <Monitor className="h-4 w-4" aria-hidden />
                        )}
                        <span className="ml-1.5">Conectar</span>
                      </Button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* Escolha free x credito — mesma decisao da tela de Dispositivos. */}
      <Dialog open={choiceData !== null} onOpenChange={(v) => !v && setChoiceData(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Como deseja conectar?</DialogTitle>
            <DialogDescription>
              Esta é uma conexão individual. O acesso gratuito concede até 2 horas conectado; se o
              atendimento pode passar disso, use um crédito (sem esse limite).
            </DialogDescription>
          </DialogHeader>
          {choiceData && (
            <div className="grid gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={connectingId !== null || choiceData.free_remaining <= 0}
                onClick={() => void doConnect(choiceData.deviceId, "free")}
              >
                Usar acesso gratuito ({choiceData.free_remaining} restantes hoje) · até 2h
              </Button>
              <Button
                type="button"
                disabled={connectingId !== null || choiceData.credit_balance <= 0}
                onClick={() => void doConnect(choiceData.deviceId, "credit")}
              >
                Gastar 1 crédito ({choiceData.credit_balance} disponíveis) · sem limite de 2h
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setChoiceData(null)}>
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Credencial + disparo do acessofast:// */}
      <Dialog
        open={connectData !== null}
        onOpenChange={(v) => {
          if (!v) {
            setConnectData(null);
            setCopiado(false);
            setDisparado(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conectar</DialogTitle>
            <DialogDescription>
              Ao abrir a conexão, o AcessoFast vai pedir a senha acima. Cole-a para conectar.
            </DialogDescription>
          </DialogHeader>
          {connectData && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>ID AcessoFast</Label>
                <Input readOnly value={connectData.rustdesk_id} className="font-mono text-xs" />
              </div>
              <div className="space-y-1">
                <Label>Senha</Label>
                <div className="flex items-center gap-2">
                  <Input readOnly value={connectData.password} className="font-mono text-xs" />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void copiarSenha()}
                  >
                    {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    <span className="ml-1">{copiado ? "Copiado" : "Copiar"}</span>
                  </Button>
                </div>
              </div>
              {disparado && (
                // Secao 8: o fluxo pelo chat cria a expectativa de "clica e
                // conecta de qualquer lugar". Se o protocolo nao estiver
                // registrado, nada acontece e o tecnico fica sem explicacao.
                <p className="rounded-md border border-border/60 bg-muted/40 p-2.5 text-xs text-muted-foreground">
                  Se nada abrir, o cliente AcessoFast não está instalado nesta máquina — é ele que
                  registra o protocolo <code>acessofast://</code>. A conexão precisa sair pelo
                  cliente AcessoFast: o servidor derruba em segundos sessões vindas de um RustDesk
                  genérico.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConnectData(null);
                setCopiado(false);
                setDisparado(false);
              }}
            >
              Fechar
            </Button>
            <Button type="button" onClick={abrirConexao}>
              <Monitor className="mr-2 h-4 w-4" />
              Abrir conexão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Moldura>
  );
}

function Moldura({
  titulo,
  acao,
  children,
}: {
  titulo: string;
  acao?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-svh bg-background p-4">
      <div className="mx-auto flex max-w-md flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-base font-semibold">{titulo}</h1>
          {acao}
        </div>
        {children}
      </div>
    </div>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-border/60 bg-muted/40 p-3 text-sm text-muted-foreground">
      {children}
    </p>
  );
}
