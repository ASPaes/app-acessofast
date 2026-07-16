import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
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
import { PageHeader } from "@/components/ui-shell/page-header";
import { SegmentedControl } from "@/components/ui-shell/segmented-control";
import { StatusDot, type StatusTone } from "@/components/ui-shell/status-dot";
import { EmptyState } from "@/components/ui-shell/empty-state";

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
    <div className="px-6 py-6 space-y-6">
      <PageHeader
        title="Auditoria"
        description="Registro append-only das sessões de suporte. Nenhum técnico apaga um log."
        meta={
          <span className="font-mono">
            {data ? `${data.length} registro(s) · últimas 200` : "carregando…"}
          </span>
        }
        actions={
          <SegmentedControl
            value={view}
            onChange={setView}
            options={[
              { value: "grouped", label: "Por máquina" },
              { value: "flat", label: "Todas as sessões" },
            ]}
          />
        }
      />

      <section className="rounded-lg border border-border-subtle bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          {view === "flat" ? (
            <Table>
              <TableHeader>
                <TableRow className="border-border-subtle hover:bg-transparent">
                  <TableHead className="h-9 text-[10.5px] uppercase tracking-[0.12em] text-text-dim">Início</TableHead>
                  <TableHead className="h-9 text-[10.5px] uppercase tracking-[0.12em] text-text-dim">Técnico</TableHead>
                  <TableHead className="h-9 text-[10.5px] uppercase tracking-[0.12em] text-text-dim">Dispositivo</TableHead>
                  <TableHead className="h-9 text-[10.5px] uppercase tracking-[0.12em] text-text-dim">Status</TableHead>
                  <TableHead className="h-9 text-[10.5px] uppercase tracking-[0.12em] text-text-dim">Duração</TableHead>
                  <TableHead className="h-9 text-[10.5px] uppercase tracking-[0.12em] text-text-dim">IP</TableHead>
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
                    <TableCell colSpan={6} className="p-0">
                      <EmptyState icon={History} title="Nenhuma sessão registrada ainda" />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  data?.map((l) => (
                    <TableRow key={l.id} className="border-border-subtle h-12 hover:bg-surface-hover/50">
                      <TableCell className="font-mono text-[11.5px] text-muted-foreground">
                        {new Date(l.session_start).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-[12px]">{l.technician_email ?? <span className="text-text-dim">—</span>}</TableCell>
                      <TableCell className="font-mono text-[12px] text-foreground">{l.rustdesk_id}</TableCell>
                      <TableCell>
                        <StatusDot tone={statusTone(l.status)}>{statusLabel(l.status)}</StatusDot>
                      </TableCell>
                      <TableCell className="tabular-nums font-mono text-[12px]">
                        {formatDuration(l.duration_seconds)}
                      </TableCell>
                      <TableCell className="font-mono text-[11.5px] text-muted-foreground">
                        {(l.technician_ip as unknown as string) ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
            ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border-subtle hover:bg-transparent">
                  <TableHead className="h-9 w-8"></TableHead>
                  <TableHead className="h-9 text-[10.5px] uppercase tracking-[0.12em] text-text-dim">Dispositivo</TableHead>
                  <TableHead className="h-9 text-[10.5px] uppercase tracking-[0.12em] text-text-dim">Último acesso</TableHead>
                  <TableHead className="h-9 text-[10.5px] uppercase tracking-[0.12em] text-text-dim">Técnico</TableHead>
                  <TableHead className="h-9 text-right text-[10.5px] uppercase tracking-[0.12em] text-text-dim">Acessos</TableHead>
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
                    <TableCell colSpan={5} className="p-0">
                      <EmptyState icon={History} title="Nenhuma sessão registrada ainda" />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  grupos.map((g) => {
                    const aberto = expandedRustdeskId === g.rustdesk_id;
                    return (
                      <Fragment key={g.rustdesk_id}>
                        <TableRow
                          className="cursor-pointer border-border-subtle h-12 hover:bg-surface-hover/50"
                          onClick={() =>
                            setExpandedRustdeskId(aberto ? null : g.rustdesk_id)
                          }
                        >
                          <TableCell>
                            {aberto ? (
                              <ChevronDown className="h-3.5 w-3.5 text-text-dim" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-text-dim" />
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-[12px] text-foreground">{g.rustdesk_id}</TableCell>
                          <TableCell className="font-mono text-[11.5px] text-muted-foreground">
                            {new Date(g.ultimo.session_start).toLocaleString("pt-BR")}
                          </TableCell>
                          <TableCell className="text-[12px]">{g.tecnico ?? <span className="text-text-dim">—</span>}</TableCell>
                          <TableCell className="text-right tabular-nums font-mono text-[12px]">
                            {g.acessos}
                          </TableCell>
                        </TableRow>
                        {aberto && (
                          <TableRow className="border-border-subtle">
                            <TableCell colSpan={5} className="bg-surface-elevated p-0">
                              <div className="px-4 py-3 border-l-2 border-primary/40">
                                <Table>
                                  <TableHeader>
                                    <TableRow className="border-border-subtle hover:bg-transparent">
                                      <TableHead className="h-8 text-[10px] uppercase tracking-[0.12em] text-text-dim">Início</TableHead>
                                      <TableHead className="h-8 text-[10px] uppercase tracking-[0.12em] text-text-dim">Técnico</TableHead>
                                      <TableHead className="h-8 text-[10px] uppercase tracking-[0.12em] text-text-dim">Status</TableHead>
                                      <TableHead className="h-8 text-[10px] uppercase tracking-[0.12em] text-text-dim">Duração</TableHead>
                                      <TableHead className="h-8 text-[10px] uppercase tracking-[0.12em] text-text-dim">IP</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {g.sessoes.map((s) => (
                                      <TableRow key={s.id} className="border-border-subtle h-10">
                                        <TableCell className="font-mono text-[11.5px] text-muted-foreground">
                                          {new Date(s.session_start).toLocaleString("pt-BR")}
                                        </TableCell>
                                        <TableCell className="text-[12px]">
                                          {s.technician_email ?? <span className="text-text-dim">—</span>}
                                        </TableCell>
                                        <TableCell>
                                          <StatusDot tone={statusTone(s.status)}>{statusLabel(s.status)}</StatusDot>
                                        </TableCell>
                                        <TableCell className="tabular-nums font-mono text-[12px]">
                                          {formatDuration(s.duration_seconds)}
                                        </TableCell>
                                        <TableCell className="font-mono text-[11.5px] text-muted-foreground">
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
                      </Fragment>
                    );
                  })}
              </TableBody>
            </Table>
            )}
        </div>
      </section>
    </div>
  );
}

function statusTone(status: "active" | "ended" | "failed"): StatusTone {
  if (status === "active") return "active";
  if (status === "ended") return "neutral";
  return "danger";
}

function statusLabel(status: "active" | "ended" | "failed"): string {
  if (status === "active") return "ativa";
  if (status === "ended") return "encerrada";
  return "falhou";
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}