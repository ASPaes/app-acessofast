import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlanPickerDialog } from "@/components/plan-picker-dialog";
import { AplicarCupomDialog } from "@/components/aplicar-cupom-dialog";
import { AcessoRestrito } from "@/components/acesso-restrito";
import { SecaoCupons } from "@/components/secao-cupons";
import { StatCard } from "@/components/stat-card";
import { useMe } from "@/hooks/use-me";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import {
  Activity,
  AlertTriangle,
  Coins,
  CreditCard,
  Loader2,
  ExternalLink,
  Clock,
  TicketPercent,
  Users,
} from "lucide-react";

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

  const { data: me } = useMe();

  const isSuper = me?.role === "super_admin";
  const isAdmin = me?.role === "admin";
  const isTech = me?.role === "tech";
  const tenantId = me?.tenant_id ?? null;

  const { data: tenant } = useQuery({
    queryKey: ["financeiro-tenant", tenantId],
    enabled: !!tenantId && !isSuper && !isTech,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select(
          "billing_mode, billing_status, plan_code, plan_expires_at, is_trial, billing_invoice_url, billing_exempt, past_due_since, seat_limit, max_concurrent_per_tech",
        )
        .eq("id", tenantId as string)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: plano } = useQuery({
    queryKey: ["financeiro-plano", tenant?.plan_code],
    enabled: !!tenant?.plan_code,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plans")
        .select("name, price_month_cents, max_concurrent_per_tech")
        .eq("code", tenant!.plan_code as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const planName = plano?.name ?? null;

  /**
   * Atendimentos dos últimos 30 dias — deliberadamente NÃO "do ciclo".
   *
   * O ciclo de cobrança tem fim (`plan_expires_at`) mas não tem início gravado,
   * e existe plano anual (`plans.price_year_cents`), então deduzir o começo
   * subtraindo um mês daria número errado justamente para quem paga mais. 30
   * dias é uma janela que o rótulo consegue descrever sem mentir.
   */
  const { data: uso } = useQuery({
    queryKey: ["financeiro-uso-30d", tenantId],
    enabled: !!tenantId && !isSuper && !isTech,
    queryFn: async () => {
      const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("atendimentos")
        .select("id, technician_id")
        .eq("tenant_id", tenantId as string)
        .gte("started_at", desde);
      if (error) throw error;
      const linhas = data ?? [];
      return {
        atendimentos: linhas.length,
        tecnicos: new Set(linhas.map((a) => a.technician_id).filter(Boolean)).size,
      };
    },
  });

  const { data: activeUsers } = useQuery({
    queryKey: ["financeiro-active-users", tenantId],
    enabled: !!tenantId && !isSuper && !isTech,
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
    enabled: !!tenantId && !isSuper && !isTech,
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
    enabled: !!tenantId && !isSuper && !isTech,
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
    enabled: !isSuper && !isTech,
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

  // Técnico não decide compra nem assinatura, e o saldo da conta não muda o que
  // ele faz no dia. A tela só servia para ele descobrir quanto a empresa gasta.
  if (isTech) {
    return (
      <AcessoRestrito
        titulo="Financeiro"
        motivo="Plano, faturas e créditos são da administração da conta."
        onde="Se um atendimento foi barrado por falta de saldo ou por limite do plano, fale com o administrador da sua empresa."
      />
    );
  }

  if (isSuper) return <FinanceiroPlataforma />;

  const mode = tenant?.billing_mode;
  const isPlan = mode === "plan";
  const isIndividual = mode === "free" || mode === "credits";
  const isTrial = !!tenant?.is_trial;
  const dias = tenant?.plan_expires_at ? diasAte(tenant.plan_expires_at) : null;
  const reason: "assinar" | "renovar" = isPlan && !isTrial ? "renovar" : "assinar";

  /**
   * Ocupação de assentos. O override do tenant (`seat_limit`) manda sobre o
   * padrão do plano — é o valor que a RPC assign_plan gravou e o que o backend
   * usa para recusar convite, então é o único que pode aparecer aqui.
   */
  const assentos = tenant?.seat_limit ?? null;
  const usados = activeUsers ?? 0;
  const pctAssentos = assentos && assentos > 0 ? Math.round((usados / assentos) * 100) : null;
  const assentosApertados = pctAssentos !== null && pctAssentos >= 90;
  const vencendo = dias !== null && dias <= 5;

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

      {/* Antes desta faixa a tela de plano trazia três dados soltos — situação,
          vencimento e link da fatura. Nenhum deles responde o que o admin
          realmente pergunta: quanto a empresa usou e se os assentos apertam. */}
      {isPlan && (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Plano"
            value={planName ?? tenant?.plan_code ?? "—"}
            icon={CreditCard}
            hint={
              tenant?.billing_exempt
                ? "Conta isenta de cobrança"
                : plano?.price_month_cents
                  ? `${emReais(plano.price_month_cents)} por mês`
                  : "Sob medida"
            }
            loading={!tenant}
            color="blue"
          />
          <StatCard
            title={isTrial ? "Teste termina" : "Renova em"}
            value={dias === null ? "—" : dias === 0 ? "hoje" : dias === 1 ? "amanhã" : `${dias} dias`}
            icon={Clock}
            hint={
              tenant?.plan_expires_at
                ? new Date(tenant.plan_expires_at).toLocaleDateString("pt-BR")
                : "sem vencimento definido"
            }
            loading={!tenant}
            color={vencendo ? "amber" : "violet"}
          />
          <StatCard
            title="Atendimentos"
            value={uso?.atendimentos ?? 0}
            icon={Activity}
            hint={`${uso?.tecnicos ?? 0} técnico(s) ativo(s) · últimos 30 dias`}
            loading={!uso}
            color="cyan"
          />
          <StatCard
            title="Assentos"
            value={assentos ? `${usados}/${assentos}` : String(usados)}
            icon={Users}
            hint={
              pctAssentos === null ? "sem limite de assentos" : `${pctAssentos}% ocupados`
            }
            loading={!tenant}
            color={assentosApertados ? "amber" : "emerald"}
          />
        </div>
      )}

      {/* PLANO — só para contas em plano (assinatura). Plano é ilimitado: não compra crédito. */}
      {isPlan && (
        <Card>
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
            <div className="flex flex-col">
              <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
                Sessões simultâneas
              </span>
              <span className="tabular-nums">
                {tenant?.max_concurrent_per_tech ?? plano?.max_concurrent_per_tech ?? "sem limite"}
                <span className="text-muted-foreground"> por técnico</span>
              </span>
            </div>
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

          {/* A barra existe para o admin perceber o limite ANTES de convidar
              alguém e levar a recusa — o backend recusa no ato, sem negociar. */}
          {pctAssentos !== null && (
            <CardContent className="pt-0">
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
                  Ocupação de assentos
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {usados} de {assentos}
                </span>
              </div>
              <Progress
                value={Math.min(100, pctAssentos)}
                className={assentosApertados ? "bg-warning/20 [&>div]:bg-warning" : undefined}
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {assentos! - usados <= 0
                  ? "Sem assento livre. Convites acima do limite são recusados no ato."
                  : `${assentos! - usados} assento(s) livre(s). Convites acima do limite são recusados no ato.`}
              </p>
            </CardContent>
          )}
        </Card>
      )}

      {/* CRÉDITOS — só para conta individual (free/credits). Plano não usa crédito. */}
      {isIndividual && (
        <>
          <Card>
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

          <Card>
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
                            (h.credits >= 0 ? "text-success" : "text-muted-foreground")
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

      {/* CUPOM — o código que o comercial passou. Fica depois de plano/créditos
          porque é acessório: quase toda visita a esta tela é para ver saldo ou
          fatura, não para digitar cupom. */}
      {isAdmin && tenantId && <CartaoCupom tenantId={tenantId} />}

      <PlanPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        currentPlanCode={tenant?.plan_code}
        activeUsers={activeUsers ?? 0}
        reason={reason}
        tenantId={tenantId}
      />
    </div>
  );
}

/**
 * Cupom da conta: onde a empresa digita o código que recebeu.
 *
 * Dois estados. Sem nada reservado, é só o botão. Com um desconto reservado, a
 * conta precisa saber que ele existe e QUANDO entra — senão a pessoa aplica o
 * cupom, olha a fatura de hoje, não vê desconto nenhum e abre suporte. Dias
 * extras não aparecem aqui: eles já entraram na data de vencimento lá em cima.
 */
function CartaoCupom({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState(false);

  const { data: reservado } = useQuery({
    queryKey: ["cupom-reservado", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("tenant_pending_promo", {
        p_tenant_id: tenantId,
      });
      if (error) throw error;
      return (Array.isArray(data) ? data[0] : data) ?? null;
    },
  });

  const remover = useMutation({
    mutationFn: async (redemptionId: string) => {
      const { data, error } = await supabase.rpc("cancel_pending_promo", {
        p_redemption_id: redemptionId,
      });
      if (error) throw error;
      return (Array.isArray(data) ? data[0] : data) ?? null;
    },
    onSuccess: (r) => {
      if (!r?.ok) {
        toast.error(
          r?.reason === "checkout_open"
            ? "Há um checkout aberto com este cupom. Conclua ou aguarde a expiração do link para remover."
            : r?.reason === "already_used"
              ? "Este cupom já foi usado numa cobrança."
              : "Não foi possível remover o cupom.",
        );
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["cupom-reservado", tenantId] });
      toast.success("Cupom removido. O código volta a ficar disponível.");
    },
    onError: () => toast.error("Não foi possível remover o cupom."),
  });

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <TicketPercent className="h-4 w-4 text-primary" />
              Cupom
            </CardTitle>
            <CardDescription>
              Recebeu um código promocional? Aplique aqui na sua conta.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setAberto(true)}>
            Aplicar cupom
          </Button>
        </CardHeader>
        {reservado && (
          <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="font-mono">
                {reservado.code}
              </Badge>
              <span>
                <strong>{reservado.discount_percent}% de desconto</strong>{" "}
                {reservado.discount_months === null
                  ? "em todas as cobranças"
                  : `nas primeiras ${reservado.discount_months} cobranças`}{" "}
                <span className="text-muted-foreground">
                  — entra na próxima contratação ou renovação feita aqui.
                </span>
              </span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={remover.isPending}
              onClick={() => remover.mutate(reservado.redemption_id)}
            >
              {remover.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remover
            </Button>
          </CardContent>
        )}
      </Card>

      <AplicarCupomDialog open={aberto} onOpenChange={setAberto} tenantId={tenantId} />
    </>
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
      <Badge className="gap-1.5 bg-success/15 text-success border-success/30 hover:bg-success/15 w-fit">
        Ativo
      </Badge>
    );
  }
  if (status === "past_due") {
    return (
      <Badge className="gap-1.5 bg-warning/15 text-warning border-warning/30 hover:bg-warning/15 w-fit">
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

/**
 * Financeiro na visão de quem opera a plataforma.
 *
 * Antes esta rota devolvia uma frase ("selecione uma empresa") e nada mais — o
 * super_admin não tinha onde ver quanto a operação inteira arrecada. Os dados
 * para responder isso já existiam, espalhados entre `tenants`, `plans` e o
 * razão de créditos.
 *
 * Sobre os números: o que a tela chama de RECEITA CONTRATADA é a soma do preço
 * mensal dos planos das contas ativas — é o que foi contratado, não o que foi
 * recebido. Quem recebe é o Asaas, e o painel não tem esse extrato. Chamar isso
 * de faturamento seria mentira no instante em que alguém deixasse de pagar, e
 * por isso as contas em atraso aparecem separadas em vez de somadas.
 */
function FinanceiroPlataforma() {
  const { data: empresas, isLoading } = useQuery({
    queryKey: ["financeiro-plataforma-tenants"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select(
          "id, name, billing_mode, billing_status, plan_code, plan_expires_at, is_trial, billing_exempt, past_due_since, is_active",
        )
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: planos } = useQuery({
    queryKey: ["financeiro-plataforma-planos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("plans").select("code, name, price_month_cents");
      if (error) throw error;
      return data ?? [];
    },
  });

  /** Compras de crédito nos últimos 30 dias, direto do razão. */
  const { data: creditos } = useQuery({
    queryKey: ["financeiro-plataforma-creditos"],
    queryFn: async () => {
      const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("credit_ledger")
        .select("credits, package_code")
        .eq("entry_type", "purchase")
        .gte("created_at", desde);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: pacotes } = useQuery({
    queryKey: ["financeiro-plataforma-pacotes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("credit_packages").select("code, price_cents");
      if (error) throw error;
      return data ?? [];
    },
  });

  const precoPorPlano = new Map((planos ?? []).map((p) => [p.code, p.price_month_cents ?? 0]));
  const nomePorPlano = new Map((planos ?? []).map((p) => [p.code, p.name]));
  const precoPorPacote = new Map((pacotes ?? []).map((p) => [p.code, p.price_cents]));

  const ativas = (empresas ?? []).filter((t) => t.is_active);

  /**
   * Conta paga: ativa, em plano, fora do teste e sem isenção. Teste e isenção
   * ficam de fora porque nenhuma das duas gera cobrança — incluí-las inflaria a
   * receita com dinheiro que ninguém vai receber.
   */
  const pagantes = ativas.filter(
    (t) => t.billing_mode === "plan" && !t.is_trial && !t.billing_exempt,
  );
  const receitaMes = pagantes.reduce((s, t) => s + (precoPorPlano.get(t.plan_code ?? "") ?? 0), 0);

  const emAtraso = ativas.filter(
    (t) =>
      t.billing_status === "dunning" ||
      t.billing_status === "blocked_billing" ||
      !!t.past_due_since,
  );
  const receitaEmRisco = emAtraso.reduce(
    (s, t) => s + (precoPorPlano.get(t.plan_code ?? "") ?? 0),
    0,
  );

  const emTeste = ativas.filter((t) => t.is_trial).length;

  const creditosVendidos = (creditos ?? []).reduce(
    (s, c) => s + (precoPorPacote.get(c.package_code ?? "") ?? 0),
    0,
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Financeiro</h1>
        <p className="text-sm text-muted-foreground">
          Receita, inadimplência e alavancas comerciais da plataforma inteira.
        </p>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Receita contratada"
          value={emReais(receitaMes)}
          icon={CreditCard}
          hint={`${pagantes.length} conta(s) pagante(s) · por mês`}
          loading={isLoading}
          color="emerald"
        />
        <StatCard
          title="Em atraso"
          value={emReais(receitaEmRisco)}
          icon={AlertTriangle}
          hint={`${emAtraso.length} conta(s) com pagamento pendente`}
          loading={isLoading}
          color="amber"
        />
        <StatCard
          title="Em teste"
          value={emTeste}
          icon={Clock}
          hint="Contas em teste grátis agora"
          loading={isLoading}
          color="violet"
        />
        <StatCard
          title="Créditos vendidos"
          value={emReais(creditosVendidos)}
          icon={Coins}
          hint="Compras lançadas nos últimos 30 dias"
          loading={isLoading}
          color="lime"
        />
      </div>

      <Tabs defaultValue="contas">
        <TabsList>
          <TabsTrigger value="contas">Contas</TabsTrigger>
          <TabsTrigger value="cupons">Cupons</TabsTrigger>
        </TabsList>

        <TabsContent value="contas" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cobrança por conta</CardTitle>
              <CardDescription>
                {empresas ? `${ativas.length} conta(s) ativa(s)` : "Carregando…"} · para trocar o
                plano de uma conta, use a coluna Plano em Empresas.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border border-border/60 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Conta</TableHead>
                      <TableHead>Plano</TableHead>
                      <TableHead>Cobrança</TableHead>
                      <TableHead>Situação</TableHead>
                      <TableHead>Vence</TableHead>
                      <TableHead className="text-right">Valor/mês</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading && (
                      <TableRow>
                        <TableCell colSpan={6}>
                          <Skeleton className="h-8 w-full" />
                        </TableCell>
                      </TableRow>
                    )}
                    {!isLoading && ativas.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                          Nenhuma conta ativa.
                        </TableCell>
                      </TableRow>
                    )}
                    {!isLoading &&
                      ativas.map((t) => {
                        const preco = precoPorPlano.get(t.plan_code ?? "");
                        const cobra = t.billing_mode === "plan" && !t.is_trial && !t.billing_exempt;
                        return (
                          <TableRow key={t.id}>
                            <TableCell className="font-medium">{t.name}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {nomePorPlano.get(t.plan_code ?? "") ?? t.plan_code ?? "—"}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {MODO_COBRANCA[t.billing_mode] ?? t.billing_mode}
                            </TableCell>
                            <TableCell>
                              <BillingStatusBadge status={t.billing_status} isTrial={t.is_trial} />
                            </TableCell>
                            <TableCell className="text-sm tabular-nums text-muted-foreground">
                              {t.plan_expires_at
                                ? new Date(t.plan_expires_at).toLocaleDateString("pt-BR")
                                : "—"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {/* Isenta e em teste mostram traço, não zero: zero
                                  lê como "plano sem preço" e manda investigar um
                                  problema que não existe. */}
                              {cobra && preco ? emReais(preco) : "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cupons" className="mt-4">
          <SecaoCupons />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Rótulos do enum billing_mode. */
const MODO_COBRANCA: Record<string, string> = {
  plan: "Assinatura",
  credits: "Créditos",
  free: "Grátis",
};
