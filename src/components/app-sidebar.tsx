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
  Store,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import acessofastLogo from "@/assets/acessofast-logo.png.asset.json";

type NavItem = {
  title: string;
  url:
    | "/dashboard"
    | "/dispositivos"
    | "/clientes"
    | "/auditoria"
    | "/usuarios"
    | "/monitoramento"
    | "/configuracoes"
    | "/empresas";
  icon: typeof LayoutDashboard;
};

const operacao: NavItem[] = [
  { title: "Visão geral", url: "/dashboard", icon: LayoutDashboard },
  { title: "Dispositivos", url: "/dispositivos", icon: MonitorSmartphone },
  { title: "Clientes", url: "/clientes", icon: Store },
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

  return (
    <Sidebar collapsible="icon" className="border-r border-border-subtle bg-sidebar">
      <SidebarHeader className="border-b border-border-subtle px-3 h-14 justify-center">
        <div className="flex items-center gap-2.5">
          <img
            src={acessofastLogo.url}
            alt="AcessoFast"
            className="h-7 w-7 object-contain shrink-0"
          />
          {!collapsed && (
            <div className="flex flex-col leading-tight min-w-0">
              <span className="text-[13px] font-semibold text-foreground truncate">
                AcessoFast
              </span>
              <span className="text-[10px] tracking-[0.08em] text-text-dim">
                acesso remoto
              </span>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent className="px-2 py-3 gap-1">
        <NavGroup label="Operação" items={operacao} collapsed={collapsed} isActive={isActive} />
        <div className="my-1 h-px bg-border-subtle mx-2" aria-hidden />
        <NavGroup label="Gestão" items={gestao} collapsed={collapsed} isActive={isActive} />
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
}: {
  label: string;
  items: NavItem[];
  collapsed: boolean;
  isActive: (url: string) => boolean;
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
          const link = (
            <Link
              to={item.url}
              className={`relative flex items-center gap-2.5 rounded-md px-2 h-[36px] text-[13px] transition-colors ${
                active
                  ? "bg-primary/10 text-foreground font-medium"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-primary" aria-hidden />
              )}
              <item.icon
                className={`h-4 w-4 shrink-0 ${active ? "text-primary" : ""}`}
                strokeWidth={1.75}
              />
              {!collapsed && <span className="truncate">{item.title}</span>}
            </Link>
          );
          if (collapsed) {
            return (
              <Tooltip key={item.url}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right" className="text-[12px]">
                  {item.title}
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
