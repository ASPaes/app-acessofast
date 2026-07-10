import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Cpu, Gauge, HardDrive, Network } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const Route = createFileRoute("/_authenticated/monitoramento")({
  head: () => ({
    meta: [{ title: "Monitoramento — Acessofast" }, { name: "robots", content: "noindex" }],
  }),
  component: MonitoramentoPage,
});

function MonitoramentoPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Activity className="h-6 w-6 text-primary" />
          Monitoramento da VPS
        </h1>
        <p className="text-sm text-muted-foreground">
          Saúde do relay compartilhado (visível apenas para super_admin).
        </p>
      </div>

      <Alert>
        <AlertTitle>Coletor não configurado</AlertTitle>
        <AlertDescription>
          A tabela <code className="font-mono">vps_metrics</code> ainda não recebe amostras. Configure
          o agente na VPS para começar a alimentar este painel em tempo real.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {[
          { label: "CPU", icon: Cpu },
          { label: "Memória", icon: Gauge },
          { label: "Disco", icon: HardDrive },
          { label: "Rede", icon: Network },
        ].map(({ label, icon: Icon }) => (
          <Card key={label} className="border-dashed border-border/60">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground">
                {label}
              </CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-muted-foreground/60 tabular-nums">—</div>
              <p className="text-[11px] text-muted-foreground mt-1">sem amostras</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}