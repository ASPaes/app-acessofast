import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPlanCode: string | null | undefined;
  activeUsers: number;
  reason: "assinar" | "renovar";
  /** Conta que está contratando. Sem ela o cupom reservado não é consultado. */
  tenantId?: string | null;
};

type Ciclo = "monthly" | "annual";

type Plano = {
  code: string;
  name: string;
  price_month_cents: number | null;
  price_year_cents: number | null;
  max_users: number | null;
};

type CheckoutResult = {
  ok?: boolean;
  intent_id?: string;
  checkout_url?: string;
};

const PLANOS_COMPRAVEIS = ["team", "business", "scale"];

const ERROS: Record<string, string> = {
  downgrade_blocked:
    "Você tem mais usuários ativos do que este plano permite. Desative usuários antes de trocar.",
  tenant_exempt: "Esta conta é isenta de cobrança. Fale com o suporte.",
  forbidden_role: "Apenas administradores podem contratar planos.",
  no_tenant: "Conta sem organização vinculada.",
  plan_not_purchasable: "Este plano não está disponível para contratação online.",
  plan_has_no_price: "Plano sem preço configurado. Tente outro plano.",
  unknown_plan: "Plano indisponível.",
  asaas_unreachable:
    "Não foi possível falar com o provedor de pagamento agora. Tente em instantes.",
  asaas_error: "O provedor de pagamento recusou a solicitação. Tente novamente.",
  db_error: "Erro interno ao preparar o pagamento. Tente novamente.",
  unauthenticated: "Sessão expirada. Entre novamente.",
  user_inactive: "Seu usuário está inativo. Fale com o administrador.",
};

const GENERICO = "Não foi possível iniciar o pagamento agora. Tente novamente em instantes.";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function emReais(centavos: number): string {
  return brl.format(centavos / 100);
}

async function mensagemDeErro(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const b = await error.context.json();
      const codigo: string = typeof b?.error === "string" ? b.error : "";
      const detail: string = typeof b?.detail === "string" ? b.detail : "";
      if (codigo === "downgrade_blocked" && detail) return detail;
      return ERROS[codigo] ?? GENERICO;
    } catch {
      return GENERICO;
    }
  }
  return GENERICO;
}

