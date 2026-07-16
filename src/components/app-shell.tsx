import { type ReactNode, type CSSProperties } from "react";
import { useRouterState } from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { UserMenu } from "@/components/user-menu";

const shellStyle = {
  "--sidebar-width": "14rem",
  "--sidebar-width-icon": "4rem",
} as CSSProperties;

const routeTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/dispositivos": "Dispositivos",
  "/auditoria": "Auditoria",
  "/usuarios": "Usuários",
  "/monitoramento": "Monitoramento",
  "/configuracoes": "Configurações",
  "/empresas": "Empresas",
};

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const contextTitle =
    Object.entries(routeTitles).find(([p]) => pathname.startsWith(p))?.[1] ?? "Acessofast";

  return (
    <SidebarProvider style={shellStyle}>
      <div className="min-h-screen flex w-full bg-background text-foreground">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 shrink-0 flex items-center gap-3 border-b border-[#1E2836] bg-background px-4">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground -ml-1" />
            <div className="flex items-center gap-2 text-[13px]">
              <span className="text-muted-foreground">Acessofast</span>
              <span className="text-muted-foreground/40">/</span>
              <span className="font-medium text-foreground">{contextTitle}</span>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <UserMenu />
            </div>
          </header>
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}