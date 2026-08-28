import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { AnuncioSlot } from "@/components/anuncio-slot";
import { URL_DOWNLOAD_AGENTE } from "@/lib/download-agente";
import {
  Monitor,
  Copy,
  Check,
  Loader2,
  Building2,
  ArrowLeftRight,
  Search,
  RefreshCw,
  Link2,
  Plus,
  UserPlus,
  ListFilter,
  ArrowLeft,
  Send,
} from "lucide-react";
import { useState } from "react";
import {
  filtrarIgnorandoPontuacao,
  formatarDocumento,
  normalizarDocumento,
  normalizarTexto,
} from "@/lib/clientes";
import { limiteOnlineISO } from "@/lib/presenca";

// ---------------------------------------------------------------------------
// Modo embed do painel, aberto pelo botao "Conectar" do chat do DoctorSaaS:
//
//   https://<painel>/conectar?conv=<conversation_id>&nome=<nome>&cnpj=<cnpj>
//
// Fica FORA de _authenticated de proposito: aquele layout embrulha tudo no
// AppShell (sidebar + topo), que nao cabe numa janela de 520px. A sessao e a
// mesma — vem do localStorage, herdada por estar no mesmo navegador.
//
// O DoctorSaaS nao implementa nada alem do window.open: lista, validacao de
// plano, cobranca, tratamento de erro e disparo do acessofast:// acontecem aqui,
// no mesmo codigo que ja roda na tela de Dispositivos.
//
// AS TRES VALIDACOES (documento de fluxos, secao 3)
// Esta tela resolve, nesta ordem, as tres pendencias possiveis, mostrando uma de
// cada vez em vez de uma arvore de erro tecnico:
//
//   V1 vinculo    conversa -> cliente. Resolve nesta ordem: vinculo ja gravado,
//                 CNPJ que veio na URL (?cnpj=, resolvido aqui mesmo contra o
//                 cadastro), e por ultimo a escolha manual. Pode ser permanente
//                 ou so para o atendimento atual (secao 7, o caso da empresa de
//                 informatica que atende varios clientes).
//   V2 empresa    o cliente existe no cadastro do AcessoFast? Se nao, cadastra
//                 daqui mesmo. Nao existe "sincronizar do DoctorSaaS": o
//                 contrato da integracao nao preve API do lado de la, entao o
//                 cadastro do AcessoFast e a fonte da verdade.
//   V3 computador NAO e um erro so. Sao quatro situacoes com saidas diferentes:
//                 inexistente (instalar), instalado mas nao adotado (adotar),
//                 adotado sem cliente (vincular) e vinculado porem offline
//                 (esperar/atualizar — nunca oferecer reinstalar).
// ---------------------------------------------------------------------------

// Tabela do vinculo conversa -> cliente (migration 20260731020041).
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

type AdoptResult = {
  device_id?: string;
  rustdesk_id?: string;
  was_inserted?: boolean;
  error?: string;
};

// Onde o cliente final baixa o agente. E o mesmo endereco do fluxo normal de
// instalacao (FASE3-DESIGN, item 1) — a integracao nao cria um caminho paralelo.
const URL_DOWNLOAD = URL_DOWNLOAD_AGENTE;

const INSTRUCOES_INSTALACAO = [
  "Para eu acessar seu computador remotamente:",
  "",
  `1. Baixe o AcessoFast em ${URL_DOWNLOAD}`,
  "2. Execute o instalador e aguarde a tela mostrar um ID",
  "3. Me envie esse ID por aqui",
].join("\n");

// A janelinha nao alcanca a conversa do DoctorSaaS — o unico canal entre as
// duas e o postMessage para quem abriu a janela. Nos disparamos; do lado de la
// um listener escreve o texto no campo de mensagem, e quem envia e o operador.
// Combinado assim de proposito: sistema de fora disparando WhatsApp no cliente
// sem ninguem ler custa caro quando sai errado, e o preco de conferir e um Enter.
// Sem listener nada acontece e o "Copiar" continua sendo a saida.
//
// targetOrigin "*" porque nao sabemos de que dominio o chat abriu, e o conteudo
// e o texto de instalacao — nao ha segredo aqui para vazar. Quem precisa checar
// origem e o lado que recebe: o listener deles confere e.source contra a janela
// que abriu e e.origin contra o dominio do painel.
function enviarNoChat(texto: string): boolean {
  try {
    if (!window.opener || window.opener.closed) return false;
    window.opener.postMessage({ tipo: "acessofast:enviar_mensagem", texto }, "*");
    return true;
  } catch {
    return false;
  }
}

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