export function PlanPickerDialog({
  open,
  onOpenChange,
  currentPlanCode,
  activeUsers,
  reason,
  tenantId = null,
}: Props) {
  const [cycle, setCycle] = useState<Ciclo>("annual");
  const [pendente, setPendente] = useState<string | null>(null);

  const {
    data: planos,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["plans-purchasable"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plans")
        .select("code, name, price_month_cents, price_year_cents, max_users")
        .in("code", PLANOS_COMPRAVEIS)
        .eq("is_active", true)
        .order("price_month_cents");
      if (error) throw error;
      return data as Plano[];
    },
  });

  // Cupom já aplicado na conta, esperando uma cobrança. Quem desconta de fato é
  // a create-renewal-prod, no servidor; aqui é só o preço que a pessoa vê antes
  // de clicar — se a tela mostrasse o valor cheio, o checkout pareceria errado.
  const { data: cupom } = useQuery({
    queryKey: ["cupom-reservado", tenantId],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("tenant_pending_promo", {
        p_tenant_id: tenantId as string,
      });
      if (error) throw error;
      return (Array.isArray(data) ? data[0] : data) ?? null;
    },
  });

  // O cupom pode valer só para alguns planos. A conferência final é do servidor;
  // esta aqui evita prometer desconto no card errado.
  const cupomVale = (planCode: string) =>
    !!cupom && (cupom.plan_codes === null || cupom.plan_codes.includes(planCode));

  const emCheckout = pendente !== null;

  const economiaAnual = (planos ?? []).some(
    (p) =>
      p.price_year_cents !== null &&
      p.price_month_cents !== null &&
      p.price_year_cents < p.price_month_cents * 12,
  );

  async function contratar(code: string) {
    setPendente(code);
    try {
      const { data, error } = await supabase.functions.invoke<CheckoutResult>(
        "create-renewal-prod",
        { body: { plan_code: code, billing_cycle: cycle } },
      );
      if (error) throw error;
      const url = data?.checkout_url;
      if (!url) throw new Error("resposta sem checkout_url");
      // Mantém o estado de carregando até o navegador sair da página.
      window.location.href = url;
    } catch (err) {
      toast.error(await mensagemDeErro(err));
      setPendente(null);
    }
  }

  const titulo = reason === "renovar" ? "Renovar seu plano" : "Escolha seu plano";
  const descricao =
    reason === "renovar"
      ? "Escolha o plano e a forma de cobrança para renovar o acesso."
      : "Selecione o plano e a forma de cobrança para ativar o acesso completo.";

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && emCheckout) return;
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>

        <div className="inline-flex w-fit items-center gap-1 rounded-md border border-border/60 p-1">
          <Button
            type="button"
            size="sm"
            variant={cycle === "monthly" ? "secondary" : "ghost"}
            disabled={emCheckout}
            onClick={() => setCycle("monthly")}
          >
            Mensal
          </Button>
          <Button
            type="button"
            size="sm"
            variant={cycle === "annual" ? "secondary" : "ghost"}
            disabled={emCheckout}
            onClick={() => setCycle("annual")}
          >
            Anual
            {economiaAnual && (
              <span className="ml-2 rounded-sm bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                economize
              </span>
            )}
          </Button>
        </div>

        {isPending ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando planos…</p>
        ) : isError ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <p className="text-sm text-muted-foreground">Não foi possível carregar os planos.</p>
            <Button type="button" size="sm" variant="outline" onClick={() => void refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {(planos ?? []).map((plano) => {
              const preco = cycle === "annual" ? plano.price_year_cents : plano.price_month_cents;
              const semPreco = preco === null;
              const excedeUsuarios = plano.max_users !== null && plano.max_users < activeUsers;
              const desabilitado = semPreco || excedeUsuarios || emCheckout;
              const atual = plano.code === currentPlanCode;

              return (
                <div
                  key={plano.code}
                  className={
                    "flex flex-col gap-2 rounded-md border border-border/60 p-4 " +
                    (excedeUsuarios || semPreco ? "opacity-60" : "")
                  }
                >
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{plano.name}</p>
                    {atual && (
                      <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        Plano atual
                      </span>
                    )}
                  </div>

                  {semPreco ? (
                    <p className="text-sm text-muted-foreground">Preço indisponível</p>
                  ) : (
                    (() => {
                      const comCupom = cupomVale(plano.code) && cupom!.discount_percent !== null;
                      const cobrado = comCupom
                        ? Math.round((preco * (100 - cupom!.discount_percent)) / 100)
                        : preco;
                      return (
                        <div>
                          <p className="text-xl font-semibold">
                            {emReais(cycle === "annual" ? cobrado / 12 : cobrado)}
                            <span className="text-sm font-normal text-muted-foreground">/mês</span>
                          </p>
                          {comCupom && (
                            <p className="text-xs text-muted-foreground">
                              <span className="line-through">
                                {emReais(cycle === "annual" ? preco / 12 : preco)}
                              </span>{" "}
                              <span className="text-primary">
                                cupom {cupom!.code} · {cupom!.discount_percent}% OFF
                              </span>
                            </p>
                          )}
                          {cycle === "annual" && (
                            <p className="text-xs text-muted-foreground">
                              cobrado {emReais(cobrado)}/ano
                            </p>
                          )}
                        </div>
                      );
                    })()
                  )}

                  <p className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {plano.max_users === null
                      ? "usuários ilimitados"
                      : `até ${plano.max_users} usuários`}
                  </p>

                  {excedeUsuarios && (
                    <p className="text-xs text-warning">
                      {`Seu tenant tem ${activeUsers} usuários ativos; este plano permite ${plano.max_users}.`}
                    </p>
                  )}

                  <Button
                    type="button"
                    size="sm"
                    className="mt-auto"
                    disabled={desabilitado}
                    onClick={() => void contratar(plano.code)}
                  >
                    {pendente === plano.code && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    )}
                    {reason === "renovar" ? "Renovar com este plano" : "Assinar este plano"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {cupom && (
          <p className="text-xs text-muted-foreground">
            Cupom <span className="font-mono">{cupom.code}</span>:{" "}
            {cupom.discount_months === null || cycle === "annual"
              ? // No anual a cobrança é única — o prazo em meses não tem onde valer.
                `${cupom.discount_percent}% de desconto nesta cobrança.`
              : `${cupom.discount_percent}% de desconto nas primeiras ${cupom.discount_months} cobranças; depois o valor volta ao normal.`}
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Precisa de mais?{" "}
          <a
            href="https://acessofast.com.br/#contato"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            Fale com o time para o plano Enterprise.
          </a>
        </p>
      </DialogContent>
    </Dialog>
  );
}
