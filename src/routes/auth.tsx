import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, ShieldCheck, Eye, EyeOff, ArrowRight } from "lucide-react";
import { toast } from "sonner";
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
  const [showPassword, setShowPassword] = useState(false);
  const [manterConectado, setManterConectado] = useState(false);

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
      <div className="hidden lg:flex relative flex-col justify-between p-12 bg-sidebar text-sidebar-foreground overflow-hidden">
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 800 800"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M-100 900 Q 150 650 400 750 T 900 500"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-primary opacity-[0.15]"
          />
          <path
            d="M-100 750 Q 200 550 450 650 T 900 400"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            className="text-primary opacity-[0.10]"
          />
        </svg>

        <div className="relative flex items-center gap-4">
          <img src={acessofastLogo.url} alt="Acessofast" className="h-24 w-24 object-contain" />
          <div className="leading-tight">
            <div className="text-2xl font-semibold">AcessoFast</div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              ASP SOFTWARES
            </div>
          </div>
        </div>

        <div className="relative space-y-4 max-w-md">
          <h1 className="text-4xl lg:text-5xl font-semibold tracking-tight text-white">
            Acesso remoto. Simples e seguro.
          </h1>
          <p className="text-muted-foreground">
            Gerencie dispositivos e acompanhe sessões em um único lugar.
          </p>
          <div className="flex items-center gap-2 pt-6">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-sm text-muted-foreground">Sistema operacional</span>
          </div>
        </div>

        <div className="relative text-[11px] text-muted-foreground">
          © {new Date().getFullYear()} ASP Softwares
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-widest text-primary">
              ÁREA ADMINISTRATIVA
            </div>
            <h2 className="text-3xl font-semibold">Bem-vindo de volta</h2>
            <p className="text-sm text-muted-foreground">
              Entre com suas credenciais para acessar o painel.
            </p>
          </div>

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
                placeholder="nome@empresa.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  placeholder="Digite sua senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="manter-conectado"
                  checked={manterConectado}
                  onCheckedChange={(checked) => setManterConectado(Boolean(checked))}
                />
                <Label htmlFor="manter-conectado" className="text-sm font-normal cursor-pointer">
                  Manter conectado
                </Label>
              </div>
              <button
                type="button"
                onClick={() =>
                  toast.info(
                    "Para redefinir sua senha, solicite um novo convite ao administrador do seu tenant."
                  )
                }
                className="text-sm text-primary hover:underline"
              >
                Esqueci minha senha
              </button>
            </div>

            <Button type="submit" className="w-full h-11" disabled={loading}>
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <>
                  Entrar no painel
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>

            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Ambiente protegido e monitorado
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function traduzirErro(msg: string): string {
  if (/invalid login|invalid credentials/i.test(msg)) return "E-mail ou senha inválidos.";
  if (/email not confirmed/i.test(msg)) return "E-mail ainda não confirmado.";
  return msg;
}
