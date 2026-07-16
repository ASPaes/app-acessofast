import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  LayoutDashboard,
  MonitorSmartphone,
  History,
  Users,
  Activity,
  Settings,
  Building2,
  ChevronsLeft,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import acessofastLogo from "@/assets/acessofast-logo.png.asset.json";

type NavItem = {
  title: string;
  url:
    | "/dashboard"
    | "/dispositivos"
    | "/auditoria"
    | "/usuarios"
    | "/monitoramento"
    | "/configuracoes"
    | "/empresas";
  icon: typeof LayoutDashboard;
};

const operacao: NavItem[] = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Dispositivos", url: "/dispositivos", icon: MonitorSmartphone },
  { title: "Auditoria", url: "/auditoria", icon: History },
];

const gestao: NavItem[] = [
  { title: "Usuários", url: "/usuarios", icon: Users },
  { title: "Monitoramento", url: "/monitoramento", icon: Activity },
  { title: "Configurações", url: "/configuracoes", icon: Settings },
];

const plataforma: NavItem[] = [
  { title: "Empresas", url: "/empresas", icon: Building2 },
];

export function AppSidebar() {
  const { state, toggleSidebar } = useSidebar();
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

  const renderItem = (item: NavItem) => {
    const active = isActive(item.url);
    return (
      <SidebarMenuItem key={item.url}>
        <SidebarMenuButton
          asChild
          isActive={active}
          tooltip={item.title}
          className={cn(
            "relative h-9 rounded-none px-3 text-[13px] text-sidebar-foreground/80 hover:bg-[#1C2532] hover:text-sidebar-foreground",
            "data-[active=true]:bg-[color:var(--sidebar-accent)] data-[active=true]:text-sidebar-foreground data-[active=true]:font-medium",
          )}
        >
          <Link to={item.url} className="flex items-center gap-2.5">
            {active && (
              <span
                aria-hidden
                className="absolute left-0 top-1 bottom-1 w-[2px] bg-primary rounded-r-sm"
              />
            )}
            <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            <span className="truncate">{item.title}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-[#1E2836]">
      <SidebarHeader className="h-14 border-b border-[#1E2836] px-3 py-0 flex-row items-center">
        <div className="flex items-center gap-2.5 h-full">
          <img
            src={acessofastLogo.url}
            alt="Acessofast"
            className="h-6 w-6 object-contain shrink-0"
          />
          {!collapsed && (
            <div className="flex flex-col leading-tight min-w-0">
              <span className="text-[13px] font-semibold tracking-tight">AcessoFast</span>
              <span className="text-[10px] text-muted-foreground truncate">acesso remoto</span>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent className="gap-0 py-2">
        <SidebarGroup className="px-0 py-1">
          <SidebarGroupLabel className="px-3 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 h-6">
            Operação
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0">{operacao.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <div className="mx-3 my-2 border-t border-[#1E2836]" />
        <SidebarGroup className="px-0 py-1">
          <SidebarGroupLabel className="px-3 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 h-6">
            Gestão
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0">{gestao.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {isSuper && (
          <>
            <div className="mx-3 my-2 border-t border-[#1E2836]" />
            <SidebarGroup className="px-0 py-1">
              <SidebarGroupLabel className="px-3 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 h-6">
                Plataforma
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0">{plataforma.map(renderItem)}</SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>
      <SidebarFooter className="border-t border-[#1E2836] p-2">
        <button
          type="button"
          onClick={toggleSidebar}
          className="flex items-center gap-2 h-8 px-2 rounded-sm text-[12px] text-muted-foreground hover:text-foreground hover:bg-[#1C2532] transition-colors"
        >
          <ChevronsLeft
            className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")}
          />
          {!collapsed && <span>Recolher menu</span>}
        </button>
      </SidebarFooter>
    </Sidebar>
  );
}