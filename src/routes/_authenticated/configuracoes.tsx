import { createFileRoute } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [{ title: "Configurações — Acessofast" }, { name: "robots", content: "noindex" }],
  }),
  component: ConfiguracoesPage,
});

function ConfiguracoesPage() {
  return (
    <>
      <PageHeader
        title="Configurações"
        subtitle="Preferências operacionais do seu tenant (fuso, retenção, alertas)."
      />
      <div className="p-6 space-y-4 max-w-3xl">
        <Alert>
          <AlertTitle>Em construção</AlertTitle>
          <AlertDescription>
            O formulário de edição de <code className="font-mono">tenant_settings</code> chega na
            próxima iteração. A tabela já está criada e pronta com RLS.
          </AlertDescription>
        </Alert>

        <section className="rounded-md border border-border/60 bg-card">
          <div className="px-4 h-11 flex items-center border-b border-border/60">
            <h2 className="text-[13px] font-medium">Recursos habilitados</h2>
          </div>
          <div className="px-4 py-6 text-[13px] text-muted-foreground">
            Gestão de <code className="font-mono">tenant_features</code> pelo super_admin.
            Nada a exibir ainda.
          </div>
        </section>
      </div>
    </>
  );
}