import * as React from "react";
import { Settings, ToggleLeft } from "lucide-react";
import { Panel, PanelHeader, PanelBody } from "@preview/components/ui/panel";
import { PageHeader } from "@preview/components/ui/page";
import { Alert, EmptyState } from "@preview/components/ui/states";

/**
 * Configurações continua sendo a tela que já existe hoje: um aviso de
 * "em construção" e o bloco de recursos habilitados, ainda sem conteúdo.
 * Nada foi inventado aqui — só a apresentação mudou.
 */
export function ConfiguracoesScreen() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Configurações"
        description="Preferências operacionais do seu tenant (fuso, retenção, alertas)."
      />

      <Alert tone="info" title="Em construção">
        O formulário de edição de <code className="font-mono text-[12px]">tenant_settings</code>{" "}
        chega na próxima iteração. A tabela já está criada e pronta com RLS.
      </Alert>

      <Panel>
        <PanelHeader
          title="Recursos habilitados"
          icon={<Settings aria-hidden />}
          description="Gestão de tenant_features pelo super_admin."
        />
        <PanelBody>
          <EmptyState
            icon={<ToggleLeft aria-hidden />}
            title="Nada a exibir ainda"
            description="Quando houver recursos liberados para este tenant, eles aparecem listados aqui."
          />
        </PanelBody>
      </Panel>
    </div>
  );
}
