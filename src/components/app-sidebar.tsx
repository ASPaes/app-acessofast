import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  LayoutDashboard,
  MonitorSmartphone,
  History,
  Users,
  Activity,
  Building2,
  Store,
  Wallet,
  Megaphone,
  Plug,
} from "lucide-react";
import { Sidebar, SidebarContent, SidebarHeader, useSidebar } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import acessofastLogo from "@/assets/acessofast-logo.png.asset.json";
import { useSolicitacoesAcesso } from "@/hooks/use-solicitacoes-acesso";

type NavItem = {
  title: string;
  url:
    | "/dashboard"
    | "/dispositivos"
    | "/clientes"
    | "/auditoria"
    | "/usuarios"
    | "/monitoramento"
    | "/financeiro"
    | "/empresas"
    | "/anuncios"
    | "/integracoes";
  icon: typeof LayoutDashboard;
};

const operacao: NavItem[] = [
  { title: "Visão geral", url: "/dashboard", icon: LayoutDashboard },
  { title: "Dispositivos", url: "/dispositivos", icon: MonitorSmartphone },
  { title: "Clientes", url: "/clientes", icon: Store },
  { title: "Auditoria", url: "/auditoria", icon: History },
];

// Configurações saiu: a tela só tinha um aviso de "em construção" e um bloco
// vazio. Um item de menu que abre uma tela sem conteúdo ensina que o menu não é
// confiável — custa mais do que não ter o item. Volta quando houver o quê pôr.
//
// Financeiro saiu da lista do técnico: plano, fatura e crédito são decisão da
// administração da conta, e ele não toma nenhuma delas.
const gestao: NavItem[] = [{ title: "Usuários", url: "/usuarios", icon: Users }];

// Integracoes fica em gestao, e fora da lista do tecnico pelo mesmo motivo do
// Financeiro: emitir chave que da acesso de escrita ao cadastro e decisao de
// administracao da conta, nao ferramenta de atendimento.
const gestaoAdmin: NavItem[] = [
  { title: "Financeiro", url: "/financeiro", icon: Wallet },
  { title: "Integrações", url: "/integracoes", icon: Plug },
];

