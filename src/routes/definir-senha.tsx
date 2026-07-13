import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/definir-senha")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Definir senha — Acessofast" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DefinirSenhaPage,
});

type Estado = "carregando" | "pronto" | "linkInvalido";

function DefinirSenhaPage() {
  const navigate = useNavigate();
  const [estado, setEstado] = useState<Estado>("carregando");
  const [erroLink, setErroLink] = useState<string>(
    "Link inválido ou expirado. Peça um novo convite ao administrador.",
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const tokenHash = sp.get("token_hash");
    const tipo = sp.get("type");
    if (tokenHash && tipo) {
      supabase.auth
        .verifyOtp({ token_hash: tokenHash, type: tipo as any })
        .then(({ error }) => {
          if (error) {
            setErroLink("Link inválido ou expirado. Peça um novo convite ao administrador.");
            setEstado("linkInvalido");
          } else {
            setEstado("pronto");
          }
        });
      return;
    }

    const hash = window.location.hash ?? "";
    if (hash.includes("error=")) {
      const params = new URLSearchParams(hash.replace(/^#/, ""));
      const desc = params.get("error_description");
      if (desc) {
        setErroLink(
          `Link inválido ou expirado (${decodeURIComponent(desc).replace(/\+/g, " ")}). Peça um novo convite ao administrador.`,
        );
      }
      setEstado("linkInvalido");
      return;
    }

    let cancelado = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelado) return;
      if (session) {
        if (timeout) clearTimeout(timeout);
        setEstado("pronto");
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (cancelado) return;
      if (data.session) {
        if (timeout) clearTimeout(timeout);
        setEstado("pronto");
      }
    });

    timeout = setTimeout(() => {
      if (cancelado) return;
      setEstado((atual) => (atual === "carregando" ? "linkInvalido" : atual));
    }, 3000);

    return () => {
      cancelado = true;
      if (timeout) clearTimeout(timeout);
      sub.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("A senha deve ter no mínimo 8 caracteres");
      return;
    }
    if (password !== confirm) {
      toast.error("As senhas não coincidem");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Senha definida com sucesso");
    navigate({ to: "/dashboard", replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md">
        {estado === "carregando" && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">Validando convite…</p>
          </div>
        )}

        {estado === "linkInvalido" && (
          <Alert variant="destructive">
            <AlertTitle>Não foi possível abrir o convite</AlertTitle>
            <AlertDescription>{erroLink}</AlertDescription>
          </Alert>
        )}

        {estado === "pronto" && (
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle>Definir senha</CardTitle>
              <CardDescription>
                Escolha uma senha para acessar o Acessofast. Mínimo de 8 caracteres.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">Nova senha</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm">Confirmar senha</Label>
                  <Input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={8}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Salvando…
                    </>
                  ) : (
                    "Definir senha"
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}