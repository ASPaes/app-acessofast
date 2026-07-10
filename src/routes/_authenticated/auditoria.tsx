import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { History } from "lucide-react";

export const Route = createFileRoute("/_authenticated/auditoria")({
  head: () => ({
    meta: [{ title: "Auditoria — Acessofast" }, { name: "robots", content: "noindex" }],
  }),
  component: AuditoriaPage,
});

function AuditoriaPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["connection_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("connection_logs")
        .select(
          "id, rustdesk_id, technician_email, status, session_start, session_end, duration_seconds, technician_ip",
        )
        .order("session_start", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Auditoria</h1>
        <p className="text-sm text-muted-foreground">
          Registro append-only das sessões de suporte. Nenhum técnico apaga um log.
        </p>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            Últimas 200 sessões
          </CardTitle>
          <CardDescription>
            {data ? `${data.length} registro(s)` : "Carregando…"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border/60 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Início</TableHead>
                  <TableHead>Técnico</TableHead>
                  <TableHead>Dispositivo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duração</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading &&
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                {!isLoading && data && data.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                      Nenhuma sessão registrada ainda.
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  data?.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs">
                        {new Date(l.session_start).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-xs">{l.technician_email ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{l.rustdesk_id}</TableCell>
                      <TableCell>
                        <StatusBadge status={l.status} />
                      </TableCell>
                      <TableCell className="tabular-nums text-xs">
                        {formatDuration(l.duration_seconds)}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {(l.technician_ip as unknown as string) ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: "active" | "ended" | "failed" }) {
  const map = {
    active: { label: "ativa", variant: "default" as const },
    ended: { label: "encerrada", variant: "secondary" as const },
    failed: { label: "falhou", variant: "destructive" as const },
  };
  const s = map[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}