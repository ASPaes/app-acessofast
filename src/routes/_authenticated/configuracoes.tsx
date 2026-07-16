import { createFileRoute } from "@tanstack/react-router";
import { Wrench, Settings } from "lucide-react";
import { PageHeader, SectionHeader } from "@/components/ui-shell/page-header";
import { EmptyState } from "@/components/ui-shell/empty-state";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [{ title: "Configurações — Acessofast" }, { name: "robots", content: "noindex" }],
  }),
  component: ConfiguracoesPage,
});

function ConfiguracoesPage() {
  return (
    <div className="px-6 py-6 space-y-6">
      <PageHeader
        title="Configurações"
        description="Preferências operacionais do seu tenant (fuso, retenção, alertas)."
      />

      <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface px-3 py-2 text-[12px] text-muted-foreground">
        <Wrench className="h-3.5 w-3.5 text-warning" strokeWidth={1.75} />
        <span className="font-medium text-foreground">Em construção.</span>
        <span>
          O formulário de edição de <code className="font-mono text-[11.5px]">tenant_settings</code>{" "}
          chega na próxima iteração. A tabela já está criada com RLS.
        </span>
      </div>

      <section className="space-y-3">
        <SectionHeader
          title="Recursos habilitados"
          hint={
            <>
              gestão de <code className="font-mono text-[11.5px]">tenant_features</code> pelo super_admin
            </>
          }
        />
        <div className="rounded-lg border border-border-subtle bg-surface">
          <EmptyState icon={Settings} title="Nada a exibir ainda" description="Nenhum recurso configurado neste tenant." compact />
        </div>
      </section>
    </div>
  );
}