// O parser de busca do TanStack tenta interpretar cada valor da query, entao
// um CNPJ so de digitos NAO chega aqui como string — chega como number. Sem
// isto, `?cnpj=19734340000174` caia na validacao, virava undefined, e o
// roteador redirecionava (307) para a mesma URL sem o parametro. O sintoma era
// "o DoctorSaaS nao esta mandando o CNPJ"; a causa era este typeof.
//
// CNPJ com pontuacao ou comecando com zero nao e numero valido e continua
// chegando como string — por isso o bug so aparecia em parte dos casos.
function comoTexto(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

export const Route = createFileRoute("/conectar")({
  // Mesma razao do _authenticated: a sessao vive no localStorage e o servidor
  // nao a enxerga.
  ssr: false,
  head: () => ({
    meta: [{ title: "Conectar — Acessofast" }, { name: "robots", content: "noindex" }],
  }),
  validateSearch: (
    search: Record<string, unknown>,
  ): { conv?: string; nome?: string; cnpj?: string } => {
    const bruto = comoTexto(search.conv).trim();
    // `nome` e `cnpj` sao o que o DoctorSaaS ja sabe do contato. Chegam na URL
    // em vez de por API porque a janela roda na sessao do proprio tecnico: o
    // RLS ja recorta o cadastro dele, e nao ha segredo trafegando que ele nao
    // pudesse ver de qualquer jeito. Uma chamada a menos entre os dois lados.
    //
    // O `cnpj` RESOLVE o cliente; o `nome` nunca resolve nada, so pre-preenche
    // cadastro. Quem manda de verdade continua sendo o vinculo gravado.
    const contato = comoTexto(search.nome).trim();
    const doc = comoTexto(search.cnpj).replace(/\D/g, "");
    return {
      conv: bruto === "" ? undefined : bruto.slice(0, 200),
      nome: contato === "" ? undefined : contato.slice(0, 120),
      cnpj: doc.length === 14 || doc.length === 11 ? doc : undefined,
    };
  },
  component: ConectarPage,
});

function ConectarPage() {
  const { conv, nome: nomeContato, cnpj: cnpjContato } = Route.useSearch();
  const queryClient = useQueryClient();

  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [disparado, setDisparado] = useState(false);
  const [trocando, setTrocando] = useState(false);
  const [busca, setBusca] = useState("");
  // Secao 7: a escolha pode nao virar cadastro. Quando o tecnico desmarca
  // "lembrar", o cliente vale so para este atendimento e nada e gravado.
  const [lembrar, setLembrar] = useState(true);
  const [temporario, setTemporario] = useState<ClienteRow | null>(null);
  const [mostrarBuscaMaquina, setMostrarBuscaMaquina] = useState(false);
  // Saida para o contato que nao e empresa: ou vira cliente sem CNPJ, ou o
  // tecnico pula o cadastro e vai direto as maquinas.
  const [modoTodas, setModoTodas] = useState(false);
  const [avulso, setAvulso] = useState(false);
  const [buscaTodas, setBuscaTodas] = useState("");
  const [criando, setCriando] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoDoc, setNovoDoc] = useState("");
  const [connectData, setConnectData] = useState<{
    rustdesk_id: string;
    password: string;
    deep_link: string;
    // Fase 1 dos anuncios: o slot 'free_start' so aparece quando o servidor diz
    // que o atendimento saiu do uso gratuito.
    source: "free" | "credit" | "plan" | null;
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
  // Quem grava o vinculo e o proprio DoctorSaaS, chamando a nossa API com a
  // chave de integracao. Aqui so lemos.
  const vinculo = useQuery({
    enabled: Boolean(conv) && sessao.data?.logado === true,
    queryKey: ["conectar_vinculo", conv],
    queryFn: async () => {
      const ler = async () => {
        const { data, error } = await supabase
          .from(TABELA_VINCULOS)
          .select("client_id, tenant_id")
          .eq("conversation_id", conv as string)
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        return (data as { client_id: string; tenant_id: string } | null) ?? null;
      };

      const gravado = await ler();
      if (gravado) return { link: gravado };

      // Ainda nao ha vinculo. Pode ser que nunca haja (a integracao nao esta
      // configurada, e a escolha e manual mesmo), ou que o DoctorSaaS tenha
      // chamado a API no MESMO clique que abriu esta janela — e ai a escrita
      // dele ainda esta no ar. O window.open e sincrono e nao espera por nada,
      // entao quem espera somos nos, por menos de um segundo.
      for (const ms of [300, 600]) {
        await new Promise((r) => setTimeout(r, ms));
        const chegou = await ler();
        if (chegou) return { link: chegou };
      }
      return { link: null };
    },
  });

  // --- resolucao pelo CNPJ que o DoctorSaaS mandou -------------------------
  // Sem vinculo gravado, mas com CNPJ na URL, a janelinha resolve sozinha em vez
  // de perguntar. Nao grava nada: o cliente vale para este atendimento, e o
  // tecnico promove a vinculo permanente se quiser (o mesmo botao de sempre).
  //
  // Mesma regra do lado do servidor, de proposito: CNPJ exato, depois a raiz de
  // 8 digitos, e varias unidades sem match exato caem na escolha manual — porque
  // chutar filial manda o tecnico para as maquinas da unidade errada.
  const querResolverPorCnpj =
    Boolean(conv) &&
    sessao.data?.logado === true &&
    Boolean(cnpjContato) &&
    !vinculo.isPending &&
    vinculo.data?.link == null &&
    temporario === null;

  const resolucao = useQuery({
    enabled: querResolverPorCnpj,
    queryKey: ["conectar_resolucao", cnpjContato],
    queryFn: async () => {
      const doc = cnpjContato as string;
      const colunas = "id, name, document, document_type, tenant_id";

      const { data: exatos, error: e1 } = await supabase
        .from("clients")
        .select(colunas)
        .eq("is_active", true)
        .eq("document", doc)
        .limit(2);
      if (e1) throw e1;
      const exato = (exatos ?? []) as ClienteRow[];
      if (exato.length === 1) return { cliente: exato[0], motivo: "exato" as const };
      if (exato.length > 1) return { cliente: null, motivo: "varias_unidades" as const };

      // Raiz so existe para CNPJ. CPF que nao bateu exato acabou aqui.
      if (doc.length !== 14) return { cliente: null, motivo: "nao_encontrado" as const };

      const { data: raiz, error: e2 } = await supabase
        .from("clients")
        .select(colunas)
        .eq("is_active", true)
        .eq("document_type", "cnpj")
        .like("document", `${doc.slice(0, 8)}%`)
        .order("document");
      if (e2) throw e2;
      const irmaos = (raiz ?? []) as ClienteRow[];
      if (irmaos.length === 1) return { cliente: irmaos[0], motivo: "raiz" as const };
      if (irmaos.length > 1) return { cliente: null, motivo: "varias_unidades" as const };
      return { cliente: null, motivo: "nao_encontrado" as const };
    },
  });

  const resolvendoCnpj = querResolverPorCnpj && resolucao.isPending;

  // --- o grupo do cliente, pela RAIZ do CNPJ ------------------------------
  // Secao 6 do contrato: matriz e filiais da mesma empresa aparecem como uma
  // lista so, porque o cadastro costuma divergir entre os dois sistemas — um
  // tem a matriz, o outro tem a filial onde as maquinas realmente estao. Em
  // contrapartida a lista exibe o CNPJ completo de cada unidade.
  // O alvo do atendimento: a selecao temporaria manda no vinculo gravado, porque
  // e uma decisao explicita do tecnico para esta sessao.
  const clienteAlvo =
    temporario?.id ?? vinculo.data?.link?.client_id ?? resolucao.data?.cliente?.id ?? null;

  const grupo = useQuery({
    enabled: Boolean(clienteAlvo),
    queryKey: ["conectar_grupo", clienteAlvo],
    queryFn: async () => {
      const { data: base, error: e1 } = await supabase
        .from("clients")
        .select("id, name, document, document_type, tenant_id")
        .eq("id", clienteAlvo as string)
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
      // Sem filtro de is_active: maquina desativada e um estado distinto de
      // "nao existe" (secao 11) e precisa render a mensagem certa.
      const { data, error } = await supabase
        .from("address_book")
        .select("id, rustdesk_id, alias, os, last_online, client_id, is_active")
        .in("client_id", idsDoGrupo)
        .order("alias");
      if (error) throw error;
      return (data ?? []) as DeviceRow[];
    },
  });

  // Mesma regra da tela de Dispositivos: online = visto nos ultimos 120s.
  const online = useQuery({
    enabled: idsDoGrupo.length > 0 || modoTodas,
    queryKey: ["conectar_online"],
    refetchInterval: 30000,
    queryFn: async () => {
      const limite = limiteOnlineISO();
      const { data, error } = await supabase
        .from("address_book")
        .select("id")
        .gt("last_online", limite);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.id as string));
    },
  });

  // --- todas as maquinas, quando o atendimento nao tem cliente --------------
  // A RLS ja recorta pelo tenant. Online primeiro porque e o que da para usar
  // agora; o resto ordena por apelido.
  const todas = useQuery({
    enabled: modoTodas,
    queryKey: ["conectar_todas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("address_book")
        .select("id, rustdesk_id, alias, os, last_online, client_id, is_active, clients(name)")
        .eq("is_active", true)
        .order("alias");
      if (error) throw error;
      return (data ?? []) as unknown as (DeviceRow & { clients: { name: string } | null })[];
    },
  });

  // --- clientes para a escolha manual --------------------------------------
  const precisaEscolher =
    Boolean(conv) &&
    sessao.data?.logado === true &&
    !vinculo.isPending &&
    !resolvendoCnpj &&
    ((vinculo.data?.link == null && temporario === null && resolucao.data?.cliente == null) ||
      trocando);

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

  // O termo digitado pode ser nome OU CNPJ. Jogar um CNPJ no campo de nome faz
  // o tecnico apagar e redigitar — entao decidimos aqui em qual campo ele cai.
  function abrirCadastro(termo: string, semEmpresa: boolean) {
    const digitos = termo.replace(/\D/g, "");
    const ehDocumento = digitos.length === 11 || digitos.length === 14;
    setNovoNome(ehDocumento ? (nomeContato ?? "") : termo.trim());
    setNovoDoc(ehDocumento ? digitos : "");
    setAvulso(semEmpresa);
    setCriando(true);
  }

  async function gravarVinculo(cliente: ClienteRow) {
    const { error } = await supabase.from(TABELA_VINCULOS).upsert(
      {
        tenant_id: cliente.tenant_id,
        conversation_id: conv as string,
        client_id: cliente.id,
      },
      { onConflict: "tenant_id,conversation_id" },
    );
    if (error) throw error;
  }

  // Escolha do cliente. Grava o vinculo ou nao, conforme o "lembrar".
  const vincular = useMutation({
    mutationFn: async (cliente: ClienteRow) => {
      if (lembrar) await gravarVinculo(cliente);
      return cliente;
    },
    onSuccess: async (cliente) => {
      setTrocando(false);
      setBusca("");
      if (lembrar) {
        setTemporario(null);
        await queryClient.invalidateQueries({ queryKey: ["conectar_vinculo", conv] });
      } else {
        setTemporario(cliente);
      }
    },
    onError: (e: unknown) => {
      toast.error((e as { message?: string })?.message ?? "Não foi possível vincular o cliente");
    },
  });

  // Promove a selecao temporaria a vinculo permanente (acao LINK_CONTACT_COMPANY
  // do documento: so quando o tecnico pede, nunca como efeito colateral).
  const fixarVinculo = useMutation({
    mutationFn: async (cliente: ClienteRow) => {
      await gravarVinculo(cliente);
    },
    onSuccess: async () => {
      setTemporario(null);
      await queryClient.invalidateQueries({ queryKey: ["conectar_vinculo", conv] });
      toast.success("Conversa vinculada a este cliente");
    },
    onError: (e: unknown) => {
      toast.error((e as { message?: string })?.message ?? "Não foi possível vincular a conversa");
    },
  });

  // V2: o cliente nao existe no cadastro do AcessoFast. Em vez de mandar o
  // tecnico abrir outra tela, cadastra aqui e ja segue para as maquinas.
  const criarCliente = useMutation({
    mutationFn: async (): Promise<ClienteRow> => {
      const tenantId = sessao.data?.tenantId;
      if (!tenantId) throw new Error("Sua conta não está vinculada a uma empresa.");
      const nome = novoNome.trim();
      if (!nome) throw new Error("Informe o nome do cliente");
      const { document, document_type, erro } = normalizarDocumento(novoDoc);
      if (erro) throw new Error(erro);

      const { data, error } = await supabase
        .from("clients")
        .insert({ tenant_id: tenantId, name: nome, document, document_type })
        .select("id, name, document, document_type, tenant_id")
        .single();
      if (error) {
        // Nome repetido: o cliente ja existia com outra grafia na busca. Segue
        // com o existente em vez de mandar o tecnico procurar de novo.
        if ((error as { code?: string }).code === "23505") {
          const { data: existente } = await supabase
            .from("clients")
            .select("id, name, document, document_type, tenant_id")
            .eq("tenant_id", tenantId)
            .ilike("name", nome)
            .maybeSingle();
          if (existente) return existente as ClienteRow;
        }
        throw error;
      }
      return data as ClienteRow;
    },
    onSuccess: async (cliente) => {
      setCriando(false);
      setNovoNome("");
      setNovoDoc("");
      await queryClient.invalidateQueries({ queryKey: ["conectar_clientes"] });
      vincular.mutate(cliente);
    },
    onError: (e: unknown) => {
      toast.error((e as { message?: string })?.message ?? "Falha ao cadastrar o cliente");
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
        source: data.source ?? null,
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

  // Saida de escape: atendimento sem empresa, ou cliente que o tecnico nao acha.
  // Nada e gravado aqui — a conversa continua sem vinculo e pergunta de novo na
  // proxima vez, que e o comportamento correto para um numero avulso.
  if (modoTodas) {
    const termo = normalizarTexto(buscaTodas);
    const encontradas = (todas.data ?? [])
      .filter((d) => {
        if (!termo) return true;
        const alvo = `${d.alias ?? ""} ${d.rustdesk_id} ${d.clients?.name ?? ""}`;
        return normalizarTexto(alvo).includes(termo);
      })
      .sort((a, b) => {
        const oa = online.data?.has(a.id) ? 0 : 1;
        const ob = online.data?.has(b.id) ? 0 : 1;
        if (oa !== ob) return oa - ob;
        return (a.alias ?? a.rustdesk_id).localeCompare(b.alias ?? b.rustdesk_id);
      });
    // Teto de renderizacao: com cadastro grande a lista inteira trava a janela
    // de 520px, e o caminho util passa a ser a busca.
    const TETO = 40;
    const exibidas = encontradas.slice(0, TETO);

    return (
      <Moldura
        titulo="Todas as máquinas"
        acao={
          <Button type="button" variant="ghost" size="sm" onClick={() => setModoTodas(false)}>
            <ArrowLeft className="mr-1 h-3.5 w-3.5" aria-hidden />
            Voltar
          </Button>
        }
      >
        <p className="text-xs text-muted-foreground">
          Só para este atendimento — nada fica gravado nesta conversa.
        </p>
        <Input
          value={buscaTodas}
          onChange={(e) => setBuscaTodas(e.target.value)}
          placeholder="Buscar por máquina, ID ou cliente…"
        />
        {todas.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : exibidas.length === 0 ? (
          <Aviso>Nenhuma máquina encontrada.</Aviso>
        ) : (
          <div className="space-y-2">
            {exibidas.map((d) => (
              <LinhaDispositivo
                key={d.id}
                device={d}
                ativo={online.data?.has(d.id) ?? false}
                conectando={connectingId === d.id}
                desabilitado={connectingId !== null}
                onConectar={() => void doConnect(d.id)}
                subtitulo={d.clients?.name ?? "Sem cliente"}
              />
            ))}
            {encontradas.length > TETO && (
              <p className="text-center text-xs text-muted-foreground">
                Mostrando {TETO} de {encontradas.length}. Refine a busca.
              </p>
            )}
          </div>
        )}
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
            : lembrar
              ? "Escolha uma vez e o AcessoFast lembra: nas próximas vezes esta conversa já abre nas máquinas certas."
              : "A escolha vale só para este atendimento — nada é gravado nesta conversa."}
        </p>

        {/* O DoctorSaaS mandou CNPJ e nao achamos ninguem. Em vez de deixar o
            tecnico procurar um cliente que nao existe, dizemos o que sabemos e
            oferecemos o cadastro ja preenchido — um clique em vez de redigitar
            razao social e CNPJ. */}
        {cnpjContato && !trocando && !criando && resolucao.data?.cliente == null && (
          <div className="space-y-2 rounded-md border border-border/60 bg-muted/40 p-3">
            <p className="text-sm">
              O DoctorSaaS diz que esta conversa é{" "}
              <span className="font-medium">{nomeContato || "esta empresa"}</span>
              {" · "}
              <span className="font-mono text-xs">
                {formatarDocumento(cnpjContato, cnpjContato.length === 14 ? "cnpj" : "cpf")}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {resolucao.data?.motivo === "varias_unidades"
                ? "O grupo tem mais de uma unidade e nenhuma com este CNPJ exato. Escolha abaixo a unidade onde estão as máquinas, ou cadastre esta."
                : "Não encontrei este CNPJ no seu cadastro."}
            </p>
            <Button
              type="button"
              size="sm"
              className="w-full"
              onClick={() => abrirCadastro(cnpjContato, false)}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {resolucao.data?.motivo === "varias_unidades"
                ? "Cadastrar esta unidade"
                : "Cadastrar este cliente"}
            </Button>
          </div>
        )}

        {criando ? (
          // V2: cadastro do cliente sem sair da janelinha.
          <div className="space-y-3 rounded-md border p-3">
            <div className="space-y-1">
              <Label htmlFor="novo-cliente-nome">
                {avulso ? "Nome do contato" : "Nome do cliente"}
              </Label>
              <Input
                id="novo-cliente-nome"
                value={novoNome}
                onChange={(e) => setNovoNome(e.target.value)}
                placeholder={
                  avulso ? "Como identificar este atendimento" : "Razão social ou nome fantasia"
                }
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="novo-cliente-doc">CNPJ ou CPF (opcional)</Label>
              <Input
                id="novo-cliente-doc"
                value={novoDoc}
                onChange={(e) => setNovoDoc(e.target.value)}
                placeholder="Só números"
                inputMode="numeric"
              />
              <p className="text-xs text-muted-foreground">
                {avulso
                  ? "Pode ficar em branco. Sem CNPJ o cadastro funciona igual — só não agrupa filiais."
                  : "Com CNPJ, matriz e filiais do mesmo grupo passam a aparecer numa lista só."}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setCriando(false)}
              >
                Voltar
              </Button>
              <Button
                type="button"
                className="flex-1"
                disabled={criarCliente.isPending}
                onClick={() => criarCliente.mutate()}
              >
                {criarCliente.isPending && (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                )}
                Cadastrar e usar
              </Button>
            </div>
          </div>
        ) : (
          <>
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
                    <CommandEmpty className="p-4 text-center text-sm">
                      <p className="text-muted-foreground">Nenhum cliente encontrado.</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        onClick={() => abrirCadastro(busca, false)}
                      >
                        <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                        Cadastrar cliente
                      </Button>
                    </CommandEmpty>
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

            {/* Secao 7: empresa de informatica. O mesmo contato atende varios
            clientes e nao deveria ter vinculo permanente com nenhum — gravar
            aqui contaminaria o cadastro. */}
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={lembrar}
                onCheckedChange={(v) => setLembrar(v === true)}
                className="mt-0.5"
              />
              <span>
                Lembrar este cliente nesta conversa
                <span className="block text-xs text-muted-foreground">
                  Desmarque para empresas de informática, onde o mesmo contato atende vários
                  clientes.
                </span>
              </span>
            </label>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => abrirCadastro(busca, false)}
            >
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              Cadastrar um cliente novo
            </Button>

            {/* Nem todo atendimento tem empresa do outro lado. Duas saidas, e a
                diferenca entre elas e o que fica gravado: a primeira cria
                cadastro e a conversa passa a ser lembrada; a segunda nao grava
                nada e vale so para agora. */}
            <div className="flex gap-2 border-t pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => abrirCadastro(busca, true)}
              >
                <UserPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Não é empresa
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="flex-1"
                onClick={() => setModoTodas(true)}
              >
                <ListFilter className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Ver todas as máquinas
              </Button>
            </div>

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
          </>
        )}
      </Moldura>
    );
  }

  const carregando = vinculo.isPending || grupo.isPending || devices.isPending;
  const lista = devices.data ?? [];
  const clientesDoGrupo = grupo.data ?? [];
  // V3, secao 11: os tres estados de maquina que nao podem virar um erro so.
  const ativas = lista.filter((d) => d.is_active);
  const desativadas = lista.filter((d) => !d.is_active);
  const nenhumaOnline = ativas.length > 0 && !ativas.some((d) => online.data?.has(d.id));
  const clienteDaConversa = clientesDoGrupo.find((c) => c.id === clienteAlvo) ?? null;

  async function revalidar() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["conectar_devices"] }),
      queryClient.invalidateQueries({ queryKey: ["conectar_online"] }),
    ]);
  }

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
      {/* Selecao valida so para este atendimento: fica visivel o tempo todo,
          senao o tecnico nao sabe que a proxima abertura vai perguntar de novo. */}
      {temporario && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-border p-2">
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            Só neste atendimento:{" "}
            <strong className="font-medium text-foreground">{temporario.name}</strong>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0"
            disabled={fixarVinculo.isPending}
            onClick={() => fixarVinculo.mutate(temporario)}
          >
            <Link2 className="mr-1 h-3.5 w-3.5" aria-hidden />
            Vincular conversa
          </Button>
        </div>
      )}

      {carregando ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : ativas.length === 0 ? (
        <ResolverMaquina
          cliente={clienteDaConversa}
          desativadas={desativadas.length}
          onMudou={revalidar}
        />
      ) : (
        <div className="space-y-4">
          {clientesDoGrupo.map((cliente) => {
            const daUnidade = ativas.filter((d) => d.client_id === cliente.id);
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
                {daUnidade.map((d) => (
                  <LinhaDispositivo
                    key={d.id}
                    device={d}
                    ativo={online.data?.has(d.id) ?? false}
                    conectando={connectingId === d.id}
                    desabilitado={connectingId !== null}
                    onConectar={() => void doConnect(d.id)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Maquinas existem: o que pode faltar e uma delas estar online, ou uma
          maquina nova ainda nao vinculada. Nada de instalador aqui — sugerir
          reinstalar quem so esta desligado manda o tecnico pro caminho errado. */}
      {!carregando && ativas.length > 0 && (
        <div className="space-y-3">
          {nenhumaOnline && (
            <Aviso>
              As máquinas estão cadastradas, mas nenhuma está online agora. Peça para ligarem o
              computador e use <strong>Atualizar</strong> — não é preciso instalar nada de novo.
            </Aviso>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => void revalidar()}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Atualizar
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="flex-1"
              onClick={() => setMostrarBuscaMaquina((v) => !v)}
            >
              <Search className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Falta uma máquina?
            </Button>
          </div>
          {mostrarBuscaMaquina && (
            <ResolverMaquina
              cliente={clienteDaConversa}
              desativadas={desativadas.length}
              onMudou={revalidar}
              compacto
            />
          )}
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
              {/* Slot 'free_start'. So o momento de inicio entra nesta janela: a
                  tela do saldo esgotado (402) leva pra /financeiro, e mandar uma
                  popup de 520px pra outra rota do painel quebra o fluxo do chat.
                  La o 402 segue como toast. */}
              <AnuncioSlot
                placement="free_start"
                ativo={connectData.source === "free"}
                surface="embed"
              />
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

// ---------------------------------------------------------------------------
// V3 — resolver a pendencia de computador.
//
// "Nao encontrado" nao e um estado so (secao 11 do documento de fluxos). Daqui
// saem quatro caminhos diferentes, e o errado custa caro: oferecer instalador
// para quem so esta com o PC desligado faz o tecnico pedir uma reinstalacao
// inutil ao cliente.
//
//   existe e esta sem cliente  -> Vincular (update do client_id)
//   existe em outro cliente    -> so informa; remanejar e correcao de cadastro
//   instalado mas nao adotado  -> Adotar (adopt-device, o mesmo da tela de
//                                 Dispositivos) e ja vincula ao cliente
//   nao existe em lugar nenhum -> mandar o instalador pelo chat
// ---------------------------------------------------------------------------
type BuscaMaquina = {
  id: string;
  rustdesk_id: string;
  alias: string | null;
  os: string | null;
  is_active: boolean;
  client_id: string | null;
  clients: { name: string } | null;
};

function ResolverMaquina({
  cliente,
  desativadas,
  onMudou,
  compacto,
}: {
  cliente: ClienteRow | null;
  desativadas: number;
  onMudou: () => Promise<void> | void;
  compacto?: boolean;
}) {
  const [termo, setTermo] = useState("");
  const [resultado, setResultado] = useState<BuscaMaquina[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [novoId, setNovoId] = useState("");
  const [novoApelido, setNovoApelido] = useState("");

  const digitos = termo.replace(/\D/g, "");
  // O ID do AcessoFast e so digito; o resto e busca por nome da maquina.
  const pareceId = /^[\d\s.-]+$/.test(termo.trim()) && digitos.length >= 6 && digitos.length <= 12;

  async function pesquisar() {
    const t = termo.trim();
    if (!t) return;
    setOcupado(true);
    try {
      const base = supabase
        .from("address_book")
        .select("id, rustdesk_id, alias, os, is_active, client_id, clients(name)")
        .limit(10);
      // A RLS ja recorta pelo tenant — a busca nunca alcanca maquina de outro MSP.
      const { data, error } = await (pareceId
        ? base.eq("rustdesk_id", digitos)
        : base.ilike("alias", `%${t}%`));
      if (error) throw error;
      setResultado((data ?? []) as unknown as BuscaMaquina[]);
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Falha ao pesquisar");
    } finally {
      setOcupado(false);
    }
  }

  async function vincularMaquina(row: BuscaMaquina) {
    if (!cliente) return;
    setOcupado(true);
    try {
      const { error } = await supabase
        .from("address_book")
        .update({ client_id: cliente.id, device_group: cliente.name })
        .eq("id", row.id);
      if (error) throw error;
      toast.success(`Computador vinculado a ${cliente.name}`);
      setResultado(null);
      setTermo("");
      await onMudou();
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Falha ao vincular o computador");
    } finally {
      setOcupado(false);
    }
  }

  async function adotar() {
    if (!cliente) return;
    const id = novoId.replace(/\D/g, "");
    if (id.length < 6 || id.length > 12) {
      toast.error("O ID do AcessoFast tem de 6 a 12 dígitos.");
      return;
    }
    setOcupado(true);
    try {
      const { data, error } = await supabase.functions.invoke<AdoptResult>("adopt-device", {
        // tenant_id so e lido quando quem chama e super_admin; para o tecnico
        // comum a funcao usa o tenant do proprio perfil.
        body: {
          rustdesk_id: id,
          alias: novoApelido.trim() || null,
          tenant_id: cliente.tenant_id,
        },
      });
      if (error || data?.error) {
        const raw = error ? await invokeErrorMessage(error) : (data?.error ?? "");
        if (raw.includes("no_pending_claim")) {
          toast.error(
            "Esse computador ainda não apareceu aqui. Confirme que o AcessoFast foi instalado e abriu, depois tente de novo.",
          );
        } else if (raw.includes("rustdesk_id_invalido")) {
          toast.error("ID inválido — são de 6 a 12 dígitos.");
        } else {
          toast.error(raw || "Falha ao adotar o computador");
        }
        return;
      }
      if (data?.device_id) {
        const { error: gErr } = await supabase
          .from("address_book")
          .update({ client_id: cliente.id, device_group: cliente.name })
          .eq("id", data.device_id);
        if (gErr) {
          toast.warning(
            "Computador adotado, mas não consegui vincular ao cliente — ajuste na tela de Dispositivos.",
          );
        } else {
          toast.success(
            "Computador adotado. Ele envia a senha em alguns segundos — depois é só Conectar.",
          );
        }
      }
      setResultado(null);
      setTermo("");
      setNovoId("");
      setNovoApelido("");
      await onMudou();
    } finally {
      setOcupado(false);
    }
  }

  function despacharNoChat() {
    if (enviarNoChat(INSTRUCOES_INSTALACAO)) {
      setEnviado(true);
      setTimeout(() => setEnviado(false), 2500);
    } else {
      toast.error("Esta janela não foi aberta pelo chat — use Copiar instruções.");
    }
  }

  async function copiarInstrucoes() {
    try {
      await navigator.clipboard.writeText(INSTRUCOES_INSTALACAO);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error("Não foi possível copiar as instruções");
    }
  }

  if (!cliente) {
    return <Aviso>Escolha o cliente desta conversa para vincular um computador.</Aviso>;
  }

  return (
    <div className="space-y-3">
      {!compacto && (
        <Aviso>
          {desativadas > 0
            ? `Este cliente só tem ${desativadas === 1 ? "uma máquina desativada" : `${desativadas} máquinas desativadas`}. Reative na tela de Dispositivos, ou vincule outro computador abaixo.`
            : "Nenhum computador está vinculado a este cliente ainda."}
        </Aviso>
      )}

      <div className="space-y-1">
        <Label htmlFor="busca-maquina">Pesquisar computador</Label>
        <div className="flex gap-2">
          <Input
            id="busca-maquina"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void pesquisar();
              }
            }}
            placeholder="ID do AcessoFast ou nome da máquina"
          />
          <Button
            type="button"
            variant="outline"
            disabled={ocupado || termo.trim() === ""}
            onClick={() => void pesquisar()}
          >
            {ocupado ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Search className="h-4 w-4" aria-hidden />
            )}
            <span className="sr-only">Pesquisar</span>
          </Button>
        </div>
      </div>

      {resultado !== null &&
        (resultado.length === 0 ? (
          <div className="space-y-2 rounded-md border border-border/60 p-3">
            {pareceId ? (
              <>
                <p className="text-sm">
                  Nenhum computador com o ID <code className="font-mono">{digitos}</code> no seu
                  cadastro.
                </p>
                <p className="text-xs text-muted-foreground">
                  Se o cliente acabou de instalar o AcessoFast, ele está esperando adoção. O ID já
                  foi para o cadastro abaixo — é só confirmar.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => setNovoId(digitos)}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Cadastrar com este ID
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhum computador com esse nome. Tente pelo ID do AcessoFast — o número que aparece
                na tela do programa, na máquina do cliente.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {resultado.map((r) => (
              <div key={r.id} className="rounded-md border border-border/60 p-2.5">
                <p className="truncate text-sm">{r.alias || r.rustdesk_id}</p>
                <p className="truncate text-xs text-muted-foreground">
                  ID {r.rustdesk_id}
                  {r.os ? ` · ${r.os}` : ""}
                </p>
                <div className="mt-2">
                  {!r.is_active ? (
                    <p className="text-xs text-muted-foreground">
                      Máquina desativada. Reative na tela de Dispositivos para poder conectar.
                    </p>
                  ) : r.client_id === cliente.id ? (
                    <p className="text-xs text-muted-foreground">
                      Já está vinculada a este cliente.
                    </p>
                  ) : r.client_id ? (
                    <p className="text-xs text-muted-foreground">
                      Vinculada a <strong>{r.clients?.name ?? "outro cliente"}</strong>. Se estiver
                      errado, corrija na tela de Dispositivos — remanejar máquina é ajuste de
                      cadastro.
                    </p>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      disabled={ocupado}
                      onClick={() => void vincularMaquina(r)}
                    >
                      <Link2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      Vincular a {cliente.name}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}

      {/* CADASTRAR: adotar um computador pelo ID, sem abrir o painel.
          Nao existe "criar maquina": o agente precisa estar instalado e ter se
          anunciado. O que fazemos aqui e reivindicar esse anuncio para o cliente
          desta conversa — por isso o campo e o ID que aparece na tela dele. */}
      <div className="space-y-2 rounded-md border border-border/60 p-3">
        <p className="text-sm font-medium">Cadastrar computador</p>
        <p className="text-xs text-muted-foreground">
          Peça ao cliente o ID que aparece na tela do AcessoFast dele.
        </p>
        <div className="flex gap-2">
          <Input
            value={novoId}
            onChange={(e) => setNovoId(e.target.value)}
            placeholder="ID (6 a 12 dígitos)"
            inputMode="numeric"
            className="flex-1"
          />
          <Input
            value={novoApelido}
            onChange={(e) => setNovoApelido(e.target.value)}
            placeholder="Apelido (opcional)"
            className="flex-1"
          />
        </div>
        <Button
          type="button"
          size="sm"
          className="w-full"
          disabled={ocupado || novoId.trim() === ""}
          onClick={() => void adotar()}
        >
          {ocupado ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          )}
          Cadastrar em {cliente.name}
        </Button>
      </div>

      {/* SEND_INSTALLER: so aqui, no caminho de "nao existe maquina". O botao de
          abrir o download saiu — o texto copiado ja leva o link, e um botao que
          abre a pagina na maquina do TECNICO nao ajuda quem precisa instalar e
          esta do outro lado da conversa. */}
      <div className="space-y-2 rounded-md border border-border/60 bg-muted/40 p-3">
        <p className="text-sm font-medium">O cliente ainda não tem o AcessoFast?</p>
        <p className="text-xs text-muted-foreground">
          O texto cai no campo de mensagem do chat para você conferir e enviar. Com o ID que ele
          responder, use o cadastro acima.
        </p>
        <div className="flex gap-2">
          <Button type="button" size="sm" className="flex-1" onClick={despacharNoChat}>
            {enviado ? (
              <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            ) : (
              <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            )}
            {enviado ? "Feito" : "Escrever no chat"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => void copiarInstrucoes()}
          >
            {copiado ? (
              <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            ) : (
              <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            )}
            {copiado ? "Copiado" : "Copiar instruções"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function LinhaDispositivo({
  device,
  ativo,
  conectando,
  desabilitado,
  onConectar,
  subtitulo,
}: {
  device: DeviceRow;
  ativo: boolean;
  conectando: boolean;
  desabilitado: boolean;
  onConectar: () => void;
  subtitulo?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border/60 p-2.5">
      <span
        className={
          "h-2 w-2 shrink-0 rounded-full " + (ativo ? "bg-green-500" : "bg-muted-foreground/40")
        }
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{device.alias || device.rustdesk_id}</p>
        <p className="truncate text-xs text-muted-foreground">
          {ativo
            ? "Online"
            : device.last_online
              ? `Offline · ${tempoRelativo(device.last_online)}`
              : "Offline"}
          {device.os ? ` · ${device.os}` : ""}
          {subtitulo ? ` · ${subtitulo}` : ""}
        </p>
      </div>
      <Button type="button" size="sm" disabled={desabilitado} onClick={onConectar}>
        {conectando ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Monitor className="h-4 w-4" aria-hidden />
        )}
        <span className="ml-1.5">Conectar</span>
      </Button>
    </div>
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
