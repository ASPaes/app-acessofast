import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
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
import { Building2, ChevronRight, User } from "lucide-react";
import { ProvisionTenantDialog } from "@/components/provision-tenant-dialog";

export const Route = createFileRoute("/_authenticated/empresas")({
  head: () => ({
    meta: [{ title: "Empresas — Acessofast" }, { name: "robots", content: "noindex" }],
  }),
  component: EmpresasPage,
});

const rotuloCobranca: Record<string, string> = {
  free: "grátis",
  credits: "créditos",
  plan: "plano",
};

const rotuloPapel: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  head: "Supervisor",
  tech: "Técnico",
};

function EmpresasPage() {
  const [aberta, setAberta] = useState<string | null>(null);

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
          "id, name, seat_limit, is_active, created_at, plan_code, billing_mode, billing_status, is_trial, profiles(count), address_book(count)",
        )
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  if (me && !isSuper) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Empresas</CardTitle>
            <CardDescription>Acesso restrito à equipe da plataforma.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Conta individual é a de um assento só. Não existe coluna "tipo" em tenants,
  // e seat_limit = 1 é o que a diferencia na prática: sem assentos para gerir e
  // sem equipe para listar. Se um dia houver um campo explícito, é aqui que
  // troca — a regra está num lugar só.
  const ehIndividual = (t: { seat_limit: number }) => t.seat_limit === 1;

  const empresas = (data ?? []).filter((t) => !ehIndividual(t)).length;
  const individuais = (data ?? []).filter(ehIndividual).length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Empresas</h1>
          <p className="text-sm text-muted-foreground">
            Contas que utilizam o sistema. Abra uma conta para ver os usuários dela.
          </p>
        </div>
        <div className="flex gap-2">{isSuper && <ProvisionTenantDialog />}</div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            Contas cadastradas
          </CardTitle>
          <CardDescription>
            {data
              ? `${empresas} empresa(s) · ${individuais} individual(is)`
              : "Carregando…"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border/60 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-9" />
                  <TableHead>Conta</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Cobrança</TableHead>
                  <TableHead>Dispositivos</TableHead>
                  <TableHead>Assentos</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Criada em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading &&
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                {!isLoading && (data?.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                      Nenhuma conta cadastrada ainda.
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  data?.map((t) => {
                    const membros = t.profiles?.[0]?.count ?? 0;
                    const dispositivos = t.address_book?.[0]?.count ?? 0;
                    const individual = ehIndividual(t);
                    const on = aberta === t.id;
                    return (
                      <LinhaConta
                        key={t.id}
                        tenant={t}
                        membros={membros}
                        dispositivos={dispositivos}
                        individual={individual}
                        aberta={on}
                        onToggle={() => setAberta(on ? null : t.id)}
                      />
                    );
                  })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

type TenantLinha = {
  id: string;
  name: string;
  seat_limit: number;
  is_active: boolean;
  created_at: string;
  plan_code: string | null;
  billing_mode: string;
  billing_status: string;
  is_trial: boolean;
};

/**
 * Linha de conta + detalhe com os usuários dela.
 *
 * Conta individual não expande: tem um usuário só, que é a própria conta, e um
 * painel repetindo o nome do titular seria ruído. O chevron some em vez de ficar
 * desabilitado — controle que nunca faz nada é pior que controle ausente.
 */
function LinhaConta({
  tenant,
  membros,
  dispositivos,
  individual,
  aberta,
  onToggle,
}: {
  tenant: TenantLinha;
  membros: number;
  dispositivos: number;
  individual: boolean;
  aberta: boolean;
  onToggle: () => void;
}) {
  // Só busca os usuários quando a linha abre: em uma plataforma com muitas
  // contas, trazer todos de antemão seria uma consulta por linha sem ninguém ter
  // pedido.
  const { data: usuarios, isLoading } = useQuery({
    queryKey: ["tenant-usuarios", tenant.id],
    enabled: aberta && !individual,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, role, is_active, created_at")
        .eq("tenant_id", tenant.id)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <>
      <TableRow className={aberta ? "bg-muted/40" : undefined}>
        <TableCell className="pr-0">
          {!individual && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={onToggle}
              aria-expanded={aberta}
              aria-label={aberta ? `Recolher ${tenant.name}` : `Ver usuários de ${tenant.name}`}
            >
              <ChevronRight
                className={`h-4 w-4 transition-transform ${aberta ? "rotate-90" : ""}`}
              />
            </Button>
          )}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${
                individual ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
              }`}
            >
              {individual ? <User className="h-3.5 w-3.5" /> : <Building2 className="h-3.5 w-3.5" />}
            </span>
            <div className="min-w-0">
              <span className="block font-medium">{tenant.name}</span>
              <span className="block text-xs text-muted-foreground">
                {individual ? "conta individual" : `${membros} usuário(s)`}
              </span>
            </div>
          </div>
        </TableCell>
        <TableCell className="text-sm">
          {tenant.plan_code ?? <span className="text-muted-foreground">sem plano</span>}
        </TableCell>
        <TableCell>
          <Badge variant="outline">
            {rotuloCobranca[tenant.billing_mode] ?? tenant.billing_mode}
          </Badge>
          {tenant.is_trial && (
            <Badge variant="secondary" className="ml-1.5">
              teste
            </Badge>
          )}
        </TableCell>
        <TableCell>{dispositivos}</TableCell>
        <TableCell>
          {individual ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <>
              {membros}
              <span className="text-muted-foreground"> / {tenant.seat_limit}</span>
              {membros > tenant.seat_limit && (
                <Badge variant="destructive" className="ml-2">
                  acima
                </Badge>
              )}
            </>
          )}
        </TableCell>
        <TableCell>
          <Badge variant={tenant.is_active ? "default" : "secondary"}>
            {tenant.is_active ? "ativa" : "inativa"}
          </Badge>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {new Date(tenant.created_at).toLocaleDateString("pt-BR")}
        </TableCell>
      </TableRow>

      {aberta && !individual && (
        <TableRow className="bg-muted/40 hover:bg-muted/40">
          <TableCell colSpan={8} className="p-0">
            <div className="px-4 py-3">
              {isLoading && <Skeleton className="h-16 w-full" />}
              {!isLoading && (usuarios?.length ?? 0) === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Nenhum usuário cadastrado em {tenant.name}.
                </p>
              )}
              {!isLoading && (usuarios?.length ?? 0) > 0 && (
                <div className="rounded-md border border-border/60 bg-background overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Usuário</TableHead>
                        <TableHead>Papel</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Desde</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {usuarios?.map((u) => (
                        <TableRow key={u.id}>
                          <TableCell>
                            <span className="block text-sm">
                              {u.full_name?.trim() || (
                                <span className="text-muted-foreground">sem nome</span>
                              )}
                            </span>
                            <span className="block text-xs text-muted-foreground">{u.email}</span>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{rotuloPapel[u.role] ?? u.role}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={u.is_active ? "default" : "secondary"}>
                              {u.is_active ? "ativo" : "inativo"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(u.created_at).toLocaleDateString("pt-BR")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
