import { type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { UserMenu } from "@/components/user-menu";

const routeLabels: Record<string, string> = {
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
  const current =
    Object.entries(routeLabels).find(([p]) => pathname === p || pathname.startsWith(p + "/"))?.[1] ??
    "";

  return (
    <SidebarProvider style={{ "--sidebar-width": "14rem", "--sidebar-width-icon": "4rem" } as React.CSSProperties}>
      <div className="min-h-screen flex w-full bg-background text-foreground">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-3 border-b border-border-subtle bg-background px-4">
            <SidebarTrigger className="h-7 w-7 text-text-dim hover:text-foreground" />
            <div className="h-4 w-px bg-border-subtle" aria-hidden />
            <nav aria-label="Local" className="flex items-center gap-2 text-[13px]">
              <span className="text-text-dim">Acessofast</span>
              <span className="text-text-dim">/</span>
              <span className="font-medium text-foreground">{current}</span>
            </nav>
            <div className="ml-auto flex items-center gap-3">
              <UserMenu />
            </div>
          </header>
          <main className="flex-1 overflow-auto bg-background">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}