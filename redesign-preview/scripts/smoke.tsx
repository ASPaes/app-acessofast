/**
 * Smoke test de renderização do preview.
 * Renderiza cada tela com react-dom/server para pegar erro de import,
 * hook fora de provider ou filho inválido em componente do Radix.
 *
 * Uso (a partir de redesign-preview/):  bun scripts/smoke.tsx
 * Não faz parte do preview em si — é ferramenta de verificação.
 */
import { renderToString } from "react-dom/server";
import * as React from "react";

import { NavProvider } from "@preview/lib/router";
import { TooltipProvider } from "@preview/components/ui/overlay";
import { PreviewProvider, type EstadoInicial } from "@preview/data/preview-state";

import { DashboardScreen } from "@preview/screens/dashboard";
import { DispositivosScreen } from "@preview/screens/dispositivos";
import { ClientesScreen } from "@preview/screens/clientes";
import { AuditoriaScreen } from "@preview/screens/auditoria";
import { UsuariosScreen } from "@preview/screens/usuarios";
import { FinanceiroScreen } from "@preview/screens/financeiro";
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
import { Sidebar } from "@preview/components/shell/sidebar";
import { Topbar } from "@preview/components/shell/topbar";
import { BillingBanner } from "@preview/components/shell/billing-banner";
import { PreviewControls } from "@preview/components/shell/preview-controls";

const telas: Array<[string, React.ReactNode]> = [
  ["Shell · sidebar", <Sidebar rota="/dashboard" recolhida={false} onToggle={() => {}} />],
  ["Shell · sidebar recolhida", <Sidebar rota="/dispositivos" recolhida onToggle={() => {}} />],
  ["Shell · topbar", <Topbar rota="/dashboard" />],
  ["Shell · billing banner", <BillingBanner estado="past_due" />],
  ["Shell · controles do preview", <PreviewControls />],
  ["Dashboard", <DashboardScreen />],
  ["Dispositivos", <DispositivosScreen />],
  ["Clientes", <ClientesScreen />],
  ["Auditoria", <AuditoriaScreen />],
  ["Usuários", <UsuariosScreen />],
  ["Financeiro", <FinanceiroScreen />],
  ["Monitoramento", <MonitoramentoScreen />],
  ["Configurações", <ConfiguracoesScreen />],
  ["Empresas", <EmpresasScreen />],
  ["Planos", <PlanosScreen />],
  ["Login", <AuthScreen />],
  ["Definir senha", <DefinirSenhaScreen />],
  ["404", <NaoEncontradaScreen />],
  ["Erro", <ErroScreen />],
  ["Design system", <DesignSystemScreen />],
];

let falhas = 0;
let casos = 0;

function render(nome: string, node: React.ReactNode, inicial?: EstadoInicial) {
  casos++;
  try {
    const html = renderToString(
      <PreviewProvider inicial={inicial}>
        <TooltipProvider>
          <NavProvider value={() => {}}>{node}</NavProvider>
        </TooltipProvider>
      </PreviewProvider>,
    );
    if (html.length < 40) throw new Error(`saída vazia (${html.length} chars)`);
    console.log(`ok    ${nome}  (${html.length} chars)`);
  } catch (err) {
    falhas++;
    console.log(`FALHA ${nome}: ${(err as Error).message}`);
  }
}

console.log("— telas (papel admin, dados normais) —");
for (const [nome, node] of telas) render(nome, node);

console.log("\n— variações de papel —");
const porPapel: Array<[string, React.ReactNode]> = [
  ["Dashboard", <DashboardScreen />],
  ["Dispositivos", <DispositivosScreen />],
  ["Monitoramento", <MonitoramentoScreen />],
  ["Empresas", <EmpresasScreen />],
  ["Planos", <PlanosScreen />],
  ["Financeiro", <FinanceiroScreen />],
  ["Usuários", <UsuariosScreen />],
  ["Clientes", <ClientesScreen />],
];
for (const papel of ["super_admin", "admin", "head", "tech"] as const) {
  for (const [nome, node] of porPapel) render(`${papel} · ${nome}`, node, { papel });
}

console.log("\n— estados dos dados —");
for (const dados of ["carregando", "vazio", "erro"] as const) {
  for (const [nome, node] of porPapel) render(`${dados} · ${nome}`, node, { dados });
}

console.log("\n— telas de plataforma × estados —");
for (const dados of ["carregando", "vazio", "erro"] as const) {
  render(`super_admin ${dados} · Empresas`, <EmpresasScreen />, { papel: "super_admin", dados });
  render(`super_admin ${dados} · Planos`, <PlanosScreen />, { papel: "super_admin", dados });
  render(`super_admin ${dados} · Monitoramento`, <MonitoramentoScreen />, {
    papel: "super_admin",
    dados,
  });
}

console.log("\n— faixas de cobrança —");
for (const banner of [
  "trial_ativo",
  "trial_expirado",
  "vencendo",
  "past_due",
  "suspenso",
] as const) {
  render(`banner ${banner}`, <BillingBanner estado={banner} />);
  render(
    `banner ${banner} (sem permissão de pagar)`,
    <BillingBanner estado={banner} podePagar={false} />,
  );
}

console.log(
  falhas === 0
    ? `\n${casos} casos renderizados sem erro.`
    : `\n${falhas} de ${casos} casos com falha.`,
);
if (falhas > 0) process.exit(1);
