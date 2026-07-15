import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";
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
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { MonitorSmartphone, Search, Monitor, Plus, Copy, Check, Pencil, PowerOff, Power } from "lucide-react";
import { useMemo, useState } from "react";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ProvisionResult = {
  device_id?: string;
  rustdesk_id?: string;
  password?: string;
  note?: string;
  error?: string;
};

type ConnectResult = {
  rustdesk_id?: string;
  password?: string;
  deep_link?: string;
  error?: string;
};

type AddressBookRow = {
  id: string;
  rustdesk_id: string;
  alias: string | null;
  device_group: string | null;
  os: string | null;
  last_online: string | null;
  created_at: string;
  tenant_id: string | null;
  is_active: boolean;
  tenants: { name: string } | null;
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

export const Route = createFileRoute("/_authenticated/dispositivos")({
  head: () => ({
    meta: [{ title: "Dispositivos — Acessofast" }, { name: "robots", content: "noindex" }],
  }),
  component: DispositivosPage,
});

function DispositivosPage() {
  const [q, setQ] = useState("");
  const [tenantFilter, setTenantFilter] = useState<string>("all");
  const [showInativos, setShowInativos] = useState(false);
  const [editing, setEditing] = useState<AddressBookRow | null>(null);
  const [confirmInativarId, setConfirmInativarId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectData, setConnectData] = useState<{
    rustdesk_id: string;
    password: string;
    deep_link: string;
  } | null>(null);
  const [copiadoConn, setCopiadoConn] = useState(false);

  const handleConectar = async (deviceId: string) => {
    setConnectingId(deviceId);
    try {
      const { data, error } = await supabase.functions.invoke<ConnectResult>(
        "connect-device",
        { body: { device_id: deviceId } },
      );
      if (error || data?.error) {
        const raw = error ? await invokeErrorMessage(error) : (data?.error ?? "");
        if (raw.includes("sem_senha_provisionada")) {
          toast.error(
            "Dispositivo sem senha provisionada. Provisione a senha antes de conectar.",
          );
        } else if (raw.includes("device_inativo")) {
          toast.error("Dispositivo inativo. Reative-o para conectar.");
        } else {
          toast.error(raw || "Falha ao conectar");
        }
        return;
      }
      if (!data?.rustdesk_id || !data?.password || !data?.deep_link) {
        toast.error("Resposta inválida do servidor");
        return;
      }
      setConnectData({
        rustdesk_id: data.rustdesk_id,
        password: data.password,
        deep_link: data.deep_link,
      });
      setCopiadoConn(false);
    } finally {
      setConnectingId(null);
    }
  };

  const copiarSenhaConn = async () => {
    if (!connectData) return;
    try {
      await navigator.clipboard.writeText(connectData.password);
      setCopiadoConn(true);
      setTimeout(() => setCopiadoConn(false), 2000);
    } catch {
      toast.error("Não foi possível copiar a senha");
    }
  };

  const { data: perfil } = useQuery({
    queryKey: ["meu_perfil"],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("role, tenant_id")
        .eq("id", uid)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const podeAdicionar = !!perfil;
  const isSuper = perfil?.role === "super_admin";
  const podeInativar = perfil?.role === "super_admin" || perfil?.role === "admin";

  const { data: tenants } = useQuery({
    queryKey: ["tenants_lista"],
    enabled: !!isSuper,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

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
        .select("id, rustdesk_id, alias, device_group, os, last_online, created_at, tenant_id, is_active, tenants(name)")
        .order("created_at", { ascending: false })
        .limit(500);

      if (profile.role !== "super_admin") {
        if (!profile.tenant_id) throw new Error("Perfil sem empresa vinculada");
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
    return data.filter((d) => {
      if (!showInativos && d.is_active === false) return false;
      if (isSuper && tenantFilter !== "all" && d.tenant_id !== tenantFilter) return false;
      if (t) {
        const match =
          d.rustdesk_id.toLowerCase().includes(t) ||
          (d.alias ?? "").toLowerCase().includes(t) ||
          (d.device_group ?? "").toLowerCase().includes(t);
        if (!match) return false;
      }
      return true;
    });
  }, [data, q, showInativos, isSuper, tenantFilter]);

  const toggleAtivoMutation = useMutation({
    mutationFn: async (vars: { id: string; ativar: boolean }) => {
      const { error } = await supabase.rpc("set_device_active", {
        p_device_id: vars.id,
        p_active: vars.ativar,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.ativar ? "Dispositivo reativado" : "Dispositivo inativado");
      queryClient.invalidateQueries({ queryKey: ["address_book"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const colCount = isSuper ? 8 : 7;

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
          <div className="flex items-center gap-2">
            <div className="relative w-72">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Buscar por ID, alias, grupo…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            {isSuper && (
              <Select value={tenantFilter} onValueChange={setTenantFilter}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Empresa" />
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
            )}
            <div className="flex items-center gap-2 px-2">
              <Switch
                id="show-inativos"
                checked={showInativos}
                onCheckedChange={setShowInativos}
              />
              <Label htmlFor="show-inativos" className="text-xs text-muted-foreground">
                Mostrar inativos
              </Label>
            </div>
            {podeAdicionar && perfil && (
              <AdicionarDispositivoDialog
                role={perfil.role}
                tenantId={perfil.tenant_id}
              />
            )}
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
                  {isSuper && <TableHead>Empresa</TableHead>}
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading &&
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: colCount }).map((_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                {!isLoading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={colCount} className="text-center text-muted-foreground py-10">
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
                      {isSuper && (
                        <TableCell className="text-xs">
                          {d.tenants?.name ?? <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      )}
                      <TableCell>
                        {d.is_active ? (
                          <Badge>Ativo</Badge>
                        ) : (
                          <Badge variant="secondary">Inativo</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center gap-1 justify-end">
                          <Button
                            size="sm"
                            variant="default"
                            disabled={connectingId === d.id || d.is_active === false}
                            onClick={() => handleConectar(d.id)}
                          >
                            <Monitor className="h-4 w-4 mr-2" />
                            {connectingId === d.id ? "Conectando..." : "Conectar"}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Editar"
                            onClick={() => setEditing(d)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {podeInativar && (
                            d.is_active ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setConfirmInativarId(d.id)}
                                disabled={toggleAtivoMutation.isPending}
                              >
                                <PowerOff className="h-4 w-4 mr-1" />
                                Inativar
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  toggleAtivoMutation.mutate({ id: d.id, ativar: true })
                                }
                                disabled={toggleAtivoMutation.isPending}
                              >
                                <Power className="h-4 w-4 mr-1" />
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

      {editing && (
        <EditarDispositivoDialog
          device={editing}
          onClose={() => setEditing(null)}
        />
      )}

      <AlertDialog
        open={confirmInativarId !== null}
        onOpenChange={(v) => {
          if (!v) setConfirmInativarId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Inativar dispositivo?</AlertDialogTitle>
            <AlertDialogDescription>
              O dispositivo ficará indisponível para novas conexões. Você pode reativá-lo
              depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmInativarId) {
                  toggleAtivoMutation.mutate({ id: confirmInativarId, ativar: false });
                  setConfirmInativarId(null);
                }
              }}
            >
              Inativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={connectData !== null}
        onOpenChange={(v) => {
          if (!v) {
            setConnectData(null);
            setCopiadoConn(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conectar</DialogTitle>
            <DialogDescription>
              Ao abrir a conexão, o RustDesk vai pedir a senha acima. Cole-a para conectar.
            </DialogDescription>
          </DialogHeader>
          {connectData && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Rustdesk ID</Label>
                <Input readOnly value={connectData.rustdesk_id} className="font-mono text-xs" />
              </div>
              <div className="space-y-1">
                <Label>Senha</Label>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={connectData.password}
                    className="font-mono text-xs"
                  />
                  <Button type="button" size="sm" variant="outline" onClick={copiarSenhaConn}>
                    {copiadoConn ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    <span className="ml-1">{copiadoConn ? "Copiado" : "Copiar"}</span>
                  </Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConnectData(null);
                setCopiadoConn(false);
              }}
            >
              Fechar
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (connectData) window.location.href = connectData.deep_link;
              }}
            >
              <Monitor className="h-4 w-4 mr-2" />
              Abrir conexão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AdicionarDispositivoDialog({
  role,
  tenantId,
}: {
  role: string;
  tenantId: string | null;
}) {
  const queryClient = useQueryClient();
  void tenantId;
  const [open, setOpen] = useState(false);
  const [rustdeskId, setRustdeskId] = useState("");
  const [alias, setAlias] = useState("");
  const [grupo, setGrupo] = useState("");
  const [so, setSo] = useState("");
  const [tenantSelecionado, setTenantSelecionado] = useState<string>("");
  const [senhaGerada, setSenhaGerada] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const isSuper = role === "super_admin";

  const { data: tenants } = useQuery({
    queryKey: ["tenants_lista"],
    enabled: isSuper,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const resetForm = () => {
    setRustdeskId("");
    setAlias("");
    setGrupo("");
    setSo("");
    setTenantSelecionado("");
    setSenhaGerada(null);
    setCopiado(false);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const normalizado = rustdeskId.replace(/\D/g, "");
      if (!normalizado) throw new Error("Informe um Rustdesk ID válido (somente dígitos)");

      const body: Record<string, unknown> = {
        rustdesk_id: normalizado,
        alias: alias.trim() || null,
        device_group: grupo.trim() || null,
        os: so.trim() || null,
      };
      if (isSuper) {
        if (!tenantSelecionado) throw new Error("Selecione um tenant");
        body.tenant_id = tenantSelecionado;
      }

      const { data, error } = await supabase.functions.invoke<ProvisionResult>(
        "register-device",
        { body },
      );

      if (error || data?.error) {
        const raw = error ? await invokeErrorMessage(error) : (data?.error ?? "");
        if (raw.includes("device_already_registered")) {
          throw new Error("Este dispositivo (Rustdesk ID) já está cadastrado neste tenant.");
        }
        if (raw.includes("rustdesk_id_invalido")) {
          throw new Error("Rustdesk ID inválido — informe de 6 a 12 dígitos.");
        }
        throw new Error(raw || "Falha ao cadastrar dispositivo");
      }
      return { password: data?.password ?? "" };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["address_book"] });
      toast.success("Dispositivo cadastrado");
      setSenhaGerada(result.password);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  const copiarSenha = async () => {
    if (!senhaGerada) return;
    try {
      await navigator.clipboard.writeText(senhaGerada);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error("Não foi possível copiar a senha");
    }
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
          <Plus className="h-4 w-4 mr-1" />
          Adicionar dispositivo
        </Button>
      </DialogTrigger>
      <DialogContent>
        {senhaGerada ? (
          <>
            <DialogHeader>
              <DialogTitle>Senha gerada</DialogTitle>
              <DialogDescription>
                Configure esta senha como senha permanente (unattended) no client RustDesk deste
                endpoint. Ela fica guardada cifrada e pode ser recuperada depois pelo botão
                Conectar.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <Input readOnly value={senhaGerada} className="font-mono text-xs" />
              <Button type="button" size="sm" variant="outline" onClick={copiarSenha}>
                {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span className="ml-1">{copiado ? "Copiado" : "Copiar"}</span>
              </Button>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Fechar
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Adicionar dispositivo</DialogTitle>
              <DialogDescription>
                Cadastre um endpoint RustDesk. Uma senha permanente será gerada automaticamente.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="dev-rustdesk-id">Rustdesk ID *</Label>
                <Input
                  id="dev-rustdesk-id"
                  value={rustdeskId}
                  onChange={(e) => setRustdeskId(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dev-alias">Alias</Label>
                <Input
                  id="dev-alias"
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dev-grupo">Grupo</Label>
                <Input
                  id="dev-grupo"
                  value={grupo}
                  onChange={(e) => setGrupo(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dev-so">SO</Label>
                <Input id="dev-so" value={so} onChange={(e) => setSo(e.target.value)} />
              </div>
              {isSuper && (
                <div className="space-y-2">
                  <Label htmlFor="dev-tenant">Tenant *</Label>
                  <Select
                    value={tenantSelecionado}
                    onValueChange={(v) => setTenantSelecionado(v)}
                  >
                    <SelectTrigger id="dev-tenant">
                      <SelectValue placeholder="Selecione um tenant" />
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
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setOpen(false);
                    resetForm();
                  }}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? "Salvando..." : "Cadastrar"}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}