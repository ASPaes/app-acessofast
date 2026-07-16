import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { UserPlus, Send, UserX, UserCheck, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/usuarios")({
  head: () => ({
    meta: [{ title: "Usuários — Acessofast" }, { name: "robots", content: "noindex" }],
  }),
  component: UsuariosPage,
});

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type InviteResult = {
  ok?: boolean;
  user_id?: string;
  tenant_id?: string;
  role?: string;
  invite_link?: string;
  error?: string;
  detail?: string;
};

async function invokeErrorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const b = await error.context.json();
      return b?.detail ?? b?.error ?? error.message;
    } catch {
      return error.message;
    }
  }
  return (error as { message?: string })?.message ?? "Erro ao chamar a função";
}

function UsuariosPage() {
  const queryClient = useQueryClient();
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

  const { data, isLoading } = useQuery({
    queryKey: ["profiles", me?.role, me?.tenant_id],
    enabled: !!me,
    queryFn: async () => {
      let query = supabase
        .from("profiles")
        .select("id, full_name, email, role, is_active, created_at, tenant_id, tenants(name)")
        .order("created_at", { ascending: false });
      if (me!.role !== "super_admin") {
        if (!me!.tenant_id) throw new Error("Perfil sem empresa vinculada");
        query = query.eq("tenant_id", me!.tenant_id);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: tenants } = useQuery({
    queryKey: ["tenants"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const [tenantFilter, setTenantFilter] = useState("all");
  const [search, setSearch] = useState("");

  const filteredData = (data ?? []).filter((u) => {
    const tenantMatch = tenantFilter === "all" || u.tenant_id === tenantFilter;
    const term = search.trim().toLowerCase();
    const searchMatch =
      !term ||
      (u.full_name ?? "").toLowerCase().includes(term) ||
      (u.email ?? "").toLowerCase().includes(term);
    return tenantMatch && searchMatch;
  });

  const roleLabel: Record<string, string> = {
    super_admin: "Super Admin",
    admin: "Admin",
    head: "Supervisor",
    tech: "Técnico",
  };

  const canResend = (u: { id: string; role: string; tenant_id: string | null }) => {
    if (!me) return false;
    if (u.id === me.id) return false;
    if (u.role === "super_admin") return false;
    if (me.role === "super_admin") return true;
    if (me.role === "admin" && me.tenant_id && u.tenant_id === me.tenant_id) return true;
    return false;
  };

  const podeAtivarDesativar = (u: { id: string; role: string; tenant_id: string | null }) => {
    if (!me) return false;
    if (u.id === me.id) return false;
    if (u.role === "super_admin") return false;
    if (me.role === "super_admin") return true;
    if (me.role === "admin" && me.tenant_id && u.tenant_id === me.tenant_id) return true;
    return false;
  };

  const toggleAtivoMutation = useMutation({
    mutationFn: async (vars: { id: string; ativar: boolean }) => {
      const { error } = await supabase.rpc("set_user_active", {
        p_user_id: vars.id,
        p_active: vars.ativar,
      });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      toast.success(vars.ativar ? "Usuário reativado" : "Usuário desativado");
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });


  return (
    <>
      <PageHeader
        title="Usuários"
        subtitle="Membros do painel. Convites e mudança de papel são operações do backend."
        actions={
          me && (me.role === "super_admin" || (me.role === "admin" && me.tenant_id)) ? (
            <InviteMemberDialog role={me.role} tenantId={me.tenant_id} />
          ) : undefined
        }
      />

      <div className="p-6 space-y-3">
        {me?.role === "super_admin" && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-72">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                id="filter-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome ou e-mail"
                className="h-9 pl-8 text-[13px]"
              />
            </div>
            <Select value={tenantFilter} onValueChange={setTenantFilter}>
              <SelectTrigger id="filter-tenant" className="w-56 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as empresas</SelectItem>
                {tenants?.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
              {data ? `${filteredData.length} usuário(s)` : "carregando…"}
            </span>
          </div>
        )}

        <div className="rounded-md border border-border/60 bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-border/60">
                <TableHead className="h-9 text-[11px] uppercase tracking-wider text-muted-foreground">Nome</TableHead>
                <TableHead className="h-9 text-[11px] uppercase tracking-wider text-muted-foreground">E-mail</TableHead>
                <TableHead className="h-9 text-[11px] uppercase tracking-wider text-muted-foreground">Empresa</TableHead>
                <TableHead className="h-9 text-[11px] uppercase tracking-wider text-muted-foreground">Papel</TableHead>
                <TableHead className="h-9 text-[11px] uppercase tracking-wider text-muted-foreground">Status</TableHead>
                <TableHead className="h-9 text-[11px] uppercase tracking-wider text-muted-foreground">Criado em</TableHead>
                <TableHead className="h-9 text-[11px] uppercase tracking-wider text-muted-foreground text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
                {isLoading &&
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i} className="border-border/60">
                      {Array.from({ length: 7 }).map((_, j) => (
                        <TableCell key={j} className="h-12">
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                {!isLoading && filteredData.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                      Nenhum usuário visível para o seu papel.
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  filteredData.map((u) => (
                    <TableRow key={u.id} className="border-border/60 h-12">
                      <TableCell className="text-[13px] font-medium">{u.full_name ?? "—"}</TableCell>
                      <TableCell className="text-[12px] text-muted-foreground">{u.email ?? "—"}</TableCell>
                      <TableCell className="text-[12px]">
                        {u.tenant_id ? (u.tenants?.name ?? "—") : (
                          <span className="text-muted-foreground">Plataforma</span>
                        )}
                      </TableCell>
                      <TableCell className="text-[12px]">{roleLabel[u.role] ?? u.role}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-[12px]">
                          <span className={cn("h-1.5 w-1.5 rounded-full", u.is_active ? "bg-emerald-400" : "bg-muted-foreground/40")} />
                          {u.is_active ? "ativo" : "inativo"}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {new Date(u.created_at).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {canResend(u) && u.email && u.tenant_id && (
                            <ResendInviteButton
                              email={u.email}
                              tenantId={u.tenant_id}
                              role={u.role as "tech" | "admin"}
                              fullName={u.full_name}
                            />
                          )}
                          {podeAtivarDesativar(u) && (
                            u.is_active ? (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button size="sm" variant="ghost" className="h-7 text-[12px]">
                                    <UserX className="h-3.5 w-3.5 mr-1" />
                                    Desativar
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Desativar usuário?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Ele deixa de conseguir obter senhas de dispositivos pelo painel. A sessão aberta dele não é encerrada e as senhas que ele já viu continuam válidas. Você pode reativá-lo depois.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => toggleAtivoMutation.mutate({ id: u.id, ativar: false })}
                                    >
                                      Desativar
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-[12px]"
                                onClick={() => toggleAtivoMutation.mutate({ id: u.id, ativar: true })}
                              >
                                <UserCheck className="h-3.5 w-3.5 mr-1" />
                                Reativar
                              </Button>
                            )
                          )}
                        </div>
                      </TableCell>

                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </>
  );
}

function ResendInviteButton({
  email,
  tenantId,
  role,
  fullName,
}: {
  email: string;
  tenantId: string;
  role: "tech" | "admin";
  fullName: string | null;
}) {
  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        mode: "resend_invite",
        tenant_id: tenantId,
        email,
        role,
        redirect_to: `${window.location.origin}/definir-senha`,
      };
      if (fullName) body.full_name = fullName;
      const { data, error } = await supabase.functions.invoke<InviteResult>("invite-user", {
        body,
      });
      if (error) throw new Error(await invokeErrorMessage(error));
      if (!data?.ok) throw new Error(data?.detail ?? data?.error ?? "Falha ao reenviar convite");
      return data;
    },
    onSuccess: () => {
      toast.success(`E-mail de redefinição enviado para ${email}`);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 text-[12px]"
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
    >
      <Send className="h-3.5 w-3.5 mr-1" />
      {mutation.isPending ? "Enviando..." : "Reenviar convite"}
    </Button>
  );
}



function InviteMemberDialog({ role: userRole, tenantId }: { role: string; tenantId: string | null }) {
  const queryClient = useQueryClient();
  const isSuper = userRole === "super_admin";
  const { data: tenants } = useQuery({
    queryKey: ["tenants"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: isSuper,
  });
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"tech" | "admin">("tech");
  const [tenantSelecionado, setTenantSelecionado] = useState<string>("");


  const mutation = useMutation({
    mutationFn: async () => {
      const efetivoTenantId = isSuper ? tenantSelecionado : tenantId;
      const body: Record<string, unknown> = {
        mode: "add_member",
        tenant_id: efetivoTenantId,
        email: email.trim(),
        role,
      };
      if (fullName.trim()) body.full_name = fullName.trim();
      body.redirect_to = `${window.location.origin}/definir-senha`;
      const { data, error } = await supabase.functions.invoke<InviteResult>("invite-user", {
        body,
      });
      if (error) throw new Error(await invokeErrorMessage(error));
      if (!data?.ok) throw new Error(data?.detail ?? data?.error ?? "Falha ao convidar");
      return data;
    },
    onSuccess: () => {
      toast.success(`Convite enviado por e-mail para ${email.trim()}`);
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      setOpen(false);
      resetForm();
    },

    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const resetForm = () => {
    setEmail("");
    setFullName("");
    setRole("tech");
    setTenantSelecionado("");
  };


  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailRegex.test(email.trim())) {
      toast.error("Informe um e-mail válido");
      return;
    }
    const efetivoTenantId = isSuper ? tenantSelecionado : tenantId;
    if (!efetivoTenantId) {
      toast.error("Selecione a empresa");
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="h-4 w-4 mr-1" />
          Convidar membro
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar membro</DialogTitle>
          <DialogDescription>
            O convidado receberá acesso ao seu tenant após definir a senha.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-email">E-mail *</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-name">Nome</Label>
            <Input
              id="invite-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          {isSuper && (
            <div className="space-y-2">
              <Label htmlFor="invite-tenant">Empresa *</Label>
              <Select value={tenantSelecionado} onValueChange={setTenantSelecionado}>
                <SelectTrigger id="invite-tenant">
                  <SelectValue placeholder="Selecione a empresa" />
                </SelectTrigger>
                <SelectContent>
                  {tenants?.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="invite-role">Papel</Label>
            <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
              <SelectTrigger id="invite-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tech">Técnico</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                resetForm();
              }}
            >
              Fechar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Enviando..." : "Convidar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

