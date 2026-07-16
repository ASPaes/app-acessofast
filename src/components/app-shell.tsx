import { type ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { UserMenu } from "@/components/user-menu";
import acessofastLogo from "@/assets/acessofast-logo.png.asset.json";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background text-foreground">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-3 border-b border-border/60 bg-card/40 px-4 backdrop-blur">
            <SidebarTrigger />
            <div className="flex items-center gap-2">
              <img src={acessofastLogo.url} alt="Acessofast" className="h-6 w-6 object-contain" />
              <span className="text-sm font-medium tracking-wide text-foreground">
                Acessofast
              </span>
              <span className="text-xs text-muted-foreground">· mission control</span>
            </div>
            <div className="ml-auto">
              <UserMenu />
            </div>
          </header>
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}