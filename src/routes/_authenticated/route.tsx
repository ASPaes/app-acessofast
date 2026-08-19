import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { AvisoPlanoGratuito } from "@/components/aviso-plano-gratuito";

// Gate de autenticação. `ssr: false` porque a sessão vive no localStorage
// (Supabase). O servidor não a enxerga; qualquer tentativa de proteger via SSR
// causaria loop de redirect no refresh.
export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth" });
    }
    // Quem se cadastrou pelo fluxo público e ainda não foi aprovado tem conta
    // válida mas nenhuma empresa — o painel inteiro leria vazio. Manda para a
    // sala de espera. `super_admin` também não tem empresa, e esse é legítimo.
    const { data: perfil } = await supabase
      .from("profiles")
      .select("tenant_id, role")
      .eq("id", data.user.id)
      .maybeSingle();
    if (perfil && !perfil.tenant_id && perfil.role !== "super_admin") {
      throw redirect({ to: "/aguardando-autorizacao" });
    }
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    <AppShell>
      {/* Aqui, e nao numa tela especifica: o aviso tem que alcancar quem entra
          direto em Dispositivos para trabalhar, que e o caminho comum de quem
          usa o gratuito. Quem nao e conta free nunca ve — quem decide isso e a
          RPC ad_notice_status, nao este layout. */}
      <AvisoPlanoGratuito />
      <Outlet />
    </AppShell>
  );
}
