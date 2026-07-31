import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Badge } from "@/components/ui/badge";
import { CalendarPlus, CircleAlert, Loader2, Percent, TicketPercent } from "lucide-react";
import { toast } from "sonner";

/**
 * Aplica um cupom (promo_codes) numa empresa que JÁ EXISTE.
 *
 * Serve às duas pontas com o mesmo diálogo, porque a conversa é a mesma:
 *   Financeiro → a empresa recebeu um código e digita (empresa fixa).
 *   Cupons     → o comercial aplica o código numa conta (cupom fixo).
 *
 * O preview roda antes de qualquer efeito: um cupom de campanha tem teto de
 * resgates, e descobrir que ele não servia depois de queimar um uso seria caro.
 */

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Empresa fixa. Quando null, o diálogo pede para escolher (uso do super admin). */
  tenantId?: string | null;
  tenantNome?: string | null;
  /** Cupom fixo. Quando ausente, o usuário digita o código. */
  codigoFixo?: string;
};

type Preview = {
  ok: boolean;
  reason: string | null;
  code: string | null;
  description: string | null;
  extra_trial_days: number;
  dias_aplicaveis: boolean;
  novo_vencimento: string | null;
  discount_percent: number | null;
  discount_months: number | null;
  plan_codes: string[] | null;
};

type Aplicacao = {
  ok: boolean;
  reason: string | null;
  redemption_id: string | null;
  dias_aplicados: number;
  novo_vencimento: string | null;
  discount_percent: number | null;
  discount_months: number | null;
};

// Os mesmos motivos que o banco devolve, na língua de quem lê a tela.
const MOTIVO: Record<string, string> = {
  not_found: "Cupom não encontrado. Confira o código.",
  inactive: "Este cupom está desativado.",
  not_started: "Este cupom ainda não começou a valer.",
  expired: "Este cupom está vencido.",
  exhausted: "Este cupom já atingiu o limite de resgates.",
  plan_not_eligible: "Este cupom não vale para o plano desta conta.",
  already_used: "Esta conta já usou este cupom.",
  discount_pending:
    "Já existe um desconto de cupom reservado nesta conta. Use na próxima cobrança ou remova antes de aplicar outro.",
  no_effect:
    "Este cupom só dá dias extras, e esta conta não tem data de vencimento para estender. Dias só valem em teste ou plano anual.",
};

function mensagemDoMotivo(reason: string | null | undefined) {
  if (!reason) return "Não foi possível usar este cupom.";
  return MOTIVO[reason] ?? "Não foi possível usar este cupom.";
}

function mensagemDeErro(err: unknown) {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code === "42501") return "Você não tem permissão para aplicar cupom nesta conta.";
  return e?.message || "Não foi possível aplicar o cupom.";
}

const formatarData = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

