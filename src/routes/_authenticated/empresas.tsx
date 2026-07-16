import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
import { Building2 } from "lucide-react";
import { ProvisionTenantDialog } from "@/components/provision-tenant-dialog";
import { PageHeader, SectionHeader } from "@/components/ui-shell/page-header";
import { StatusDot } from "@/components/ui-shell/status-dot";
import { EmptyState } from "@/components/ui-shell/empty-state";

export const Route = createFileRoute("/_authenticated/empresas")({
  head: () => ({
    meta: [{ title: "Empresas — Acessofast" }, { name: "robots", content: "noindex" }],
  }),
  component: EmpresasPage,
});

function EmpresasPage() {
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      const uid = userData.user?.id;
      if (!uid) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("id, role, tenant_id")
        .eq("id", uid)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const isSuper = me?.role === "super_admin";

  const { data, isLoading } = useQuery({
    queryKey: ["tenants-empresas"],
    enabled: !!isSuper,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select(
          "id, name, seat_limit, is_active, created_at, profiles(count), address_book(count)",
        )
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  if (me && !isSuper) {
    return (
      <div className="px-6 py-6">
        <PageHeader title="Empresas" description="Acesso restrito à equipe da plataforma." />
      </div>
    );
  }

  return (
    <div className="px-6 py-6 space-y-6">
      <PageHeader
        title="Empresas"
        description="Empresas que utilizam o sistema."
        actions={isSuper ? <ProvisionTenantDialog /> : null}
      />

      <section className="space-y-3">
        <SectionHeader
          title="Empresas cadastradas"
          count={data ? `${data.length}` : "…"}
          hint={data ? "empresa(s)" : "carregando…"}
        />

        <div className="rounded-lg border border-border-subtle bg-surface overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border-subtle hover:bg-transparent">
                  <TableHead className="h-9 text-[10.5px] uppercase tracking-[0.12em] text-text-dim">Empresa</TableHead>
                  <TableHead className="h-9 text-[10.5px] uppercase tracking-[0.12em] text-text-dim">Membros</TableHead>
                  <TableHead className="h-9 text-[10.5px] uppercase tracking-[0.12em] text-text-dim">Dispositivos</TableHead>
                  <TableHead className="h-9 text-[10.5px] uppercase tracking-[0.12em] text-text-dim">Assentos</TableHead>
                  <TableHead className="h-9 text-[10.5px] uppercase tracking-[0.12em] text-text-dim">Status</TableHead>
                  <TableHead className="h-9 text-[10.5px] uppercase tracking-[0.12em] text-text-dim">Criada em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading &&
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                {!isLoading && (data?.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="p-0">
                      <EmptyState icon={Building2} title="Nenhuma empresa cadastrada ainda" />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  data?.map((t) => {
                    const membros = t.profiles?.[0]?.count ?? 0;
                    const dispositivos = t.address_book?.[0]?.count ?? 0;
                    return (
                      <TableRow key={t.id} className="border-border-subtle h-12 hover:bg-surface-hover/50">
                        <TableCell className="text-[13px] font-medium">{t.name}</TableCell>
                        <TableCell className="tabular-nums font-mono text-[12px]">{membros}</TableCell>
                        <TableCell className="tabular-nums font-mono text-[12px]">{dispositivos}</TableCell>
                        <TableCell className="tabular-nums font-mono text-[12px]">{t.seat_limit}</TableCell>
                        <TableCell>
                          {t.is_active ? (
                            <StatusDot tone="online">ativa</StatusDot>
                          ) : (
                            <StatusDot tone="neutral">inativa</StatusDot>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-[11.5px] text-muted-foreground">
                          {new Date(t.created_at).toLocaleDateString("pt-BR")}
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </div>
        </div>
      </section>
    </div>
  );
}