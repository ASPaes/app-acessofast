import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ImagePlus, Plus } from "lucide-react";

// ---------------------------------------------------------------------------
// Gestao de campanhas de anuncio (super_admin).
//
// Toda escrita passa pela edge function ad-admin (service_role, barrada por
// super_admin) — nunca por grant direto em ad_campaigns. O bucket ad-creatives
// e privado: a arte sobe e e assinada la, e a URL que chega aqui e temporaria.
// ---------------------------------------------------------------------------

type Placement = "free_start" | "exhausted" | "agent_exhausted";
type Status = "draft" | "pending" | "approved" | "paused" | "archived";
type Kind = "house" | "third_party";

export type Campanha = {
  id: string;
  kind: Kind;
  advertiser_tenant_id: string | null;
  name: string;
  headline: string;
  body: string | null;
  cta_label: string;
  cta_url: string;
  image_path: string | null;
  image_url: string | null;
  placements: Placement[];
  status: Status;
  starts_at: string | null;
  ends_at: string | null;
  daily_cap: number | null;
  weight: number;
};

const PLACEMENT_ROTULO: Record<Placement, string> = {
  free_start: "Início do gratuito (painel)",
  exhausted: "Esgotado (painel)",
  agent_exhausted: "Esgotado (.exe)",
};

const STATUS_ROTULO: Record<Status, string> = {
  draft: "Rascunho",
  pending: "Em moderação",
  approved: "Aprovada",
  paused: "Pausada",
  archived: "Arquivada",
};

