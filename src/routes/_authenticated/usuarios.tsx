import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";
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
import { Users, UserPlus, Building2, Copy, Check, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
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

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Usuários</h1>
          <p className="text-sm text-muted-foreground">
            Membros do painel. Convites e mudança de papel são operações do backend.
          </p>
        </div>
        <div className="flex gap-2">
          {me && (me.role === "super_admin" || (me.role === "admin" && me.tenant_id)) && (
            <InviteMemberDialog role={me.role} tenantId={me.tenant_id} />
          )}
        </div>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Membros
          </CardTitle>
          <CardDescription>
            {data ? `${filteredData.length} usuário(s)` : "Carregando…"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {me?.role === "super_admin" && (
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="space-y-1.5 flex-1">
                <Label htmlFor="filter-tenant" className="text-xs">
                  Empresa
                </Label>
                <Select value={tenantFilter} onValueChange={setTenantFilter}>
                  <SelectTrigger id="filter-tenant">
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
              </div>
              <div className="space-y-1.5 flex-1">
                <Label htmlFor="filter-search" className="text-xs">
                  Buscar por nome ou e-mail
                </Label>
                <Input
                  id="filter-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nome ou e-mail"
                />
              </div>
            </div>
          )}
          <div className="rounded-md border border-border/60 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Criado em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading &&
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <TableCell key={j}>
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
                    <TableRow key={u.id}>
                      <TableCell>{u.full_name ?? "—"}</TableCell>
                      <TableCell className="text-xs">{u.email ?? "—"}</TableCell>
                      <TableCell>
                        {u.tenant_id ? (
                          <span className="text-xs">{u.tenants?.name ?? "—"}</span>
                        ) : (
                          <Badge variant="outline">Plataforma</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{roleLabel[u.role] ?? u.role}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={u.is_active ? "default" : "secondary"}>
                          {u.is_active ? "ativo" : "inativo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(u.created_at).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-right">
                        {canResend(u) && u.email && u.tenant_id && (
                          <ResendInviteButton
                            email={u.email}
                            tenantId={u.tenant_id}
                            role={u.role as "tech" | "admin"}
                            fullName={u.full_name}
                          />
                        )}
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
  const [open, setOpen] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

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
    onSuccess: (data) => {
      toast.success("Convite reenviado com sucesso");
      if (data.invite_link) {
        setInviteLink(data.invite_link);
        setOpen(true);
      }
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        <Send className="h-3.5 w-3.5 mr-1" />
        {mutation.isPending ? "Enviando..." : "Reenviar convite"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convite reenviado</DialogTitle>
            <DialogDescription>
              Compartilhe este link com {email} para definir a senha.
            </DialogDescription>
          </DialogHeader>
          {inviteLink && <InviteLinkBlock link={inviteLink} />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function InviteLinkBlock({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar o link");
    }
  };
  return (
    <div className="mt-3 rounded-md border border-border/60 bg-muted/40 p-3 space-y-2">
      <p className="text-xs text-muted-foreground">
        E-mail automático não está configurado. Compartilhe este link com o convidado para
        definir a senha:
      </p>
      <div className="flex items-center gap-2">
        <Input readOnly value={link} className="text-xs" />
        <Button type="button" size="sm" variant="outline" onClick={copy}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          <span className="ml-1">{copied ? "Copiado" : "Copiar"}</span>
        </Button>
      </div>
    </div>
  );
}

function InviteMemberDialog({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"tech" | "head" | "admin">("tech");
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        mode: "add_member",
        tenant_id: tenantId,
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
    onSuccess: (data) => {
      toast.success("Convite criado com sucesso");
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      if (data.invite_link) {
        setInviteLink(data.invite_link);
      } else {
        setOpen(false);
        resetForm();
      }
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const resetForm = () => {
    setEmail("");
    setFullName("");
    setRole("tech");
    setInviteLink(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailRegex.test(email.trim())) {
      toast.error("Informe um e-mail válido");
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
          <div className="space-y-2">
            <Label htmlFor="invite-role">Papel</Label>
            <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
              <SelectTrigger id="invite-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tech">Técnico</SelectItem>
                <SelectItem value="head">Supervisor</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {inviteLink && <InviteLinkBlock link={inviteLink} />}
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

