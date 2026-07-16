import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Settings } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [{ title: "Configurações — Acessofast" }, { name: "robots", content: "noindex" }],
  }),
  component: ConfiguracoesPage,
});

function ConfiguracoesPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Settings className="h-6 w-6 text-primary" />
          Configurações
        </h1>
        <p className="text-sm text-muted-foreground">
          Preferências operacionais do seu tenant (fuso, retenção, alertas).
        </p>
      </div>

      <Alert>
        <AlertTitle>Em construção</AlertTitle>
        <AlertDescription>
          O formulário de edição de <code className="font-mono">tenant_settings</code> chega na
          próxima iteração. A tabela já está criada e pronta com RLS.
        </AlertDescription>
      </Alert>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Recursos habilitados</CardTitle>
          <CardDescription>
            Gestão de <code className="font-mono">tenant_features</code> pelo super_admin.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Nada a exibir ainda.
        </CardContent>
      </Card>
    </div>
  );
}