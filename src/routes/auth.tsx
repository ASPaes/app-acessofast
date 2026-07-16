import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, ShieldCheck } from "lucide-react";
import acessofastLogo from "@/assets/acessofast-logo.png.asset.json";

export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: "Entrar — Acessofast" },
      {
        name: "description",
        content: "Acesse o painel Acessofast com suas credenciais corporativas.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") navigate({ to: "/dashboard", replace: true });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(traduzirErro(error.message));
      return;
    }
    navigate({ to: "/dashboard", replace: true });
  }

  return (
    <div className="min-h-screen w-full flex bg-background">
      <aside
        className="hidden lg:flex flex-col justify-between p-10 border-r border-[#1E2836]"
        style={{ flexBasis: "42%", backgroundColor: "#0A0E14" }}
      >
        <div className="flex items-center gap-3">
          <img src={acessofastLogo.url} alt="Acessofast" className="h-9 w-9 object-contain" />
          <div className="leading-tight">
            <div className="text-[16px] font-semibold tracking-tight">AcessoFast</div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              ASP Softwares
            </div>
          </div>
        </div>
        <div className="space-y-3 max-w-md">
          <h1 className="text-[26px] font-semibold tracking-tight leading-tight">
            Sala de controle do seu acesso remoto.
          </h1>
          <p className="text-[13px] text-muted-foreground">
            Dispositivos, sessões e auditoria — tudo num painel denso, seguro e multi-tenant.
          </p>
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground pt-4">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            RLS ativo no banco · Zero-trust por padrão
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground">
          © {new Date().getFullYear()} ASP Softwares
        </div>
      </aside>

      <main
        className="flex-1 flex items-center justify-center p-6"
        style={{ backgroundColor: "#0D1117" }}
      >
        <div
          className="w-full"
          style={{
            maxWidth: 420,
            backgroundColor: "#121821",
            border: "1px solid #253041",
            borderRadius: 8,
            padding: 30,
          }}
        >
          <div className="mb-6">
            <h2 className="text-[16px] font-semibold text-foreground">Entrar no painel</h2>
            <p className="text-[12px] text-muted-foreground mt-1">
              Somente técnicos e administradores autorizados. Clientes finais não acessam este painel.
            </p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-[12px] text-muted-foreground">
                E-mail corporativo
              </Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                placeholder="voce@empresa.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-[12px] text-muted-foreground">
                Senha
              </Label>
              <Input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-10"
              />
            </div>
            <Button type="submit" className="w-full h-10" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Entrar
            </Button>
            <p className="text-[11px] text-muted-foreground text-center pt-2">
              Novos usuários são criados por convite (super admin ou admin do tenant).
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}

function traduzirErro(msg: string): string {
  if (/invalid login|invalid credentials/i.test(msg)) return "E-mail ou senha inválidos.";
  if (/email not confirmed/i.test(msg)) return "E-mail ainda não confirmado.";
  return msg;
}
