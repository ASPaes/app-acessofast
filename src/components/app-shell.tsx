import { type ReactNode, type CSSProperties } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { UserMenu } from "@/components/user-menu";

const shellStyle = {
  "--sidebar-width": "14rem",
  "--sidebar-width-icon": "4rem",
} as CSSProperties;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider style={shellStyle}>
      <div className="min-h-screen flex w-full bg-background text-foreground">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-3 border-b border-border/60 bg-background px-4">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
            <span className="text-[13px] font-medium tracking-tight text-foreground">
              Acessofast
            </span>
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