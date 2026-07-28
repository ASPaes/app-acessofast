import * as React from "react";
import { NavProvider, useRota, type Rota } from "@preview/lib/router";
import { TooltipProvider } from "@preview/components/ui/overlay";
import { Sidebar } from "@preview/components/shell/sidebar";
import { Topbar } from "@preview/components/shell/topbar";
import { BillingBanner } from "@preview/components/shell/billing-banner";
import { Ambient } from "@preview/components/shell/ambient";
import { PreviewControls } from "@preview/components/shell/preview-controls";
import { PreviewProvider, usePreview } from "@preview/data/preview-state";

import { DashboardScreen } from "@preview/screens/dashboard";
import { DispositivosScreen } from "@preview/screens/dispositivos";
import { ClientesScreen } from "@preview/screens/clientes";
import { AuditoriaScreen } from "@preview/screens/auditoria";
import { UsuariosScreen } from "@preview/screens/usuarios";
import { FinanceiroScreen, PlanPicker } from "@preview/screens/financeiro";
import { MonitoramentoScreen } from "@preview/screens/monitoramento";
import { ConfiguracoesScreen } from "@preview/screens/configuracoes";
import { EmpresasScreen } from "@preview/screens/empresas";
import { PlanosScreen } from "@preview/screens/planos";
import {
  AuthScreen,
  DefinirSenhaScreen,
  ErroScreen,
  NaoEncontradaScreen,
} from "@preview/screens/auth";
import { DesignSystemScreen } from "@preview/screens/design-system";

const SEM_SHELL: Rota[] = ["/auth", "/definir-senha", "/404", "/erro"];

export default function App() {
  const [rota, navegar] = useRota();

  return (
    <PreviewProvider>
      <TooltipProvider>
        <NavProvider value={navegar}>
          {SEM_SHELL.includes(rota) ? <TelaSolta rota={rota} /> : <Shell rota={rota} />}
          <PreviewControls />
        </NavProvider>
      </TooltipProvider>
    </PreviewProvider>
  );
}

function TelaSolta({ rota }: { rota: Rota }) {
  if (rota === "/auth") return <AuthScreen />;
  if (rota === "/definir-senha") return <DefinirSenhaScreen />;
  if (rota === "/erro") return <ErroScreen />;
  return <NaoEncontradaScreen />;
}

function Shell({ rota }: { rota: Rota }) {
  const { banner, setBanner, isSuper } = usePreview();
  const [recolhida, setRecolhida] = React.useState(false);
  const [picker, setPicker] = React.useState(false);

  return (
    <div className="relative flex min-h-screen w-full bg-bg text-ink">
      {/* Camada atmosférica fixa, atrás de tudo (z-0). O conteúdo sobe pra z-10. */}
      <Ambient />

      <Sidebar rota={rota} recolhida={recolhida} onToggle={() => setRecolhida((v) => !v)} />

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <Topbar rota={rota} />

        {!isSuper && (
          <BillingBanner
            estado={banner}
            onAcao={() => {
              setPicker(true);
              setBanner("nenhum");
            }}
          />
        )}

        {/* pb extra: o botão flutuante "Preview" (só existe aqui) não pode
            cobrir a última linha da tabela. */}
        <main className="flex-1 px-4 pb-20 pt-5 sm:px-6 sm:pt-6 2xl:px-8">
          <div className="mx-auto w-full max-w-[1560px]">
            <Conteudo rota={rota} />
          </div>
        </main>
      </div>

      <PlanPicker open={picker} onClose={() => setPicker(false)} />
    </div>
  );
}

function Conteudo({ rota }: { rota: Rota }) {
  switch (rota) {
    case "/dispositivos":
      return <DispositivosScreen />;
    case "/clientes":
      return <ClientesScreen />;
    case "/auditoria":
      return <AuditoriaScreen />;
    case "/usuarios":
      return <UsuariosScreen />;
    case "/financeiro":
      return <FinanceiroScreen />;
    case "/monitoramento":
      return <MonitoramentoScreen />;
    case "/configuracoes":
      return <ConfiguracoesScreen />;
    case "/empresas":
      return <EmpresasScreen />;
    case "/planos":
      return <PlanosScreen />;
    case "/design-system":
      return <DesignSystemScreen />;
    default:
      return <DashboardScreen />;
  }
}
