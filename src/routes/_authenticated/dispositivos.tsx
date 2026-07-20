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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { MonitorSmartphone, Search, Monitor, Plus, Copy, Check, Pencil, PowerOff, Power, MoreHorizontal, Star, List, LayoutGrid, KeyRound, FolderTree, ChevronRight, ChevronDown, Tag, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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

type AdoptResult = {
  device_id?: string;
  rustdesk_id?: string;
  password?: string;
  was_inserted?: boolean;
  password_provisioned?: boolean;
  note?: string;
  hostname?: string;
  os?: string;
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

type DeviceMarker = {
  id: string;
  label: string;
  color: string | null;
};

const MARKER_COLOR_TOKENS = [
  "slate",
  "red",
  "amber",
  "green",
  "blue",
  "violet",
  "pink",
  "gray",
] as const;

const MARKER_COLOR_CLASSES: Record<string, string> = {
  slate: "bg-slate-500/15 text-slate-500 border-slate-500/30",
  red: "bg-red-500/15 text-red-500 border-red-500/30",
  amber: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  green: "bg-green-500/15 text-green-500 border-green-500/30",
  blue: "bg-blue-500/15 text-blue-500 border-blue-500/30",
  violet: "bg-violet-500/15 text-violet-500 border-violet-500/30",
  pink: "bg-pink-500/15 text-pink-500 border-pink-500/30",
  gray: "bg-gray-500/15 text-gray-500 border-gray-500/30",
};

const MARKER_DOT_CLASSES: Record<string, string> = {
  slate: "bg-slate-500",
  red: "bg-red-500",
  amber: "bg-amber-500",
  green: "bg-green-500",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  pink: "bg-pink-500",
  gray: "bg-gray-500",
};

const MARKER_FALLBACK_CLASS =
  "bg-secondary text-secondary-foreground border-transparent";

function markerClasses(color: string | null | undefined): string {
  if (!color) return MARKER_FALLBACK_CLASS;
  return MARKER_COLOR_CLASSES[color] ?? MARKER_FALLBACK_CLASS;
}

function markerDotClass(color: string | null | undefined): string {
  if (!color) return "bg-muted-foreground/40";
  return MARKER_DOT_CLASSES[color] ?? "bg-muted-foreground/40";
}

function pickMarkerColor(label: string): string {
  let sum = 0;
  for (let i = 0; i < label.length; i++) sum += label.charCodeAt(i);
  return MARKER_COLOR_TOKENS[sum % MARKER_COLOR_TOKENS.length];
}

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
  const [soFavoritos, setSoFavoritos] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "grid" | "grouped">("list");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroupExpanded = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
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
  const [confirmRedefinirId, setConfirmRedefinirId] = useState<string | null>(null);
  const [redefinindoId, setRedefinindoId] = useState<string | null>(null);
  const [senhaRedefinida, setSenhaRedefinida] = useState<{
    rustdesk_id: string;
    password: string;
  } | null>(null);
  const [copiadoRedef, setCopiadoRedef] = useState(false);

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

  const handleRedefinirSenha = async (deviceId: string) => {
    setRedefinindoId(deviceId);
    try {
      const { data, error } = await supabase.functions.invoke<ProvisionResult>(
        "provision-device-secret",
        { body: { device_id: deviceId } },
      );
      if (error || data?.error) {
        const raw = error ? await invokeErrorMessage(error) : (data?.error ?? "");
        toast.error(raw || "Falha ao redefinir a senha");
        return;
      }
      if (!data?.rustdesk_id || !data?.password) {
        toast.error("Resposta inválida do servidor");
        return;
      }
      setSenhaRedefinida({ rustdesk_id: data.rustdesk_id, password: data.password });
      setCopiadoRedef(false);
    } finally {
      setRedefinindoId(null);
    }
  };

  const copiarSenhaRedef = async () => {
    if (!senhaRedefinida) return;
    try {
      await navigator.clipboard.writeText(senhaRedefinida.password);
      setCopiadoRedef(true);
      setTimeout(() => setCopiadoRedef(false), 2000);
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

  const { data: sessoesAtivas } = useQuery({
    queryKey: ["sessoes_ativas"],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("connection_logs")
        .select("address_book_id")
        .eq("status", "active");
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.address_book_id as string));
    },
  });

  const { data: dispositivosOnline } = useQuery({
    queryKey: ["dispositivos_online"],
    refetchInterval: 30000,
    queryFn: async () => {
      const limite = new Date(Date.now() - 120000).toISOString();
      const { data, error } = await supabase
        .from("address_book")
        .select("id")
        .gt("last_online", limite);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.id as string));
    },
  });

  const { data: favoritos } = useQuery({
    queryKey: ["favoritos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("device_favorites")
        .select("device_id");
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.device_id as string));
    },
  });

  const { data: markersList } = useQuery({
    queryKey: ["device_markers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("device_markers")
        .select("id, label, color")
        .order("label");
      if (error) throw error;
      return (data ?? []) as DeviceMarker[];
    },
  });

  const markersById = useMemo(() => {
    const map = new Map<string, DeviceMarker>();
    for (const m of markersList ?? []) map.set(m.id, m);
    return map;
  }, [markersList]);

  const { data: markersByDevice } = useQuery({
    queryKey: ["device_marker_assignments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("device_marker_assignments")
        .select("device_id, marker_id");
      if (error) throw error;
      const map = new Map<string, string[]>();
      for (const row of data ?? []) {
        const list = map.get(row.device_id as string) ?? [];
        list.push(row.marker_id as string);
        map.set(row.device_id as string, list);
      }
      return map;
    },
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    const t = q.trim().toLowerCase();
    return data.filter((d) => {
      if (!showInativos && d.is_active === false) return false;
      if (soFavoritos && !favoritos?.has(d.id)) return false;
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
  }, [data, q, showInativos, isSuper, tenantFilter, soFavoritos, favoritos]);

  const escopoContagem = useMemo(() => {
    const base = data ?? [];
    return isSuper && tenantFilter !== "all"
      ? base.filter((d) => d.tenant_id === tenantFilter)
      : base;
  }, [data, isSuper, tenantFilter]);

  const contagem = useMemo(() => {
    let online = 0, offline = 0, atendimento = 0;
    for (const d of escopoContagem) {
      if (d.is_active === false) continue;
      if (sessoesAtivas?.has(d.id)) atendimento++;
      else if (dispositivosOnline?.has(d.id)) online++;
      else offline++;
    }
    return { online, offline, atendimento };
  }, [escopoContagem, sessoesAtivas, dispositivosOnline]);

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

  const toggleFavoritoMutation = useMutation({
    mutationFn: async (vars: { deviceId: string; favoritar: boolean }) => {
      if (vars.favoritar) {
        const { error } = await supabase
          .from("device_favorites")
          .upsert({ device_id: vars.deviceId }, { onConflict: "user_id,device_id", ignoreDuplicates: true });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("device_favorites")
          .delete()
          .eq("device_id", vars.deviceId);
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["favoritos"] }),
    onError: (err: Error) => toast.error(err.message),
  });

  const colCount = isSuper ? 7 : 6;

  const renderDeviceRow = (d: AddressBookRow, mostrarGrupo: boolean = true) => {
    const status =
      d.is_active === false
        ? "inativo"
        : sessoesAtivas?.has(d.id)
          ? "atendimento"
          : dispositivosOnline?.has(d.id)
            ? "online"
            : "offline";
    const iconColor =
      status === "atendimento"
        ? "text-amber-500"
        : status === "online"
          ? "text-emerald-500"
          : "text-muted-foreground/40";

    return (
      <TableRow key={d.id}>
        <TableCell>
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 shrink-0"
              title={favoritos?.has(d.id) ? "Remover dos favoritos" : "Adicionar aos favoritos"}
              onClick={() => toggleFavoritoMutation.mutate({ deviceId: d.id, favoritar: !favoritos?.has(d.id) })}
            >
              <Star className={`h-4 w-4 ${favoritos?.has(d.id) ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
            </Button>
            <Monitor className={`h-4 w-4 shrink-0 ${iconColor}`} />
            <div className="flex flex-col">
              <span className="font-medium">{d.alias ?? "—"}</span>
              <span className="font-mono text-xs text-muted-foreground">{d.rustdesk_id}</span>
              {(() => {
                const ids = markersByDevice?.get(d.id) ?? [];
                if (ids.length === 0) return null;
                return (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {ids.map((mid) => {
                      const m = markersById.get(mid);
                      if (!m) return null;
                      return (
                        <Badge
                          key={mid}
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 ${markerClasses(m.color)}`}
                        >
                          {m.label}
                        </Badge>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        </TableCell>
        {mostrarGrupo && (
          <TableCell>
            {d.device_group ? (
              <Badge variant="secondary">{d.device_group}</Badge>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </TableCell>
        )}
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
          {status === "inativo" ? (
            <Badge variant="secondary">Inativo</Badge>
          ) : status === "atendimento" ? (
            <Badge className="gap-1.5 bg-amber-500/15 text-amber-500 border-amber-500/30 hover:bg-amber-500/15">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
              Em atendimento
            </Badge>
          ) : status === "online" ? (
            <Badge className="gap-1.5 bg-emerald-500/15 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/15">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Online
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1.5 text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
              Offline
            </Badge>
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" title="Mais ações">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    navigator.clipboard.writeText(d.rustdesk_id);
                    toast.success("ID copiado");
                  }}
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Copiar ID
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setEditing(d)}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Editar
                </DropdownMenuItem>
                {podeInativar && <DropdownMenuSeparator />}
                {podeInativar &&
                  (
                    <DropdownMenuItem
                      onClick={() => setConfirmRedefinirId(d.id)}
                      disabled={redefinindoId === d.id}
                    >
                      <KeyRound className="h-4 w-4 mr-2" />
                      {redefinindoId === d.id ? "Redefinindo..." : "Redefinir senha"}
                    </DropdownMenuItem>
                  )}
                {podeInativar &&
                  (d.is_active ? (
                    <DropdownMenuItem
                      onClick={() => setConfirmInativarId(d.id)}
                      disabled={toggleAtivoMutation.isPending}
                      className="text-destructive focus:text-destructive"
                    >
                      <PowerOff className="h-4 w-4 mr-2" />
                      Inativar
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={() => toggleAtivoMutation.mutate({ id: d.id, ativar: true })}
                      disabled={toggleAtivoMutation.isPending}
                    >
                      <Power className="h-4 w-4 mr-2" />
                      Reativar
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TableCell>
      </TableRow>
    );
  };

  const grupos = useMemo(() => {
    const map = new Map<string, { label: string; devices: AddressBookRow[] }>();
    for (const d of filtered) {
      const raw = d.device_group?.trim();
      const key = raw && raw.length > 0 ? raw : "__sem_grupo__";
      const label = raw && raw.length > 0 ? raw : "Sem grupo";
      if (!map.has(key)) map.set(key, { label, devices: [] });
      map.get(key)!.devices.push(d);
    }
    const arr = Array.from(map.entries()).map(([key, v]) => {
      let online = 0, atendimento = 0, offline = 0;
      let ultimo: string | null = null;
      for (const d of v.devices) {
        if (d.is_active === false) {
          // inativos não contam nos indicadores
        } else if (sessoesAtivas?.has(d.id)) atendimento++;
        else if (dispositivosOnline?.has(d.id)) online++;
        else offline++;
        if (d.last_online && (!ultimo || d.last_online > ultimo)) ultimo = d.last_online;
      }
      return { key, label: v.label, devices: v.devices, total: v.devices.length, online, atendimento, offline, ultimo };
    });
    arr.sort((a, b) => {
      if (a.key === "__sem_grupo__") return 1;
      if (b.key === "__sem_grupo__") return -1;
      return a.label.localeCompare(b.label, "pt-BR");
    });
    return arr;
  }, [filtered, sessoesAtivas, dispositivosOnline]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dispositivos</h1>
        <p className="text-sm text-muted-foreground">
          Endpoints AcessoFast cadastrados no address book do seu tenant.
        </p>
      </div>

      <Card className="border-border/60">
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 py-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-lg font-semibold tabular-nums">{contagem.online}</span>
            <span className="text-sm text-muted-foreground">online</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="text-lg font-semibold tabular-nums">{contagem.atendimento}</span>
            <span className="text-sm text-muted-foreground">em atendimento</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
            <span className="text-lg font-semibold tabular-nums">{contagem.offline}</span>
            <span className="text-sm text-muted-foreground">offline</span>
          </div>
        </CardContent>
      </Card>

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
                id="so-favoritos"
                checked={soFavoritos}
                onCheckedChange={setSoFavoritos}
              />
              <Label htmlFor="so-favoritos" className="text-xs text-muted-foreground flex items-center gap-1">
                <Star className="h-3 w-3" />
                Só favoritos
              </Label>
            </div>
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
            <div className="flex items-center rounded-md border border-border/60">
              <Button
                size="icon"
                variant={viewMode === "list" ? "secondary" : "ghost"}
                className="h-8 w-8 rounded-r-none"
                title="Lista"
                onClick={() => setViewMode("list")}
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant={viewMode === "grid" ? "secondary" : "ghost"}
                className="h-8 w-8 rounded-none"
                title="Grade"
                onClick={() => setViewMode("grid")}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant={viewMode === "grouped" ? "secondary" : "ghost"}
                className="h-8 w-8 rounded-l-none"
                title="Agrupar por grupo"
                onClick={() => setViewMode("grouped")}
              >
                <FolderTree className="h-4 w-4" />
              </Button>
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
          {viewMode === "list" ? (
          <div className="rounded-md border border-border/60 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Computador</TableHead>
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
                  filtered.map((d) => renderDeviceRow(d, true))}
              </TableBody>
            </Table>
          </div>
          ) : viewMode === "grid" ? (
            isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-56 w-full rounded-lg" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-10 text-center">
              Nenhum dispositivo encontrado.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filtered.map((d) => {
                const status =
                  d.is_active === false
                    ? "inativo"
                    : sessoesAtivas?.has(d.id)
                      ? "atendimento"
                      : dispositivosOnline?.has(d.id)
                        ? "online"
                        : "offline";
                const iconColor =
                  status === "atendimento"
                    ? "text-amber-500"
                    : status === "online"
                      ? "text-emerald-500"
                      : "text-muted-foreground/40";
                return (
                  <div key={d.id} className="rounded-lg border border-border/60 bg-muted/20 p-4 flex flex-col gap-3">
                    <div className="flex items-start justify-between">
                      <div className={`h-9 w-9 rounded-lg bg-muted/40 flex items-center justify-center ${iconColor}`}>
                        <Monitor className="h-5 w-5" />
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title={favoritos?.has(d.id) ? "Remover dos favoritos" : "Adicionar aos favoritos"}
                        onClick={() => toggleFavoritoMutation.mutate({ deviceId: d.id, favoritar: !favoritos?.has(d.id) })}
                      >
                        <Star className={`h-4 w-4 ${favoritos?.has(d.id) ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                      </Button>
                    </div>
                    <div className="flex flex-col">
                      <span className="font-medium truncate">{d.alias ?? "—"}</span>
                      <span className="font-mono text-xs text-muted-foreground">{d.rustdesk_id}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      {status === "inativo" ? (
                        <Badge variant="secondary">Inativo</Badge>
                      ) : status === "atendimento" ? (
                        <Badge className="gap-1.5 bg-amber-500/15 text-amber-500 border-amber-500/30 hover:bg-amber-500/15">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                          Em atendimento
                        </Badge>
                      ) : status === "online" ? (
                        <Badge className="gap-1.5 bg-emerald-500/15 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/15">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          Online
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1.5 text-muted-foreground">
                          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                          Offline
                        </Badge>
                      )}
                      {d.device_group && <Badge variant="secondary">{d.device_group}</Badge>}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs border-t border-border/60 pt-3">
                      <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">SO</span>
                        <span className="text-muted-foreground">{d.os ?? "—"}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Últ. online</span>
                        <span className="text-muted-foreground tabular-nums">
                          {d.last_online ? new Date(d.last_online).toLocaleString("pt-BR") : "nunca"}
                        </span>
                      </div>
                      {isSuper && (
                        <div className="flex flex-col col-span-2">
                          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Empresa</span>
                          <span className="text-muted-foreground">{d.tenants?.name ?? "—"}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 pt-1">
                      <Button
                        size="sm"
                        variant="default"
                        className="flex-1"
                        disabled={connectingId === d.id || d.is_active === false}
                        onClick={() => handleConectar(d.id)}
                      >
                        <Monitor className="h-4 w-4 mr-2" />
                        {connectingId === d.id ? "Conectando..." : "Conectar"}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" title="Mais ações">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              navigator.clipboard.writeText(d.rustdesk_id);
                              toast.success("ID copiado");
                            }}
                          >
                            <Copy className="h-4 w-4 mr-2" />
                            Copiar ID
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setEditing(d)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Editar
                          </DropdownMenuItem>
                          {podeInativar && <DropdownMenuSeparator />}
                          {podeInativar &&
                            (
                              <DropdownMenuItem
                                onClick={() => setConfirmRedefinirId(d.id)}
                                disabled={redefinindoId === d.id}
                              >
                                <KeyRound className="h-4 w-4 mr-2" />
                                {redefinindoId === d.id ? "Redefinindo..." : "Redefinir senha"}
                              </DropdownMenuItem>
                            )}
                          {podeInativar &&
                            (d.is_active ? (
                              <DropdownMenuItem
                                onClick={() => setConfirmInativarId(d.id)}
                                disabled={toggleAtivoMutation.isPending}
                                className="text-destructive focus:text-destructive"
                              >
                                <PowerOff className="h-4 w-4 mr-2" />
                                Inativar
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() => toggleAtivoMutation.mutate({ id: d.id, ativar: true })}
                                disabled={toggleAtivoMutation.isPending}
                              >
                                <Power className="h-4 w-4 mr-2" />
                                Reativar
                              </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
            </div>
          )
          ) : (
            isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-56 w-full rounded-lg" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-10 text-center">
                Nenhum dispositivo encontrado.
              </p>
            ) : (
              <div className="space-y-3">
                {grupos.map((g) => {
                  const aberto = expandedGroups.has(g.key);
                  return (
                    <div key={g.key} className="rounded-lg border border-border/60 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggleGroupExpanded(g.key)}
                        className="w-full flex items-center gap-3 px-4 py-3 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
                      >
                        {aberto ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                        <span className="font-medium">{g.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {g.total} dispositivo{g.total === 1 ? "" : "s"}
                        </span>
                        <div className="flex items-center gap-3 ml-4">
                          <div className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-emerald-500" />
                            <span className="text-sm tabular-nums">{g.online}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-amber-500" />
                            <span className="text-sm tabular-nums">{g.atendimento}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                            <span className="text-sm tabular-nums">{g.offline}</span>
                          </div>
                        </div>
                        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                          últ. acesso: {g.ultimo ? new Date(g.ultimo).toLocaleString("pt-BR") : "nunca"}
                        </span>
                      </button>
                      {aberto && (
                        <div className="border-t border-border/60">
                          <Table>
                            <TableBody>
                              {g.devices.map((d) => renderDeviceRow(d, false))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )}
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
              Ao abrir a conexão, o AcessoFast vai pedir a senha acima. Cole-a para conectar.
            </DialogDescription>
          </DialogHeader>
          {connectData && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>ID AcessoFast</Label>
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

      <AlertDialog
        open={confirmRedefinirId !== null}
        onOpenChange={(v) => {
          if (!v) setConfirmRedefinirId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Redefinir senha de acesso?</AlertDialogTitle>
            <AlertDialogDescription>
              Uma nova senha permanente será gerada. A senha atual deixará de funcionar
              até você aplicá-la como senha permanente no computador. Continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmRedefinirId) {
                  const id = confirmRedefinirId;
                  setConfirmRedefinirId(null);
                  void handleRedefinirSenha(id);
                }
              }}
            >
              Redefinir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={senhaRedefinida !== null}
        onOpenChange={(v) => {
          if (!v) {
            setSenhaRedefinida(null);
            setCopiadoRedef(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova senha gerada</DialogTitle>
            <DialogDescription>
              Aplique esta senha como senha permanente (unattended) no client AcessoFast
              deste computador. A senha anterior não funciona mais.
            </DialogDescription>
          </DialogHeader>
          {senhaRedefinida && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>ID AcessoFast</Label>
                <Input readOnly value={senhaRedefinida.rustdesk_id} className="font-mono text-xs" />
              </div>
              <div className="space-y-1">
                <Label>Nova senha</Label>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={senhaRedefinida.password}
                    className="font-mono text-xs"
                  />
                  <Button type="button" size="sm" variant="outline" onClick={copiarSenhaRedef}>
                    {copiadoRedef ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    <span className="ml-1">{copiadoRedef ? "Copiado" : "Copiar"}</span>
                  </Button>
                </div>
              </div>
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
                Aplique esta senha como senha permanente (unattended) no client AcessoFast
                deste computador. A senha anterior não funciona mais.
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSenhaRedefinida(null);
                setCopiadoRedef(false);
              }}
            >
              Fechar
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
  const [open, setOpen] = useState(false);
  const [rustdeskId, setRustdeskId] = useState("");
  const [alias, setAlias] = useState("");
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
      };
      if (isSuper) {
        if (!tenantSelecionado) throw new Error("Selecione um tenant");
        body.tenant_id = tenantSelecionado;
      }

      const { data, error } = await supabase.functions.invoke<AdoptResult>(
        "adopt-device",
        { body },
      );

      if (error || data?.error) {
        const raw = error ? await invokeErrorMessage(error) : (data?.error ?? "");
        if (raw.includes("no_pending_claim")) {
          throw new Error(
            "Esse computador ainda não apareceu aqui. Confirme que o cliente instalou o AcessoFast e está online, depois leia o ID de novo.",
          );
        }
        if (raw.includes("rustdesk_id_invalido")) {
          throw new Error("Rustdesk ID inválido — informe de 6 a 12 dígitos.");
        }
        throw new Error(raw || "Falha ao adotar dispositivo");
      }
      return data ?? {};
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["address_book"] });
      if (data.was_inserted && data.password_provisioned && data.password) {
        setSenhaGerada(data.password);
        return;
      }
      if (data.was_inserted) {
        toast.success(data.note ?? "Computador adotado");
      } else {
        toast.success("Computador reconectado — já estava cadastrado, agente atualizado.");
      }
      setOpen(false);
      resetForm();
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
                Configure esta senha como senha permanente (unattended) no client AcessoFast deste
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
                Digite o ID que aparece no AcessoFast do computador do cliente. O computador
                precisa ter o AcessoFast instalado e estar online — o ID aparece na tela do
                programa.
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
function EditarDispositivoDialog({
  device,
  onClose,
}: {
  device: AddressBookRow;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [alias, setAlias] = useState(device.alias ?? "");
  const [grupo, setGrupo] = useState(device.device_group ?? "");
  const [so, setSo] = useState(device.os ?? "");

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("address_book")
        .update({
          alias: alias.trim() || null,
          device_group: grupo.trim() || null,
          os: so.trim() || null,
        })
        .eq("id", device.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Dispositivo atualizado");
      queryClient.invalidateQueries({ queryKey: ["address_book"] });
      onClose();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar dispositivo</DialogTitle>
          <DialogDescription>
            Atualize alias, grupo e sistema operacional. Rustdesk ID e senha não são alterados
            aqui.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-alias">Alias</Label>
            <Input
              id="edit-alias"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-grupo">Grupo</Label>
            <Input
              id="edit-grupo"
              value={grupo}
              onChange={(e) => setGrupo(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-so">SO</Label>
            <Input id="edit-so" value={so} onChange={(e) => setSo(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
