import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { History, ChevronDown, ChevronRight } from "lucide-react";

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

  type LogRow = NonNullable<typeof data>[number];
  const [view, setView] = useState<"grouped" | "flat">("grouped");
  const [expandedRustdeskId, setExpandedRustdeskId] = useState<string | null>(null);

  const grupos = useMemo(() => {
    if (!data) return [] as {
      rustdesk_id: string;
      ultimo: LogRow;
      tecnico: string | null;
      acessos: number;
      sessoes: LogRow[];
    }[];
    const map = new Map<string, LogRow[]>();
    for (const l of data) {
      const arr = map.get(l.rustdesk_id) ?? [];
      arr.push(l);
      map.set(l.rustdesk_id, arr);
    }
    const out = Array.from(map.entries()).map(([rustdesk_id, sessoes]) => {
      const ordenadas = [...sessoes].sort(
        (a, b) => new Date(b.session_start).getTime() - new Date(a.session_start).getTime(),
      );
      const ultimo = ordenadas[0];
      const acessos = ordenadas.filter((s) => s.status === "active" || s.status === "ended").length;
      return {
        rustdesk_id,
        ultimo,
        tecnico: ultimo.technician_email ?? null,
        acessos,
        sessoes: ordenadas,
      };
    });
    out.sort(
      (a, b) =>
        new Date(b.ultimo.session_start).getTime() - new Date(a.ultimo.session_start).getTime(),
    );
    return out;
  }, [data]);

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
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <History className="h-4 w-4 text-primary" />
                Últimas 200 sessões
              </CardTitle>
              <CardDescription>
                {data ? `${data.length} registro(s)` : "Carregando…"}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={view === "grouped" ? "default" : "outline"}
                onClick={() => setView("grouped")}
              >
                Por máquina
              </Button>
              <Button
                size="sm"
                variant={view === "flat" ? "default" : "outline"}
                onClick={() => setView("flat")}
              >
                Todas as sessões
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border/60 overflow-hidden">
            {view === "flat" ? (
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
            ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Dispositivo</TableHead>
                  <TableHead>Último acesso</TableHead>
                  <TableHead>Técnico</TableHead>
                  <TableHead className="text-right">Acessos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading &&
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }).map((_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                {!isLoading && grupos.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                      Nenhuma sessão registrada ainda.
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  grupos.map((g) => {
                    const aberto = expandedRustdeskId === g.rustdesk_id;
                    return (
                      <>
                        <TableRow
                          key={g.rustdesk_id}
                          className="cursor-pointer"
                          onClick={() =>
                            setExpandedRustdeskId(aberto ? null : g.rustdesk_id)
                          }
                        >
                          <TableCell>
                            {aberto ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{g.rustdesk_id}</TableCell>
                          <TableCell className="text-xs">
                            {new Date(g.ultimo.session_start).toLocaleString("pt-BR")}
                          </TableCell>
                          <TableCell className="text-xs">{g.tecnico ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs">
                            {g.acessos}
                          </TableCell>
                        </TableRow>
                        {aberto && (
                          <TableRow key={g.rustdesk_id + ":detalhe"}>
                            <TableCell colSpan={5} className="bg-muted/30 p-0">
                              <div className="p-3">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Início</TableHead>
                                      <TableHead>Técnico</TableHead>
                                      <TableHead>Status</TableHead>
                                      <TableHead>Duração</TableHead>
                                      <TableHead>IP</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {g.sessoes.map((s) => (
                                      <TableRow key={s.id}>
                                        <TableCell className="text-xs">
                                          {new Date(s.session_start).toLocaleString("pt-BR")}
                                        </TableCell>
                                        <TableCell className="text-xs">
                                          {s.technician_email ?? "—"}
                                        </TableCell>
                                        <TableCell>
                                          <StatusBadge status={s.status} />
                                        </TableCell>
                                        <TableCell className="tabular-nums text-xs">
                                          {formatDuration(s.duration_seconds)}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs text-muted-foreground">
                                          {(s.technician_ip as unknown as string) ?? "—"}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })}
              </TableBody>
            </Table>
            )}
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