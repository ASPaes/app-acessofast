import { type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { UserMenu } from "@/components/user-menu";
import { HealthPill } from "@/components/ui-shell/health-pill";
import { AmbientBackground } from "@/components/ui-shell/ambient-background";
import { BillingBanner } from "@/components/billing-banner";
import { OnboardingTour } from "@/components/onboarding/onboarding-tour";

const routeLabels: Record<string, string> = {
  "/dashboard": "Visão geral",
  "/dispositivos": "Dispositivos",
  "/clientes": "Clientes",
  "/auditoria": "Auditoria",
  "/usuarios": "Usuários",
  "/monitoramento": "Monitoramento",
  "/financeiro": "Financeiro",
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
        .select("name, billing_status, billing_invoice_url, past_due_since, is_trial, plan_expires_at, billing_exempt, plan_code")
        .eq("id", me!.tenant_id as string)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: activeUsers } = useQuery({
    queryKey: ["active-users-count", me?.tenant_id],
    enabled: !!me?.tenant_id && !isSuper,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", me!.tenant_id as string)
        .eq("is_active", true)
        .neq("role", "super_admin");
      if (error) throw error;
      return count ?? 0;
    },
  });

  const scopeLabel = isSuper ? "Plataforma" : tenant?.name ?? "";

  return (
    <SidebarProvider style={{ "--sidebar-width": "14rem", "--sidebar-width-icon": "4rem" } as React.CSSProperties}>
      {/* Camada de ambiente: `fixed`, atrás de tudo, sem eventos. Só existe
          dentro do shell autenticado — a tela de login não a recebe. */}
      <AmbientBackground />
      {/* `af-app` é o escopo do acabamento visual do painel (ver styles.css).
          Fica AQUI, e não no <html>, para que a tela de login — que usa os
          mesmos componentes de UI — não herde nada disso. */}
      <div className="af-app min-h-screen flex w-full text-foreground relative z-10">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          {/* Translúcida, para a barra ler como parte do fundo em vez de uma
              faixa colada por cima. Sem `backdrop-blur`: o `<main>` tem rolagem
              própria, então nada passa por baixo desta barra — atrás dela só
              existe a camada de ambiente, que já é suave. Borrar o que já está
              borrado não muda pixel e ainda obrigaria a refazer o filtro a cada
              repintura da constelação. */}
          <header className="h-14 flex items-center gap-3 border-b border-border-subtle bg-background/55 px-4">
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
              <div data-tour="user-menu" className="flex items-center">
                <UserMenu />
              </div>
            </div>
          </header>
          {/* Sem fundo próprio: a camada de ambiente precisa aparecer por trás
              do conteúdo. Quem pinta o fundo é o `body` (ver styles.css). */}
          <main className="flex-1 overflow-auto">
            {!isSuper && (
              <BillingBanner
                status={tenant?.billing_status}
                invoiceUrl={tenant?.billing_invoice_url}
                pastDueSince={tenant?.past_due_since}
                canPay={me?.role === "admin"}
                isTrial={tenant?.is_trial}
                planExpiresAt={tenant?.plan_expires_at}
                billingExempt={tenant?.billing_exempt}
                currentPlanCode={tenant?.plan_code}
                activeUsers={activeUsers}
              />
            )}
            {children}
          </main>
        </div>
      </div>
      <OnboardingTour userId={me?.id} role={me?.role} />
    </SidebarProvider>
  );
}
