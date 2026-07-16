import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
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
    <div className="min-h-screen w-full grid lg:grid-cols-[42fr_58fr] bg-background">
      {/* IDENTIDADE */}
      <aside className="hidden lg:flex relative flex-col justify-between px-12 py-10 bg-sidebar border-r border-border-subtle">
        <div className="flex items-center gap-3">
          <img src={acessofastLogo.url} alt="Acessofast" className="h-9 w-9 object-contain" />
          <div className="leading-tight">
            <div className="text-[15px] font-semibold text-foreground">Acessofast</div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-text-dim">
              ASP Softwares
            </div>
          </div>
        </div>

        <div className="max-w-[460px] space-y-3">
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground leading-[1.15]">
            Sala de controle do seu acesso remoto.
          </h1>
          <p className="text-[13px] text-muted-foreground">
            Dispositivos, sessões e auditoria — tudo num painel denso, seguro e multi-tenant.
          </p>
          <div className="pt-3 flex items-center gap-2 text-[11px] font-mono text-text-dim">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
            RLS ativo · zero-trust por padrão
          </div>
        </div>

        <div className="text-[11px] text-text-dim">
          © {new Date().getFullYear()} ASP Softwares
        </div>
      </aside>

      {/* AUTENTICAÇÃO */}
      <section className="flex items-center justify-center px-4 py-10 lg:px-6">
        {/* Logo compacto no mobile */}
        <div className="lg:hidden absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-2">
          <img src={acessofastLogo.url} alt="Acessofast" className="h-7 w-7 object-contain" />
          <span className="text-[13px] font-semibold text-foreground">Acessofast</span>
        </div>

        <div className="w-full max-w-[420px] rounded-lg border border-border bg-surface p-8">
          <div className="mb-6 space-y-1">
            <h2 className="text-[18px] font-semibold text-foreground">Entrar no painel</h2>
            <p className="text-[12px] text-muted-foreground">
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
              <Label htmlFor="email" className="text-[12px]">E-mail corporativo</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                placeholder="voce@empresa.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-[12px]">Senha</Label>
              <Input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Entrar
            </Button>
            <p className="text-[11px] text-text-dim text-center">
              Novos usuários são criados por convite (super admin ou admin do tenant).
            </p>
          </form>
        </div>
      </section>
    </div>
  );
}

function traduzirErro(msg: string): string {
  if (/invalid login|invalid credentials/i.test(msg)) return "E-mail ou senha inválidos.";
  if (/email not confirmed/i.test(msg)) return "E-mail ainda não confirmado.";
  return msg;
}
