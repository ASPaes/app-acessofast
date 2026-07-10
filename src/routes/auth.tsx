import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    <div className="min-h-screen w-full grid lg:grid-cols-2 bg-background">
      <div className="hidden lg:flex relative flex-col justify-between p-10 bg-sidebar text-sidebar-foreground overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              "linear-gradient(var(--sidebar-border) 1px, transparent 1px), linear-gradient(90deg, var(--sidebar-border) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />
        <div className="relative flex items-center gap-4">
          <img src={acessofastLogo.url} alt="Acessofast" className="h-24 w-24 object-contain" />
          <div className="leading-tight">
            <div className="text-2xl font-semibold">Acessofast</div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              ASP Softwares
            </div>
          </div>
        </div>
        <div className="relative space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight max-w-md">
            Sala de controle do seu acesso remoto.
          </h1>
          <p className="text-sm text-muted-foreground max-w-md">
            Dispositivos, sessões e auditoria — tudo num painel denso, seguro e multi-tenant.
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground pt-4">
            <ShieldCheck className="h-4 w-4 text-primary" />
            RLS ativo no banco · Zero-trust por padrão
          </div>
        </div>
        <div className="relative text-[11px] text-muted-foreground">
          © {new Date().getFullYear()} ASP Softwares
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md border-border/60">
          <CardHeader>
            <CardTitle>Entrar no painel</CardTitle>
            <CardDescription>
              Somente técnicos e administradores autorizados. Clientes finais não acessam este painel.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">E-mail corporativo</Label>
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
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
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
              <p className="text-[11px] text-muted-foreground text-center">
                Novos usuários são criados por convite (super admin ou admin do tenant).
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function traduzirErro(msg: string): string {
  if (/invalid login|invalid credentials/i.test(msg)) return "E-mail ou senha inválidos.";
  if (/email not confirmed/i.test(msg)) return "E-mail ainda não confirmado.";
  return msg;
}
