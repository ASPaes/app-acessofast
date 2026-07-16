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
import { ChevronDown, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";

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
    <>
      <PageHeader
        title="Auditoria"
        subtitle="Registro append-only das sessões de suporte. Nenhum técnico apaga um log."
      />

      <div className="p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h2 className="text-[13px] font-medium">Últimas 200 sessões</h2>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {data ? `${data.length} registro(s)` : "carregando…"}
            </span>
          </div>
          <div className="inline-flex rounded-md border border-border/60 bg-card p-0.5 text-[12px]">
            <button
              type="button"
              onClick={() => setView("grouped")}
              className={cn(
                "px-3 h-7 rounded-sm transition-colors",
                view === "grouped"
                  ? "bg-[#1C2532] text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Por máquina
            </button>
            <button
              type="button"
              onClick={() => setView("flat")}
              className={cn(
                "px-3 h-7 rounded-sm transition-colors",
                view === "flat"
                  ? "bg-[#1C2532] text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Todas as sessões
            </button>
          </div>
        </div>

        <div className="rounded-md border border-border/60 bg-card overflow-hidden">
            {view === "flat" ? (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border/60">
                  <TableHead className="h-9 text-[11px] uppercase tracking-wider text-muted-foreground">Início</TableHead>
                  <TableHead className="h-9 text-[11px] uppercase tracking-wider text-muted-foreground">Técnico</TableHead>
                  <TableHead className="h-9 text-[11px] uppercase tracking-wider text-muted-foreground">Dispositivo</TableHead>
                  <TableHead className="h-9 text-[11px] uppercase tracking-wider text-muted-foreground">Status</TableHead>
                  <TableHead className="h-9 text-[11px] uppercase tracking-wider text-muted-foreground">Duração</TableHead>
                  <TableHead className="h-9 text-[11px] uppercase tracking-wider text-muted-foreground">IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading &&
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i} className="border-border/60">
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j} className="h-11">
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
                    <TableRow key={l.id} className="border-border/60 h-11">
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {new Date(l.session_start).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-[12px]">{l.technician_email ?? "—"}</TableCell>
                      <TableCell className="font-mono text-[12px]">{l.rustdesk_id}</TableCell>
                      <TableCell>
                        <StatusPill status={l.status} />
                      </TableCell>
                      <TableCell className="tabular-nums text-[12px]">
                        {formatDuration(l.duration_seconds)}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {(l.technician_ip as unknown as string) ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
            ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border/60">
                  <TableHead className="w-8 h-9"></TableHead>
                  <TableHead className="h-9 text-[11px] uppercase tracking-wider text-muted-foreground">Dispositivo</TableHead>
                  <TableHead className="h-9 text-[11px] uppercase tracking-wider text-muted-foreground">Último acesso</TableHead>
                  <TableHead className="h-9 text-[11px] uppercase tracking-wider text-muted-foreground">Técnico</TableHead>
                  <TableHead className="h-9 text-[11px] uppercase tracking-wider text-muted-foreground text-right">Acessos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading &&
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i} className="border-border/60">
                      {Array.from({ length: 5 }).map((_, j) => (
                        <TableCell key={j} className="h-11">
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
                      <Fragment key={g.rustdesk_id}>
                        <TableRow
                          className="cursor-pointer border-border/60 h-11"
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
                          <TableCell className="font-mono text-[12px]">{g.rustdesk_id}</TableCell>
                          <TableCell className="font-mono text-[11px] text-muted-foreground">
                            {new Date(g.ultimo.session_start).toLocaleString("pt-BR")}
                          </TableCell>
                          <TableCell className="text-[12px]">{g.tecnico ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums text-[12px]">
                            {g.acessos}
                          </TableCell>
                        </TableRow>
                        {aberto && (
                          <TableRow className="border-border/60 hover:bg-transparent">
                            <TableCell colSpan={5} className="bg-[#171E29] p-0">
                              <ul className="divide-y divide-border/60">
                                {g.sessoes.map((s) => (
                                  <li key={s.id} className="grid grid-cols-12 gap-3 px-6 py-2 text-[12px] items-center">
                                    <span className="col-span-3 font-mono text-[11px] text-muted-foreground">
                                      {new Date(s.session_start).toLocaleString("pt-BR")}
                                    </span>
                                    <span className="col-span-3 truncate">{s.technician_email ?? "—"}</span>
                                    <span className="col-span-2"><StatusPill status={s.status} /></span>
                                    <span className="col-span-2 tabular-nums">{formatDuration(s.duration_seconds)}</span>
                                    <span className="col-span-2 font-mono text-[11px] text-muted-foreground text-right">
                                      {(s.technician_ip as unknown as string) ?? "—"}
                                    </span>
                                  </li>
                                ))}
                              </ul>
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
      </div>
    </>
  );
}

function StatusPill({ status }: { status: "active" | "ended" | "failed" }) {
  const map = {
    active: { label: "ativa", color: "bg-emerald-400 text-emerald-400" },
    ended: { label: "encerrada", color: "bg-muted-foreground/60 text-muted-foreground" },
    failed: { label: "falhou", color: "bg-[#E15C64] text-[#E15C64]" },
  } as const;
  const s = map[status];
  const [dot, text] = s.color.split(" ");
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px]">
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      <span className={text}>{s.label}</span>
    </span>
  );
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}