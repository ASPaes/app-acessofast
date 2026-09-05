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
import { Users, UserPlus, Send, UserX, UserCheck, Pencil, Check, X } from "lucide-react";
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
import { SolicitacoesAcesso } from "@/components/solicitacoes-acesso";
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

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  head: "Supervisor",
  tech: "Técnico",
};

/**
 * O que a tela deixa escolher.
 *
 * `super_admin` fica de fora por ser papel de plataforma, sem empresa: a edge
 * function recusa concedê-lo, e não adianta oferecer aqui um caminho que o
 * backend fecha. `head` (Supervisor) fica de fora por outro motivo — existe no
 * enum e o backend aceita, mas ninguém usa esse grupo, e listar um papel morto
 * só dá chance de escolher errado. O rótulo continua no ROLE_LABEL para o caso
 * de alguma conta antiga aparecer com ele.
 */
const PAPEIS_ATRIBUIVEIS = ["admin", "tech"] as const;
type PapelAtribuivel = (typeof PAPEIS_ATRIBUIVEIS)[number];

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

  // Editar nome não precisa de RPC nem de migration: a policy profiles_update
  // já cobre super_admin, o próprio usuário e o admin dentro do seu tenant, e o
  // lockdown de colunas concede update APENAS de full_name ao authenticated.
  // Qualquer tentativa de escrever outra coluna por aqui é barrada no banco.
  const podeEditarNome = (u: { id: string; role: string; tenant_id: string | null }) => {
    if (!me) return false;
    if (u.id === me.id) return true;
    if (me.role === "super_admin") return true;
    if (me.role === "admin" && me.tenant_id && u.tenant_id === me.tenant_id) return true;
    return false;
  };

  const renomearMutation = useMutation({
    mutationFn: async (vars: { id: string; nome: string }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: vars.nome })
        .eq("id", vars.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Nome atualizado");
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const semNome = (data ?? []).filter((u) => !u.full_name?.trim()).length;

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


  // Mudar papel é a única operação desta tela que passa por edge function em vez
  // de RPC: private.guard_profile_privileges() só libera profiles.role para
  // super_admin e service_role, então quem escreve é o backend — mesma razão da
  // invite-user e da join-request.
  const podeMudarPapel = (u: { id: string; role: string; tenant_id: string | null }) => {
    if (!me) return false;
    if (u.id === me.id) return false;
    if (u.role === "super_admin") return false;
    if (me.role === "super_admin") return true;
    if (me.role === "admin" && me.tenant_id && u.tenant_id === me.tenant_id) return true;
    return false;
  };

  const mudarPapelMutation = useMutation({
    mutationFn: async (vars: { id: string; papel: PapelAtribuivel }) => {
      const { data, error } = await supabase.functions.invoke<InviteResult>("set-user-role", {
        body: { user_id: vars.id, role: vars.papel },
      });
      if (error) throw new Error(await invokeErrorMessage(error));
      if (!data?.ok) throw new Error(data?.detail ?? data?.error ?? "Falha ao alterar o papel");
      return data;
    },
    onSuccess: (_data, vars) => {
      toast.success(`Papel alterado para ${ROLE_LABEL[vars.papel] ?? vars.papel}`);
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Usuários</h1>
          <p className="text-sm text-muted-foreground">
            Membros do painel. Admins convidam, ativam e trocam o papel de quem é da própria
            empresa.
          </p>
        </div>
        <div className="flex gap-2">
          {me && (me.role === "super_admin" || (me.role === "admin" && me.tenant_id)) && (
            <InviteMemberDialog role={me.role} tenantId={me.tenant_id} />
          )}
        </div>
      </div>

      <SolicitacoesAcesso
        habilitado={!!me && (me.role === "super_admin" || me.role === "admin")}
        mostrarEmpresa={me?.role === "super_admin"}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Membros
          </CardTitle>
          <CardDescription>
            {data ? `${filteredData.length} usuário(s)` : "Carregando…"}
            {semNome > 0 && (
              <>
                {" · "}
                <span className="text-amber-500">
                  {semNome} sem nome — passe o mouse na linha para corrigir
                </span>
              </>
            )}
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
                      <TableCell>
                        <NomeCell
                          nome={u.full_name}
                          editavel={podeEditarNome(u)}
                          salvando={
                            renomearMutation.isPending &&
                            renomearMutation.variables?.id === u.id
                          }
                          onSalvar={(nome) => renomearMutation.mutate({ id: u.id, nome })}
                        />
                      </TableCell>
                      <TableCell className="text-xs">{u.email ?? "—"}</TableCell>
                      <TableCell>
                        {u.tenant_id ? (
                          <span className="text-xs">{u.tenants?.name ?? "—"}</span>
                        ) : (
                          <Badge variant="outline">Plataforma</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <PapelCell
                          papel={u.role}
                          nome={u.full_name ?? u.email ?? "este usuário"}
                          editavel={podeMudarPapel(u)}
                          salvando={
                            mudarPapelMutation.isPending &&
                            mudarPapelMutation.variables?.id === u.id
                          }
                          onSalvar={(papel) => mudarPapelMutation.mutate({ id: u.id, papel })}
                        />
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
                        <div className="flex items-center justify-end gap-2">
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
                                  <Button size="sm" variant="outline">
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
                                variant="outline"
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
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Nome do usuário, editável na própria linha.
 *
 * Sem modal de propósito: é um campo só, e abrir uma janela para corrigir uma
 * palavra custa mais atenção do que a correção. Quem está sem nome ganha marca
 * visível — antes era um travessão, indistinguível de dado que faltou carregar.
 */
function NomeCell({
  nome,
  editavel,
  salvando,
  onSalvar,
}: {
  nome: string | null;
  editavel: boolean;
  salvando: boolean;
  onSalvar: (nome: string) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(nome ?? "");

  const confirmar = () => {
    const v = rascunho.trim();
    if (v && v !== nome) onSalvar(v);
    setEditando(false);
  };

  if (editando) {
    return (
      <div className="flex items-center gap-1">
        <Input
          autoFocus
          value={rascunho}
          disabled={salvando}
          className="h-8 w-44"
          aria-label="Nome do usuário"
          placeholder="Nome completo"
          onChange={(e) => setRascunho(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") confirmar();
            if (e.key === "Escape") setEditando(false);
          }}
        />
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={confirmar}
          disabled={salvando}
          aria-label="Salvar nome"
        >
          <Check className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={() => setEditando(false)}
          disabled={salvando}
          aria-label="Cancelar edição"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-1.5">
      {nome?.trim() ? (
        <span>{nome}</span>
      ) : (
        <Badge variant="outline" className="text-muted-foreground">
          sem nome
        </Badge>
      )}
      {editavel && (
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
          onClick={() => {
            setRascunho(nome ?? "");
            setEditando(true);
          }}
          aria-label={nome?.trim() ? `Editar nome de ${nome}` : "Definir nome"}
        >
          <Pencil className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

/**
 * Papel do usuário, com a promoção/rebaixamento atrás de um diálogo.
 *
 * Ao contrário do nome, aqui um clique errado dá ou tira poder — quem vira
 * Admin passa a convidar, desativar e trocar o papel dos colegas da empresa.
 * Por isso o papel novo é escolhido e confirmado numa janela que diz o que cada
 * um alcança, em vez de um select solto na linha que muda no primeiro clique.
 */
function PapelCell({
  papel,
  nome,
  editavel,
  salvando,
  onSalvar,
}: {
  papel: string;
  nome: string;
  editavel: boolean;
  salvando: boolean;
  onSalvar: (papel: PapelAtribuivel) => void;
}) {
  const [open, setOpen] = useState(false);
  const [escolha, setEscolha] = useState<PapelAtribuivel>(
    (PAPEIS_ATRIBUIVEIS as readonly string[]).includes(papel) ? (papel as PapelAtribuivel) : "tech",
  );

  const badge = <Badge variant="outline">{ROLE_LABEL[papel] ?? papel}</Badge>;
  if (!editavel) return badge;

  return (
    <div className="group flex items-center gap-1.5">
      {badge}
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (v) {
            setEscolha(
              (PAPEIS_ATRIBUIVEIS as readonly string[]).includes(papel)
                ? (papel as PapelAtribuivel)
                : "tech",
            );
          }
        }}
      >
        <DialogTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
            aria-label={`Alterar papel de ${nome}`}
          >
            <Pencil className="h-3 w-3" />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar papel</DialogTitle>
            <DialogDescription>
              {nome} é <strong>{ROLE_LABEL[papel] ?? papel}</strong> hoje. A mudança vale na próxima
              vez que ele carregar o painel.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="papel-novo">Novo papel</Label>
            <Select value={escolha} onValueChange={(v) => setEscolha(v as PapelAtribuivel)}>
              <SelectTrigger id="papel-novo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAPEIS_ATRIBUIVEIS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {escolha === "admin"
                ? "Admin administra a empresa: convida, desativa e troca o papel dos colegas, além de tudo que o técnico faz."
                : "Técnico usa o painel para acessar os dispositivos da empresa, sem administrar membros."}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={salvando || escolha === papel}
              onClick={() => {
                onSalvar(escolha);
                setOpen(false);
              }}
            >
              {salvando ? "Salvando..." : "Alterar papel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

