import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

// Marcadores (migration 20260720152930): vocabulario por tenant + ligacao N:N
// com o address_book. Mora aqui porque sao duas telas a mostrar e editar: a de
// Dispositivos e a janelinha /conectar da integracao com o DoctorSaaS.

export type DeviceMarker = {
  id: string;
  label: string;
  color: string | null;
};

export const MARKER_COLOR_TOKENS = [
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
  red: "bg-destructive/15 text-destructive border-destructive/30",
  amber: "bg-warning/15 text-warning border-warning/30",
  green: "bg-green-500/15 text-green-500 border-green-500/30",
  blue: "bg-blue-500/15 text-blue-500 border-blue-500/30",
  violet: "bg-violet-500/15 text-violet-500 border-violet-500/30",
  pink: "bg-pink-500/15 text-pink-500 border-pink-500/30",
  gray: "bg-gray-500/15 text-gray-500 border-gray-500/30",
};

const MARKER_DOT_CLASSES: Record<string, string> = {
  slate: "bg-slate-500",
  red: "bg-destructive",
  amber: "bg-warning",
  green: "bg-green-500",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  pink: "bg-pink-500",
  gray: "bg-gray-500",
};

const MARKER_FALLBACK_CLASS = "bg-secondary text-secondary-foreground border-transparent";

export function markerClasses(color: string | null | undefined): string {
  if (!color) return MARKER_FALLBACK_CLASS;
  return MARKER_COLOR_CLASSES[color] ?? MARKER_FALLBACK_CLASS;
}

export function markerDotClass(color: string | null | undefined): string {
  if (!color) return "bg-muted-foreground/40";
  return MARKER_DOT_CLASSES[color] ?? "bg-muted-foreground/40";
}

export function pickMarkerColor(label: string): string {
  let sum = 0;
  for (let i = 0; i < label.length; i++) sum += label.charCodeAt(i);
  return MARKER_COLOR_TOKENS[sum % MARKER_COLOR_TOKENS.length];
}

export function MarcadorBadge({
  marcador,
  className,
}: {
  marcador: DeviceMarker;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={`px-1.5 py-0 text-[10px] ${markerClasses(marcador.color)} ${className ?? ""}`}
    >
      {marcador.label}
    </Badge>
  );
}

/**
 * Popover de aplicar, tirar e criar marcadores numa máquina. Quem chama decide
 * o gatilho (children) e informa o que já está aplicado — cada tela já tem essa
 * informação carregada, e buscar de novo aqui seria uma consulta por linha.
 *
 * As mutações invalidam os prefixos ["device_markers"] e
 * ["device_marker_assignments"]: toda tela que guarde marcadores sob eles se
 * atualiza sozinha.
 */
export function SeletorMarcadores({
  deviceId,
  tenantId,
  atribuidos,
  children,
  align = "start",
  larguraDoGatilho = false,
}: {
  deviceId: string;
  tenantId: string | null;
  atribuidos: ReadonlySet<string>;
  children: React.ReactNode;
  align?: "start" | "end";
  /** O conteúdo acompanha a largura do gatilho (campo de formulário). */
  larguraDoGatilho?: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");

  // Chave própria: a lista da tela de Dispositivos guarda ["device_markers"]
  // sem o tenant_id, e aqui ele é necessário. Para o super_admin a RLS devolve
  // o vocabulário de todos os tenants, e a FK composta recusa um marcador de
  // outro tenant — então filtramos pelo tenant da máquina.
  const { data: vocabulario } = useQuery({
    queryKey: ["device_markers", "com_tenant"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("device_markers")
        .select("id, label, color, tenant_id")
        .order("label");
      if (error) throw error;
      return (data ?? []) as (DeviceMarker & { tenant_id: string })[];
    },
  });
  const marcadores = (vocabulario ?? []).filter((m) => m.tenant_id === tenantId);

  const invalidar = () => {
    void queryClient.invalidateQueries({ queryKey: ["device_markers"] });
    void queryClient.invalidateQueries({ queryKey: ["device_marker_assignments"] });
    void queryClient.invalidateQueries({ queryKey: ["assignments", deviceId] });
  };

  const remover = useMutation({
    mutationFn: async (markerId: string) => {
      const { error } = await supabase
        .from("device_marker_assignments")
        .delete()
        .eq("device_id", deviceId)
        .eq("marker_id", markerId);
      if (error) throw error;
    },
    onSuccess: invalidar,
    onError: (err: Error) => toast.error(err.message),
  });

  const atribuir = useMutation({
    mutationFn: async (markerId: string) => {
      if (!tenantId) throw new Error("Dispositivo sem tenant vinculado");
      const { error } = await supabase
        .from("device_marker_assignments")
        .insert({ tenant_id: tenantId, device_id: deviceId, marker_id: markerId });
      if (error) throw error;
    },
    onSuccess: invalidar,
    onError: (err: Error) => toast.error(err.message),
  });

  const criar = useMutation({
    mutationFn: async (label: string) => {
      if (!tenantId) throw new Error("Dispositivo sem tenant vinculado");
      const trimmed = label.trim();
      const ins = await supabase
        .from("device_markers")
        .insert({ tenant_id: tenantId, label: trimmed, color: pickMarkerColor(trimmed) })
        .select("id")
        .single();
      let markerId = ins.data?.id as string | undefined;
      if (ins.error) {
        // provavelmente violação de unicidade — busca o existente
        const { data: existing, error: findErr } = await supabase
          .from("device_markers")
          .select("id")
          .eq("tenant_id", tenantId)
          .ilike("label", trimmed)
          .maybeSingle();
        if (findErr || !existing) throw ins.error;
        markerId = existing.id as string;
      }
      if (!markerId) throw new Error("Falha ao criar marcador");
      const { error: aErr } = await supabase
        .from("device_marker_assignments")
        .insert({ tenant_id: tenantId, device_id: deviceId, marker_id: markerId });
      if (aErr) throw aErr;
    },
    onSuccess: () => {
      setBusca("");
      invalidar();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const buscaTrim = busca.trim();
  const buscaLower = buscaTrim.toLowerCase();
  const filtrados = marcadores.filter((m) => m.label.toLowerCase().includes(buscaLower));
  const jaExiste = marcadores.some((m) => m.label.toLowerCase() === buscaLower);
  const podeCriar = buscaTrim.length > 0 && !jaExiste;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className={larguraDoGatilho ? "w-[--radix-popover-trigger-width] p-0" : "w-64 p-0"}
        align={align}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Buscar ou criar marcador…"
            value={busca}
            onValueChange={setBusca}
          />
          <CommandList>
            <CommandEmpty>Nenhum marcador.</CommandEmpty>
            <CommandGroup>
              {filtrados.map((m) => {
                const ativo = atribuidos.has(m.id);
                return (
                  <CommandItem
                    key={m.id}
                    value={m.id}
                    onSelect={() => {
                      if (ativo) remover.mutate(m.id);
                      else atribuir.mutate(m.id);
                    }}
                    className="flex items-center gap-2"
                  >
                    <span className={`h-2.5 w-2.5 rounded-full ${markerDotClass(m.color)}`} />
                    <span className="flex-1">{m.label}</span>
                    {ativo && <Check className="h-4 w-4 text-primary" />}
                  </CommandItem>
                );
              })}
              {podeCriar && (
                <CommandItem
                  value={`__criar__${buscaTrim}`}
                  onSelect={() => criar.mutate(buscaTrim)}
                  className="flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  <span>Criar «{buscaTrim}»</span>
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