export function AplicarCupomDialog({
  open,
  onOpenChange,
  tenantId = null,
  tenantNome = null,
  codigoFixo,
}: Props) {
  const queryClient = useQueryClient();
  const escolheEmpresa = tenantId === null;

  const [empresa, setEmpresa] = useState<string>("");
  const [codigo, setCodigo] = useState(codigoFixo ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);

  const alvo = escolheEmpresa ? empresa : tenantId;

  // Limpa ao abrir: um diálogo reaberto com o resultado da vez anterior faria o
  // usuário aplicar em cima de um preview velho.
  useEffect(() => {
    if (open) {
      setEmpresa("");
      setCodigo(codigoFixo ?? "");
      setPreview(null);
    }
  }, [open, codigoFixo]);

  const { data: empresas } = useQuery({
    queryKey: ["tenants-para-cupom"],
    enabled: open && escolheEmpresa,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, name, plan_code, billing_mode")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const conferir = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("promo_code_preview_tenant", {
        p_tenant_id: alvo as string,
        p_code: codigo.trim().toUpperCase(),
      });
      if (error) throw error;
      const linha = (Array.isArray(data) ? data[0] : data) as Preview | undefined;
      if (!linha) throw new Error("Resposta vazia do servidor.");
      return linha;
    },
    onSuccess: (linha) => setPreview(linha),
    onError: (err) => {
      setPreview(null);
      toast.error(mensagemDeErro(err));
    },
  });

  const aplicar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("apply_promo_code_to_tenant", {
        p_tenant_id: alvo as string,
        p_code: codigo.trim().toUpperCase(),
      });
      if (error) throw error;
      const linha = (Array.isArray(data) ? data[0] : data) as Aplicacao | undefined;
      if (!linha) throw new Error("Resposta vazia do servidor.");
      return linha;
    },
    onSuccess: (r) => {
      if (!r.ok) {
        // O estado pode ter mudado entre o preview e o clique: o último uso do
        // cupom pode ter sido consumido por outra pessoa nesse meio-tempo.
        setPreview(null);
        toast.error(mensagemDoMotivo(r.reason));
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["cupons"] });
      queryClient.invalidateQueries({ queryKey: ["tenants-empresas"] });
      queryClient.invalidateQueries({ queryKey: ["financeiro-tenant"] });
      queryClient.invalidateQueries({ queryKey: ["cupom-reservado"] });
      queryClient.invalidateQueries({ queryKey: ["cupom-resgates"] });

      const partes: string[] = [];
      if (r.dias_aplicados > 0 && r.novo_vencimento) {
        partes.push(`+${r.dias_aplicados} dias — agora vence em ${formatarData(r.novo_vencimento)}`);
      }
      if (r.discount_percent !== null) {
        partes.push(`${r.discount_percent}% de desconto reservado para a próxima cobrança`);
      }
      toast.success(`Cupom aplicado: ${partes.join(" · ")}`);
      onOpenChange(false);
    },
    onError: (err) => toast.error(mensagemDeErro(err)),
  });

  const codigoValido = codigo.trim().length >= 3;
  const podeConferir = !!alvo && codigoValido;
  const previewDoCodigoAtual =
    preview && preview.code?.toUpperCase() === codigo.trim().toUpperCase() ? preview : null;

  return (
    <Dialog open={open} onOpenChange={(v) => !aplicar.isPending && onOpenChange(v)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TicketPercent className="h-4 w-4 text-primary" />
            Aplicar cupom
          </DialogTitle>
          <DialogDescription>
            {escolheEmpresa
              ? "Escolha a conta que vai receber o cupom. Valem as mesmas regras do site: validade, limite de resgates e um uso por conta."
              : `Digite o código que você recebeu. Ele vale uma vez por conta${
                  tenantNome ? ` — aqui, ${tenantNome}` : ""
                }.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {escolheEmpresa && (
            <div className="space-y-2">
              <Label htmlFor="cupom-empresa">Empresa</Label>
              <Select
                value={empresa}
                onValueChange={(v) => {
                  setEmpresa(v);
                  setPreview(null);
                }}
              >
                <SelectTrigger id="cupom-empresa">
                  <SelectValue placeholder="Selecione a conta" />
                </SelectTrigger>
                <SelectContent>
                  {(empresas ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t.plan_code ?? "sem plano"}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="cupom-codigo-aplicar">Código do cupom</Label>
            <div className="flex gap-2">
              <Input
                id="cupom-codigo-aplicar"
                value={codigo}
                autoComplete="off"
                readOnly={!!codigoFixo}
                placeholder="ACESSOFAST15DIAS"
                className="font-mono uppercase"
                onChange={(ev) => {
                  setCodigo(ev.target.value.toUpperCase());
                  setPreview(null);
                }}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" && podeConferir) {
                    ev.preventDefault();
                    conferir.mutate();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={!podeConferir || conferir.isPending}
                onClick={() => conferir.mutate()}
              >
                {conferir.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Conferir
              </Button>
            </div>
          </div>

          {previewDoCodigoAtual && !previewDoCodigoAtual.ok && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <span>{mensagemDoMotivo(previewDoCodigoAtual.reason)}</span>
            </div>
          )}

          {previewDoCodigoAtual?.ok && (
            <div className="space-y-2 rounded-md border border-border/60 p-3 text-sm">
              {previewDoCodigoAtual.description && (
                <p className="text-muted-foreground">{previewDoCodigoAtual.description}</p>
              )}

              {previewDoCodigoAtual.dias_aplicaveis && previewDoCodigoAtual.novo_vencimento && (
                <p className="flex items-start gap-2">
                  <CalendarPlus className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>
                    <strong>+{previewDoCodigoAtual.extra_trial_days} dias</strong> — o acesso passa a
                    vencer em {formatarData(previewDoCodigoAtual.novo_vencimento)}.
                  </span>
                </p>
              )}

              {/* Cupom de dias numa conta sem vencimento: o desconto ainda vale, mas
                  os dias não têm onde cair. Melhor dizer antes do que depois. */}
              {previewDoCodigoAtual.extra_trial_days > 0 &&
                !previewDoCodigoAtual.dias_aplicaveis && (
                  <p className="flex items-start gap-2 text-muted-foreground">
                    <CalendarPlus className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Os {previewDoCodigoAtual.extra_trial_days} dias extras não se aplicam aqui:
                      esta conta não tem data de vencimento. Dias só valem em teste ou plano anual.
                    </span>
                  </p>
                )}

              {previewDoCodigoAtual.discount_percent !== null && (
                <p className="flex items-start gap-2">
                  <Percent className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>
                    <strong>{previewDoCodigoAtual.discount_percent}% de desconto</strong>{" "}
                    {previewDoCodigoAtual.discount_months === null
                      ? "em todas as cobranças"
                      : `nas primeiras ${previewDoCodigoAtual.discount_months} cobranças`}
                    . O desconto fica reservado e entra na próxima contratação ou renovação feita
                    aqui pelo painel.
                  </span>
                </p>
              )}

              {previewDoCodigoAtual.plan_codes && (
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  Vale para:
                  {previewDoCodigoAtual.plan_codes.map((c) => (
                    <Badge key={c} variant="outline" className="font-normal">
                      {c}
                    </Badge>
                  ))}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={aplicar.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!previewDoCodigoAtual?.ok || aplicar.isPending}
            onClick={() => aplicar.mutate()}
          >
            {aplicar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Aplicar cupom
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
