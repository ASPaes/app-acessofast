import { type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { UserMenu } from "@/components/user-menu";
import { HealthPill } from "@/components/ui-shell/health-pill";
import { BillingBanner } from "@/components/billing-banner";

const routeLabels: Record<string, string> = {
  "/dashboard": "Visão geral",
  "/dispositivos": "Dispositivos",
  "/clientes": "Clientes",
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

  const { data: tenant } = useQuery({
    queryKey: ["tenant-name", me?.tenant_id],
    enabled: !!me?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("name, billing_status, billing_invoice_url, past_due_since")
        .eq("id", me!.tenant_id as string)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const scopeLabel = isSuper ? "Plataforma" : tenant?.name ?? "";

  return (
    <SidebarProvider style={{ "--sidebar-width": "14rem", "--sidebar-width-icon": "4rem" } as React.CSSProperties}>
      <div className="min-h-screen flex w-full bg-background text-foreground">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-3 border-b border-border-subtle bg-background px-4">
            <SidebarTrigger className="h-7 w-7 text-text-dim hover:text-foreground" />
            <div className="h-4 w-px bg-border-subtle" aria-hidden />
            <nav aria-label="Local" className="flex items-center gap-2 text-[13px] min-w-0">
              {scopeLabel && (
                <>
                  <span className="text-text-dim truncate">{scopeLabel}</span>
                  <span className="text-text-dim shrink-0">/</span>
                </>
              )}
              <span className="font-medium text-foreground truncate">{current}</span>
            </nav>
            <div className="ml-auto flex items-center gap-3">
              <HealthPill enabled={isSuper} />
              <UserMenu />
            </div>
          </header>
          <main className="flex-1 overflow-auto bg-background">
            {!isSuper && (
              <BillingBanner
                status={tenant?.billing_status}
                invoiceUrl={tenant?.billing_invoice_url}
                pastDueSince={tenant?.past_due_since}
                canPay={me?.role === "admin"}
              />
            )}
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