// Planos saiu: a tela existia para listar empresas e dar acesso ao formulário de
// atribuição de plano — a mesma lista de Empresas, duplicada. A atribuição
// passou a viver na linha da empresa, que é onde a pergunta nasce.
//
// Monitoramento veio para cá: a tela acompanha a infraestrutura COMPARTILHADA
// (relay, agentes, sessões de todas as empresas), que é assunto de plataforma e
// não de conta. O que o admin de tenant realmente usava dali — acesso iniciado
// fora do painel — passou a viver na Auditoria, junto do registro que permite
// investigar cada caso.
//
// Cupons saiu: virou aba do Financeiro. Cupom, plano e pacote de crédito são
// todas alavancas de receita, e escolher entre "30 dias de teste" e "20% por
// três meses" exige olhar o que já está entrando — em telas separadas, essa
// comparação não acontecia.
//
// Anuncios e da plataforma, nao da conta: mede o inventario do plano gratuito
// somando TODOS os tenants free, e quem le esse numero e quem negocia com
// anunciante. O tenant que exibe o anuncio nao tem o que fazer com ele.
const plataforma: NavItem[] = [
  { title: "Empresas", url: "/empresas", icon: Building2 },
  { title: "Monitoramento", url: "/monitoramento", icon: Activity },
  { title: "Anúncios", url: "/anuncios", icon: Megaphone },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (url: string) => pathname === url || pathname.startsWith(url + "/");

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      const uid = userData.user?.id;
      if (!uid) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("id, role, tenant_id")
        .eq("id", uid)
        .single();
      if (error) throw error;
      return data;
    },
  });
  const isSuper = me?.role === "super_admin";
  const isTech = me?.role === "tech";
  const itensGestao = isTech ? gestao : [...gestao, ...gestaoAdmin];

  // Único aviso de que existem pedidos de acesso esperando: não há e-mail para
  // o admin, então a contagem precisa aparecer sem ele abrir a tela.
  const podeDecidir = me?.role === "super_admin" || me?.role === "admin";
  const { data: solicitacoes } = useSolicitacoesAcesso(!!podeDecidir);
  const badges = solicitacoes?.length ? { "/usuarios": solicitacoes.length } : undefined;

  return (
    <Sidebar
      collapsible="icon"
      // Translúcida, para a coluna ler como parte do fundo. A cor de fundo mora
      // num filho interno do primitivo shadcn (`[data-sidebar=sidebar]`, com
      // `bg-sidebar` fixo), então alcançamos por variante em vez de editar o
      // primitivo — o componente segue igual para qualquer outro uso.
      // Sem `backdrop-blur`: atrás dela só passa a camada de ambiente, que já é
      // desfocada. Blur ali seria custo de GPU sem ganho visual.
      className={[
        "border-r border-border-subtle",
        "[&_[data-sidebar=sidebar]]:bg-sidebar/55",
        "[&_[data-sidebar=sidebar]]:bg-[linear-gradient(180deg,rgba(47,107,255,0.07)_0%,rgba(47,107,255,0.02)_30%,transparent_64%)]",
      ].join(" ")}
    >
      {/* Sem `border-b`: o bloco da marca e a navegação são a mesma coluna, e o
          traço no meio a partia em dois. */}
      <SidebarHeader className="px-3 h-14 justify-center">
        <div className="flex items-center gap-2.5">
          <img
            src={acessofastLogo.url}
            alt="AcessoFast"
            className="h-7 w-7 object-contain shrink-0"
          />
          {!collapsed && (
            <div className="flex flex-col leading-tight min-w-0">
              <span className="text-[13px] font-semibold text-foreground truncate">AcessoFast</span>
              <span className="text-[10px] tracking-[0.08em] text-text-dim">acesso remoto</span>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent className="px-2 py-3 gap-1">
        <NavGroup label="Operação" items={operacao} collapsed={collapsed} isActive={isActive} />
        <div className="my-1 h-px bg-border-subtle mx-2" aria-hidden />
        <NavGroup
          label="Gestão"
          items={itensGestao}
          collapsed={collapsed}
          isActive={isActive}
          badges={badges}
        />
        {isSuper && (
          <>
            <div className="my-1 h-px bg-border-subtle mx-2" aria-hidden />
            <NavGroup
              label="Plataforma"
              items={plataforma}
              collapsed={collapsed}
              isActive={isActive}
            />
          </>
        )}
      </SidebarContent>
    </Sidebar>
  );
}

function NavGroup({
  label,
  items,
  collapsed,
  isActive,
  badges,
}: {
  label: string;
  items: NavItem[];
  collapsed: boolean;
  isActive: (url: string) => boolean;
  badges?: Partial<Record<NavItem["url"], number>>;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {!collapsed && (
        <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-[0.14em] text-text-dim font-medium">
          {label}
        </div>
      )}
      <TooltipProvider delayDuration={0}>
        {items.map((item) => {
          const active = isActive(item.url);
          const badge = badges?.[item.url];
          const link = (
            <Link
              to={item.url}
              data-tour={`nav:${item.url}`}
              className={`relative flex items-center gap-2.5 rounded-md px-2 h-[36px] text-[13px] transition-colors ${
                active
                  ? "bg-primary/10 text-foreground font-medium"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
              }`}
            >
              {active && (
                <span
                  className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-primary"
                  aria-hidden
                />
              )}
              <span className="relative shrink-0">
                <item.icon
                  className={`h-4 w-4 ${active ? "text-primary" : ""}`}
                  strokeWidth={1.75}
                />
                {/* Recolhida, o número não cabe: sobra um ponto para indicar
                    que há algo esperando ali. */}
                {badge != null && collapsed && (
                  <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary" />
                )}
              </span>
              {!collapsed && <span className="truncate">{item.title}</span>}
              {badge != null && !collapsed && (
                <span className="ml-auto rounded-full bg-primary px-1.5 text-[10px] font-medium leading-[16px] text-primary-foreground">
                  {badge}
                </span>
              )}
            </Link>
          );
          if (collapsed) {
            return (
              <Tooltip key={item.url}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right" className="text-[12px]">
                  {item.title}
                  {badge != null && ` — ${badge} solicitação(ões)`}
                </TooltipContent>
              </Tooltip>
            );
          }
          return <div key={item.url}>{link}</div>;
        })}
      </TooltipProvider>
    </div>
  );
}
