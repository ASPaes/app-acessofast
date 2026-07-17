import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { UserMenu } from "@/components/user-menu";
import { HealthPill } from "@/components/ui-shell/health-pill";
import acessofastLogo from "@/assets/acessofast-logo.png.asset.json";

export function AppShell({ children }: { children: ReactNode }) {
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

  const { data: tenant } = useQuery({
    queryKey: ["tenant-name", me?.tenant_id],
    enabled: !!me?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("name")
        .eq("id", me!.tenant_id as string)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const isSuper = me?.role === "super_admin";
  const scopeLabel = isSuper ? "Plataforma" : tenant?.name ?? "";

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background text-foreground">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-3 border-b border-border/60 bg-card/40 px-4 backdrop-blur">
            <SidebarTrigger />
            <div className="flex items-center gap-2">
              <img src={acessofastLogo.url} alt="AcessoFast" className="h-6 w-6 object-contain" />
              {scopeLabel && (
                <>
                  <span className="text-sm font-medium tracking-wide text-foreground">
                    {scopeLabel}
                  </span>
                  <span className="text-xs text-muted-foreground">/</span>
                </>
              )}
              <span className="text-xs text-muted-foreground">mission control</span>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <HealthPill enabled={isSuper} />
              <UserMenu />
            </div>
          </header>
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}