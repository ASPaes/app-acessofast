import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PlanPickerDialog } from "@/components/plan-picker-dialog";
import { toast } from "sonner";
import { Coins, CreditCard, Loader2, ExternalLink, Clock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/financeiro")({
  head: () => ({
    meta: [{ title: "Financeiro — Acessofast" }, { name: "robots", content: "noindex" }],
  }),
  component: Financeiro,
});

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const emReais = (centavos: number) => brl.format(centavos / 100);

type CheckoutResult = { ok?: boolean; checkout_url?: string };

// Rótulos do razão de crédito (enum credit_entry_type).
const ENTRY_LABEL: Record<string, string> = {
  purchase: "Compra",
  consume: "Consumo",
  refund: "Estorno",
  adjust: "Ajuste",
  expire: "Expiração",
};

async function mensagemDeErro(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const b = await error.context.json();
      return b?.detail ?? b?.error ?? error.message;
    } catch {
      return error.message;
    }
  }
  return (error as { message?: string })?.message ?? "Erro ao iniciar o pagamento";
}

function diasAte(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

function Financeiro() {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [comprando, setComprando] = useState<string | null>(null);

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
  const isAdmin = me?.role === "admin";
  const tenantId = me?.tenant_id ?? null;

  const { data: tenant } = useQuery({
    queryKey: ["financeiro-tenant", tenantId],
    enabled: !!tenantId && !isSuper,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select(
          "billing_mode, billing_status, plan_code, plan_expires_at, is_trial, billing_invoice_url, billing_exempt, past_due_since",
        )
        .eq("id", tenantId as string)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: planName } = useQuery({
    queryKey: ["financeiro-plan-name", tenant?.plan_code],
    enabled: !!tenant?.plan_code,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plans")
        .select("name")
        .eq("code", tenant!.plan_code as string)
        .maybeSingle();
      if (error) throw error;
      return data?.name ?? null;
    },
  });

  const { data: activeUsers } = useQuery({
    queryKey: ["financeiro-active-users", tenantId],
    enabled: !!tenantId && !isSuper,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId as string)
        .eq("is_active", true)
        .neq("role", "super_admin");
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: saldo } = useQuery({
    queryKey: ["financeiro-saldo", tenantId],
    enabled: !!tenantId && !isSuper,
    refetchInterval: 20000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credit_ledger")
        .select("credits")
        .eq("tenant_id", tenantId as string);
      if (error) throw error;
      return (data ?? []).reduce((sum, r) => sum + (r.credits ?? 0), 0);
    },
  });

  const { data: historico, isLoading: histLoading } = useQuery({
    queryKey: ["financeiro-historico", tenantId],
    enabled: !!tenantId && !isSuper,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credit_ledger")
        .select("id, created_at, entry_type, credits, note")
        .eq("tenant_id", tenantId as string)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: pacotes } = useQuery({
    queryKey: ["financeiro-pacotes"],
    enabled: !isSuper,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credit_packages")
        .select("code, credits, price_cents")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  async function comprar(code: string) {
    setComprando(code);
    try {
      const { data, error } = await supabase.functions.invoke<CheckoutResult>(
        "create-credit-checkout",
        { body: { package_code: code } },
      );
      if (error) throw error;
      const url = data?.checkout_url;
      if (!url) throw new Error("resposta sem checkout_url");
      window.location.href = url;
    } catch (err) {
      toast.error(await mensagemDeErro(err));
      setComprando(null);
    }
  }

  if (isSuper) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Financeiro</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A cobrança é por empresa. Selecione uma empresa para ver o financeiro dela.
        </p>
      </div>
    );
  }

  const mode = tenant?.billing_mode;
  const isPlan = mode === "plan";
  const isIndividual = mode === "free" || mode === "credits";
  const isTrial = !!tenant?.is_trial;
  const dias = tenant?.plan_expires_at ? diasAte(tenant.plan_expires_at) : null;
  const reason: "assinar" | "renovar" = isPlan && !isTrial ? "renovar" : "assinar";

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Financeiro</h1>
        <p className="text-sm text-muted-foreground">
          {isPlan
            ? "Assinatura e faturas da sua empresa."
            : "Créditos e faturas da sua conta."}
        </p>
      </div>

      {/* PLANO — só para contas em plano (assinatura). Plano é ilimitado: não compra crédito. */}
      {isPlan && (
        <Card className="border-border/60">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-primary" />
                Plano e assinatura
              </CardTitle>
              <CardDescription>
                {tenant?.billing_exempt
                  ? "Conta isenta de cobrança."
                  : `Plano ${planName ?? tenant?.plan_code}${isTrial ? " · em teste grátis" : ""}`}
              </CardDescription>
            </div>
            {isAdmin && !tenant?.billing_exempt && (
              <Button size="sm" onClick={() => setPickerOpen(true)}>
                Trocar plano
              </Button>
            )}
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
            <div className="flex flex-col">
              <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
                Situação
              </span>
              <BillingStatusBadge status={tenant?.billing_status} isTrial={isTrial} />
            </div>
            {tenant?.plan_expires_at && (
              <div className="flex flex-col">
                <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
                  {isTrial ? "Teste termina" : "Vence"}
                </span>
                <span className="flex items-center gap-1.5 tabular-nums">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  {new Date(tenant.plan_expires_at).toLocaleDateString("pt-BR")}
                  {dias !== null && (
                    <span className="text-muted-foreground">
                      ({dias === 0 ? "hoje" : dias === 1 ? "amanhã" : `${dias} dias`})
                    </span>
                  )}
                </span>
              </div>
            )}
            {tenant?.billing_invoice_url && (
              <a
                href={tenant.billing_invoice_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Ver fatura atual
              </a>
            )}
          </CardContent>
        </Card>
      )}

      {/* CRÉDITOS — só para conta individual (free/credits). Plano não usa crédito. */}
      {isIndividual && (
        <>
          <Card className="border-border/60">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Coins className="h-4 w-4 text-primary" />
                  Créditos
                </CardTitle>
                <CardDescription>
                  Cada crédito cobre 1 atendimento por dispositivo (janela de 3h).
                </CardDescription>
              </div>
              <div className="text-right">
                <p className="text-2xl font-semibold tabular-nums leading-none">{saldo ?? 0}</p>
                <p className="text-[11px] text-muted-foreground">disponíveis</p>
              </div>
            </CardHeader>
            <CardContent>
              {!pacotes || pacotes.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Nenhum pacote de crédito disponível no momento.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {pacotes.map((p) => (
                    <div
                      key={p.code}
                      className="flex flex-col gap-2 rounded-md border border-border/60 p-4"
                    >
                      <p className="text-xl font-semibold tabular-nums">
                        {p.credits}
                        <span className="text-sm font-normal text-muted-foreground"> créditos</span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {emReais(p.price_cents)}
                        <span className="text-xs"> · {emReais(p.price_cents / p.credits)}/cr</span>
                      </p>
                      <Button
                        size="sm"
                        className="mt-auto"
                        disabled={!isAdmin || comprando !== null}
                        onClick={() => void comprar(p.code)}
                        title={isAdmin ? undefined : "Apenas administradores podem comprar créditos"}
                      >
                        {comprando === p.code && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Comprar
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {!isAdmin && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Apenas administradores da conta podem comprar créditos.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-base">Histórico de créditos</CardTitle>
              <CardDescription>Compras, consumos e estornos.</CardDescription>
            </CardHeader>
            <CardContent>
              {histLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : !historico || historico.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Nenhum lançamento ainda.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="text-right">Créditos</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historico.map((h) => (
                      <TableRow key={h.id}>
                        <TableCell className="text-muted-foreground tabular-nums">
                          {new Date(h.created_at).toLocaleString("pt-BR")}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {ENTRY_LABEL[h.entry_type] ?? h.entry_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{h.note ?? "—"}</TableCell>
                        <TableCell
                          className={
                            "text-right font-medium tabular-nums " +
                            (h.credits >= 0 ? "text-emerald-500" : "text-muted-foreground")
                          }
                        >
                          {h.credits >= 0 ? `+${h.credits}` : h.credits}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Upsell discreto: individual PODE migrar p/ um plano (uso ilimitado). */}
          {isAdmin && (
            <p className="text-xs text-muted-foreground">
              Faz muitos atendimentos por mês?{" "}
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="font-medium text-primary hover:underline"
              >
                Conheça os planos com uso ilimitado.
              </button>
            </p>
          )}
        </>
      )}

      <PlanPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        currentPlanCode={tenant?.plan_code}
        activeUsers={activeUsers ?? 0}
        reason={reason}
      />
    </div>
  );
}

function BillingStatusBadge({
  status,
  isTrial,
}: {
  status: string | null | undefined;
  isTrial: boolean;
}) {
  if (isTrial) {
    return (
      <Badge className="gap-1.5 bg-primary/10 text-primary border-primary/30 hover:bg-primary/10 w-fit">
        Em teste grátis
      </Badge>
    );
  }
  if (status === "active") {
    return (
      <Badge className="gap-1.5 bg-emerald-500/15 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/15 w-fit">
        Ativo
      </Badge>
    );
  }
  if (status === "past_due") {
    return (
      <Badge className="gap-1.5 bg-amber-500/15 text-amber-500 border-amber-500/30 hover:bg-amber-500/15 w-fit">
        Pagamento pendente
      </Badge>
    );
  }
  if (status === "suspended") {
    return (
      <Badge className="gap-1.5 bg-destructive/15 text-destructive border-destructive/30 hover:bg-destructive/15 w-fit">
        Suspenso
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="w-fit text-muted-foreground">
      {status ?? "—"}
    </Badge>
  );
}
