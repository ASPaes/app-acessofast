import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
import { Input } from "@/components/ui/input";
import { MonitorSmartphone, Search, Monitor } from "lucide-react";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/_authenticated/dispositivos")({
  head: () => ({
    meta: [{ title: "Dispositivos — Acessofast" }, { name: "robots", content: "noindex" }],
  }),
  component: DispositivosPage,
});

function DispositivosPage() {
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["address_book"],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Sessao invalida");

      const { data: profile, error: pErr } = await supabase
        .from("profiles")
        .select("role, tenant_id")
        .eq("id", uid)
        .single();
      if (pErr) throw pErr;

      let query = supabase
        .from("address_book")
        .select("id, rustdesk_id, alias, device_group, os, last_online, created_at")
        .order("created_at", { ascending: false })
        .limit(500);

      if (profile.role !== "super_admin" && profile.tenant_id) {
        query = query.eq("tenant_id", profile.tenant_id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    const t = q.trim().toLowerCase();
    if (!t) return data;
    return data.filter(
      (d) =>
        d.rustdesk_id.toLowerCase().includes(t) ||
        (d.alias ?? "").toLowerCase().includes(t) ||
        (d.device_group ?? "").toLowerCase().includes(t),
    );
  }, [data, q]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dispositivos</h1>
        <p className="text-sm text-muted-foreground">
          Endpoints RustDesk cadastrados no address book do seu tenant.
        </p>
      </div>

      <Card className="border-border/60">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <MonitorSmartphone className="h-4 w-4 text-primary" />
              Address book
            </CardTitle>
            <CardDescription>
              {data ? `${data.length} dispositivo(s)` : "Carregando…"}
            </CardDescription>
          </div>
          <div className="relative w-72">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Buscar por ID, alias, grupo…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border/60 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rustdesk ID</TableHead>
                  <TableHead>Alias</TableHead>
                  <TableHead>Grupo</TableHead>
                  <TableHead>SO</TableHead>
                  <TableHead>Últ. online</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading &&
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                {!isLoading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                      Nenhum dispositivo encontrado.
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  filtered.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-mono text-xs">{d.rustdesk_id}</TableCell>
                      <TableCell>{d.alias ?? "—"}</TableCell>
                      <TableCell>
                        {d.device_group ? (
                          <Badge variant="secondary">{d.device_group}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {d.os ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {d.last_online
                          ? new Date(d.last_online).toLocaleString("pt-BR")
                          : "nunca"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="default"
                          onClick={async () => {
                            try {
                              await supabase.rpc("log_connection_attempt", {
                                p_address_book_id: d.id,
                              });
                            } catch (e) {
                              console.error("Falha ao registrar auditoria:", e);
                            }
                            window.location.href = `rustdesk://connection/new/${d.rustdesk_id}`;
                          }}
                        >
                          <Monitor className="h-4 w-4 mr-2" />
                          Conectar
                        </Button>
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