async function adAdmin<T = any>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("ad-admin", { body: payload });
  if (error) {
    let code = error.message;
    try {
      const j = await (error as { context?: Response }).context?.json();
      if (j?.error) code = j.error;
    } catch { /* mantem a mensagem generica */ }
    throw new Error(code);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

function traduzErro(msg: string): string {
  const m: Record<string, string> = {
    forbidden: "Só o super admin gerencia campanhas.",
    kind_invalido: "Tipo de campanha inválido.",
    placements_invalidos: "Escolha ao menos um momento de exibição.",
    casa_nao_recebe_exhausted:
      "A tela de esgotado do painel já é a oferta de crédito — campanha da casa não entra nela.",
    third_party_exige_anunciante: "Campanha de terceiro exige o tenant do anunciante.",
    campos_obrigatorios: "Preencha nome, headline, rótulo e URL do CTA.",
    formato_invalido: "Imagem deve ser PNG, JPG ou WEBP.",
    imagem_grande: "Imagem acima de 8 MB.",
    base64_invalido: "Arquivo de imagem inválido.",
    upload_falhou: "Falha ao subir a imagem.",
  };
  if (msg.includes("duplicate key") || msg.includes("unique")) return "Já existe uma campanha com esse nome interno.";
  return m[msg] ?? msg ?? "Não foi possível concluir.";
}

export function GestaoCampanhas() {
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState<Campanha | "nova" | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["ad-admin", "campanhas"],
    queryFn: () => adAdmin<{ campaigns: Campanha[] }>({ action: "list" }),
  });
  const campanhas = data?.campaigns ?? [];

  const statusMut = useMutation({
    mutationFn: (v: { id: string; status: Status }) =>
      adAdmin({ action: "set_status", id: v.id, status: v.status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ad-admin", "campanhas"] });
      toast.success("Status atualizado.");
    },
    onError: (e: Error) => toast.error(traduzErro(e.message)),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">Campanhas</CardTitle>
          <CardDescription>
            Criar, aprovar e trocar a arte das campanhas do slot de anúncio. Só super admin.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setEditando("nova")}>
          <Plus className="mr-1 h-4 w-4" /> Nova campanha
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : campanhas.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma campanha ainda. Crie a primeira.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Arte</TableHead>
                  <TableHead>Campanha</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Momentos</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campanhas.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      {c.image_url ? (
                        <img
                          src={c.image_url}
                          alt=""
                          className="h-12 w-12 rounded object-cover"
                        />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded bg-muted text-muted-foreground">
                          <ImagePlus className="h-4 w-4" />
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{c.headline}</div>
                      <div className="text-xs text-muted-foreground">{c.name}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={c.kind === "house" ? "secondary" : "default"}>
                        {c.kind === "house" ? "Casa" : "Terceiro"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {c.placements.map((p) => (
                          <Badge key={p} variant="outline" className="font-normal">
                            {PLACEMENT_ROTULO[p]}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {c.status !== "approved" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={statusMut.isPending}
                            onClick={() => statusMut.mutate({ id: c.id, status: "approved" })}
                          >
                            Aprovar
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={statusMut.isPending}
                            onClick={() => statusMut.mutate({ id: c.id, status: "paused" })}
                          >
                            Pausar
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setEditando(c)}>
                          Editar
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {editando && (
        <CampanhaDialog
          campanha={editando === "nova" ? null : editando}
          onClose={() => setEditando(null)}
        />
      )}
    </Card>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const variant =
    status === "approved" ? "default" : status === "archived" ? "outline" : "secondary";
  return <Badge variant={variant}>{STATUS_ROTULO[status]}</Badge>;
}

// ---------------------------------------------------------------------------
// Diálogo de criar/editar
// ---------------------------------------------------------------------------
const TODOS_PLACEMENTS: Placement[] = ["free_start", "exhausted", "agent_exhausted"];

function CampanhaDialog({
  campanha,
  onClose,
}: {
  campanha: Campanha | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState<Kind>("house");
  const [name, setName] = useState("");
  const [headline, setHeadline] = useState("");
  const [body, setBody] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [status, setStatus] = useState<Status>("draft");
  const [weight, setWeight] = useState("1");
  const [dailyCap, setDailyCap] = useState("");
  const [advertiser, setAdvertiser] = useState("");
  // id/imagem passam a existir depois do primeiro save de uma campanha nova.
  const [id, setId] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!campanha) return;
    setId(campanha.id);
    setKind(campanha.kind);
    setName(campanha.name);
    setHeadline(campanha.headline);
    setBody(campanha.body ?? "");
    setCtaLabel(campanha.cta_label);
    setCtaUrl(campanha.cta_url);
    setPlacements(campanha.placements);
    setStatus(campanha.status);
    setWeight(String(campanha.weight ?? 1));
    setDailyCap(campanha.daily_cap != null ? String(campanha.daily_cap) : "");
    setAdvertiser(campanha.advertiser_tenant_id ?? "");
    setImageUrl(campanha.image_url);
  }, [campanha]);

  const casaComExhausted = kind === "house" && placements.includes("exhausted");

  const invalidar = () =>
    queryClient.invalidateQueries({ queryKey: ["ad-admin", "campanhas"] });

  const salvar = useMutation({
    mutationFn: () =>
      adAdmin<{ campaign: Campanha }>({
        action: "save",
        campaign: {
          id: id ?? undefined,
          kind,
          advertiser_tenant_id: kind === "third_party" ? advertiser.trim() || null : null,
          name: name.trim(),
          headline: headline.trim(),
          body: body.trim() || null,
          cta_label: ctaLabel.trim(),
          cta_url: ctaUrl.trim(),
          placements,
          status,
          weight,
          daily_cap: dailyCap,
        },
      }),
    onSuccess: (d) => {
      setId(d.campaign.id);
      invalidar();
      toast.success("Campanha salva.");
    },
    onError: (e: Error) => toast.error(traduzErro(e.message)),
  });

  const enviarImagem = useMutation({
    mutationFn: async (file: File) => {
      if (!id) throw new Error("Salve a campanha antes de enviar a arte.");
      const b64 = await fileToBase64(file);
      return adAdmin<{ campaign: Campanha }>({
        action: "upload",
        id,
        name: file.name,
        content_base64: b64,
      });
    },
    onSuccess: (d) => {
      setImageUrl(d.campaign.image_url);
      invalidar();
      toast.success("Arte atualizada.");
    },
    onError: (e: Error) => toast.error(traduzErro(e.message)),
  });

  const togglePlacement = (p: Placement) =>
    setPlacements((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  const submeter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !headline.trim() || !ctaLabel.trim() || !ctaUrl.trim()) {
      toast.error("Preencha nome, headline, rótulo e URL do CTA.");
      return;
    }
    if (placements.length === 0) {
      toast.error("Escolha ao menos um momento de exibição.");
      return;
    }
    if (casaComExhausted) {
      toast.error("Campanha da casa não pode usar a tela de esgotado do painel.");
      return;
    }
    salvar.mutate();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{campanha ? "Editar campanha" : "Nova campanha"}</DialogTitle>
          <DialogDescription>
            A arte já traz texto e botão desenhados; o painel/agente exibem a imagem. O CTA
            é o link aberto ao clicar.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submeter} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="house">Casa (AcessoFast)</SelectItem>
                  <SelectItem value="third_party">Terceiro (anunciante)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-name">Nome interno *</Label>
              <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="casa-credito-agente-v2" required />
            </div>
          </div>

          {kind === "third_party" && (
            <div className="space-y-2">
              <Label htmlFor="c-adv">Tenant do anunciante (UUID) *</Label>
              <Input id="c-adv" value={advertiser} onChange={(e) => setAdvertiser(e.target.value)}
                placeholder="uuid do tenant que paga" />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="c-headline">Headline *</Label>
            <Input id="c-headline" value={headline} onChange={(e) => setHeadline(e.target.value)} required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="c-body">Corpo</Label>
            <Textarea id="c-body" value={body} onChange={(e) => setBody(e.target.value)} rows={2} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="c-cta-label">Rótulo do CTA *</Label>
              <Input id="c-cta-label" value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)}
                placeholder="Ver pacotes de crédito" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-cta-url">URL do CTA *</Label>
              <Input id="c-cta-url" value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)}
                placeholder="https://app.acessofast.com.br/financeiro" required />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Momentos de exibição *</Label>
            <div className="space-y-2">
              {TODOS_PLACEMENTS.map((p) => {
                const bloqueado = kind === "house" && p === "exhausted";
                return (
                  <label key={p} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={placements.includes(p)}
                      disabled={bloqueado}
                      onCheckedChange={() => togglePlacement(p)}
                    />
                    <span className={bloqueado ? "text-muted-foreground" : ""}>
                      {PLACEMENT_ROTULO[p]}
                      {bloqueado && " — indisponível para campanha da casa"}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(STATUS_ROTULO) as Status[]).map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_ROTULO[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-weight">Peso</Label>
              <Input id="c-weight" type="number" min={1} value={weight}
                onChange={(e) => setWeight(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-cap">Teto/dia</Label>
              <Input id="c-cap" type="number" min={1} value={dailyCap}
                placeholder="sem teto" onChange={(e) => setDailyCap(e.target.value)} />
            </div>
          </div>

          {/* Arte */}
          <div className="space-y-2 rounded-md border p-3">
            <Label>Arte (PNG/JPG/WEBP, até 8 MB)</Label>
            <div className="flex items-center gap-4">
              {imageUrl ? (
                <img src={imageUrl} alt="" className="h-24 w-24 rounded object-cover" />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded bg-muted text-muted-foreground">
                  <ImagePlus className="h-6 w-6" />
                </div>
              )}
              <div className="space-y-1">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) enviarImagem.mutate(f);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!id || enviarImagem.isPending}
                  onClick={() => fileRef.current?.click()}
                >
                  {enviarImagem.isPending ? "Enviando…" : imageUrl ? "Trocar arte" : "Enviar arte"}
                </Button>
                {!id && (
                  <p className="text-xs text-muted-foreground">
                    Salve a campanha primeiro para habilitar o envio da arte.
                  </p>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Fechar</Button>
            <Button type="submit" disabled={salvar.isPending}>
              {salvar.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("read_failed"));
    r.readAsDataURL(file);
  });
}
