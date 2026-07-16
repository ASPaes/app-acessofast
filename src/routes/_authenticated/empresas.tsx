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
import { ProvisionTenantDialog } from "@/components/provision-tenant-dialog";
import { PageHeader } from "@/components/page-header";

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
      <>
        <PageHeader title="Empresas" subtitle="Acesso restrito à equipe da plataforma." />
        <div className="p-6 text-[13px] text-muted-foreground">Sem permissão.</div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Empresas"
        subtitle="Empresas e filiais com limites, licenças e isolamento de dados."
        actions={isSuper ? <ProvisionTenantDialog /> : undefined}
      />

      <div className="p-6">
        <section className="rounded-md border border-border/60 bg-card overflow-hidden">
          <div className="px-4 h-11 flex items-center justify-between border-b border-border/60">
            <h2 className="text-[13px] font-medium">Empresas cadastradas</h2>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {data ? `${data.length} empresa(s)` : "Carregando…"}
            </span>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-border/60">
                <TableHead className="h-9 text-[11px] uppercase tracking-wider text-muted-foreground">Empresa</TableHead>
                <TableHead className="h-9 text-[11px] uppercase tracking-wider text-muted-foreground">Membros</TableHead>
                <TableHead className="h-9 text-[11px] uppercase tracking-wider text-muted-foreground">Dispositivos</TableHead>
                <TableHead className="h-9 text-[11px] uppercase tracking-wider text-muted-foreground">Assentos</TableHead>
                <TableHead className="h-9 text-[11px] uppercase tracking-wider text-muted-foreground">Status</TableHead>
                <TableHead className="h-9 text-[11px] uppercase tracking-wider text-muted-foreground">Criada em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading &&
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i} className="border-border/60">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j} className="h-12">
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              {!isLoading && (data?.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    Nenhuma empresa cadastrada ainda.
                  </TableCell>
                </TableRow>
              )}
              {!isLoading &&
                data?.map((t) => {
                  const membros = t.profiles?.[0]?.count ?? 0;
                  const dispositivos = t.address_book?.[0]?.count ?? 0;
                  return (
                    <TableRow key={t.id} className="border-border/60 h-12">
                      <TableCell className="font-medium text-[13px]">{t.name}</TableCell>
                      <TableCell className="tabular-nums text-[13px]">{membros}</TableCell>
                      <TableCell className="tabular-nums text-[13px]">{dispositivos}</TableCell>
                      <TableCell className="tabular-nums text-[13px]">{t.seat_limit}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-[12px]">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${t.is_active ? "bg-emerald-400" : "bg-muted-foreground/40"}`}
                          />
                          {t.is_active ? "ativa" : "inativa"}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {new Date(t.created_at).toLocaleDateString("pt-BR")}
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </section>
      </div>
    </>
  );
}