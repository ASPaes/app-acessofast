import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Hourglass, ShieldX, RefreshCw, LogOut } from "lucide-react";
import { toast } from "sonner";
import acessofastLogo from "@/assets/acessofast-logo.png.asset.json";
import { ParticleBackground } from "@/components/ParticleBackground";

// Sala de espera de quem se cadastrou com o documento de uma empresa que já
// existe. Fica fora de `_authenticated` de propósito: aquele layout monta a
// sidebar e o painel inteiro, e aqui a pessoa ainda não tem empresa — não há
// nada para mostrar. O gate de lá redireciona para cá.
export const Route = createFileRoute("/aguardando-autorizacao")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    const { data: perfil } = await supabase
      .from("profiles")
      .select("tenant_id, role")
      .eq("id", data.user.id)
      .maybeSingle();
    // Já tem empresa (ou é super_admin, que legitimamente não tem): o painel
    // está aberto para ele.
    if (perfil?.tenant_id || perfil?.role === "super_admin") {
      throw redirect({ to: "/dashboard" });
    }
  },
  head: () => ({
    meta: [
      { title: "Aguardando autorização — Acessofast" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AguardandoPage,
});

function AguardandoPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: solicitacao, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["minha-solicitacao"],
    // A aprovação acontece do outro lado da tela; sem isso a pessoa ficaria
    // apertando F5 para descobrir.
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return null;
      const { data, error } = await supabase
        .from("join_requests")
        .select("id, status, tenant_name, created_at, decided_at")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Aprovado: o perfil ganhou empresa e o painel abriu.
  useEffect(() => {
    if (solicitacao?.status === "approved") {
      toast.success("Acesso liberado.");
      navigate({ to: "/dashboard", replace: true });
    }
  }, [solicitacao?.status, navigate]);

  const reabrir = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("join-request", {
        body: { mode: "reopen" },
      });
      if (error) throw new Error(await mensagemDoErro(error));
      return data;
    },
    onSuccess: () => {
      toast.success("Solicitação enviada de novo.");
      queryClient.invalidateQueries({ queryKey: ["minha-solicitacao"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  async function sair() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const recusada = solicitacao?.status === "rejected";
  const empresa = solicitacao?.tenant_name ?? "sua empresa";

  return (
    <div className="relative min-h-screen w-full bg-background">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(148,163,184,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.05) 1px, transparent 1px), radial-gradient(circle at 20% 20%, rgba(59,130,246,0.15), transparent 40%), radial-gradient(circle at 85% 80%, rgba(37,99,235,0.10), transparent 45%)",
          backgroundSize: "46px 46px, 46px 46px, 100% 100%, 100% 100%",
        }}
      />
      <ParticleBackground />
      <div className="relative z-10 flex min-h-screen w-full items-center justify-center p-6">
        <Card className="w-full max-w-lg border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl">
          <CardContent className="space-y-6 p-8">
            <div className="flex items-center gap-3">
              <img src={acessofastLogo.url} alt="Acessofast" className="h-10 w-10 object-contain" />
              <div className="leading-tight">
                <div className="text-lg font-semibold">AcessoFast</div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  ASP Softwares
                </div>
              </div>
            </div>

            {isLoading && (
              <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Verificando sua solicitação…
              </div>
            )}

            {!isLoading && !solicitacao && (
              <div className="space-y-4">
                <h1 className="text-2xl font-semibold">Conta sem empresa</h1>
                <p className="text-sm text-muted-foreground">
                  Sua conta existe, mas ainda não está vinculada a nenhuma empresa e não há
                  solicitação em aberto. Fale com o administrador da sua empresa ou cadastre-se
                  novamente informando o CNPJ correto.
                </p>
              </div>
            )}

            {!isLoading && solicitacao && !recusada && (
              <div className="space-y-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <Hourglass className="h-5 w-5 text-primary" />
                </div>
                <h1 className="text-2xl font-semibold">Aguardando autorização</h1>
                <p className="text-sm text-muted-foreground">
                  Seu cadastro foi enviado para o administrador de <strong>{empresa}</strong>.
                  Assim que ele aprovar, seu acesso é liberado automaticamente — esta tela avisa
                  sozinha.
                </p>
                <p className="text-xs text-muted-foreground">
                  Solicitado em{" "}
                  {new Date(solicitacao.created_at).toLocaleString("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                  .
                </p>
              </div>
            )}

            {!isLoading && recusada && (
              <div className="space-y-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
                  <ShieldX className="h-5 w-5 text-destructive" />
                </div>
                <h1 className="text-2xl font-semibold">Solicitação recusada</h1>
                <Alert variant="destructive">
                  <AlertDescription>
                    O administrador de <strong>{empresa}</strong> não autorizou seu acesso. Se foi
                    engano, fale com ele e envie a solicitação de novo.
                  </AlertDescription>
                </Alert>
                <Button
                  className="w-full h-11"
                  disabled={reabrir.isPending}
                  onClick={() => reabrir.mutate()}
                >
                  {reabrir.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    "Solicitar novamente"
                  )}
                </Button>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-white/10 pt-4">
              <Button variant="ghost" size="sm" onClick={sair}>
                <LogOut className="mr-1.5 h-3.5 w-3.5" />
                Sair
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={isFetching}
                onClick={() => refetch()}
              >
                <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
                Verificar agora
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

async function mensagemDoErro(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const b = await error.context.json();
      return b?.detail ?? b?.error ?? error.message;
    } catch {
      return error.message;
    }
  }
  return (error as { message?: string })?.message ?? "Não foi possível enviar a solicitação.";
}
