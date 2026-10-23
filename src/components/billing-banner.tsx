import { useEffect, useState } from "react";
import { AlertTriangle, CreditCard, Ban, Clock, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlanPickerDialog } from "@/components/plan-picker-dialog";

type Props = {
  status: string | null | undefined;
  invoiceUrl: string | null | undefined;
  pastDueSince: string | null | undefined;
  canPay: boolean;
  isTrial: boolean | null | undefined;
  planExpiresAt: string | null | undefined;
  billingExempt: boolean | null | undefined;
  currentPlanCode: string | null | undefined;
  activeUsers: number | null | undefined;
  /**
   * Conta sem ciclo de plano: modo free/créditos e plano sem preço (Individual
   * grátis) ou sem plano. Nessas contas não existe teste nem vencimento — os
   * campos legados `is_trial`/`plan_expires_at` podem chegar preenchidos por um
   * cadastro que passou pelo caminho de trial, e não podem virar faixa.
   */
  contaGratuita: boolean;
  /**
   * A conta nunca pagou pelo Asaas (sem cliente lá). Com data de fim gravada e
   * fora do teste, é a conta que usava o AcessoFast sem cobrança e ganhou prazo
   * para contratar: o aviso é "contrate", não "renove".
   */
  nuncaContratou: boolean;
};

type Estado =
  | "trial_expirado"
  | "trial_ativo"
  | "prazo_encerrado"
  | "plano_vencido"
  | "suspenso"
  | "past_due"
  | "contratar"
  | "vencendo";

const DIAS_CARENCIA = 5;
const DIAS_AVISO_VENCIMENTO = 30;

function diasAte(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export function BillingBanner({
  status,
  invoiceUrl,
  pastDueSince,
  canPay,
  isTrial,
  planExpiresAt,
  billingExempt,
  currentPlanCode,
  activeUsers,
  contaGratuita,
  nuncaContratou,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);

  // A contagem de dias é calculada ao desenhar. Sem redesenhar de tempos em
  // tempos, uma aba aberta de um dia para o outro mostraria o número de ontem.
  const [, setRelogio] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setRelogio((n) => n + 1), 30 * 60_000);
    return () => clearInterval(id);
  }, []);

  function handleCheckout() {
    setPickerOpen(true);
  }

  // Conta gratuita não tem teste nem data de vencimento: ignora os campos
  // legados em vez de anunciar um prazo que não existe para ela.
  const emTeste = !!isTrial && !contaGratuita;
  const prazoParaContratar =
    !emTeste && !billingExempt && !contaGratuita && !!planExpiresAt && nuncaContratou;
  const prazoPassou = !!planExpiresAt && new Date(planExpiresAt) < new Date();

  let resolvido: Estado | null = null;
  if (emTeste && status === "suspended") {
    resolvido = "trial_expirado";
  } else if (emTeste && !billingExempt) {
    resolvido = "trial_ativo";
  } else if (status === "suspended" && prazoParaContratar && prazoPassou && !invoiceUrl) {
    resolvido = "prazo_encerrado";
  } else if (status === "suspended" && prazoPassou && !invoiceUrl) {
    resolvido = "plano_vencido";
  } else if (status === "suspended") {
    resolvido = "suspenso";
  } else if (status === "past_due") {
    resolvido = "past_due";
  } else if (prazoParaContratar) {
    // Sem limite de antecedência: o aviso fica no ar o prazo inteiro.
    resolvido = "contratar";
  } else if (
    !emTeste &&
    !billingExempt &&
    !contaGratuita &&
    planExpiresAt &&
    diasAte(planExpiresAt) <= DIAS_AVISO_VENCIMENTO
  ) {
    resolvido = "vencendo";
  }

  if (!resolvido) return null;

  const estado = resolvido;
  const legado = estado === "suspenso" || estado === "past_due";
  const suspenso = estado === "suspenso";

  let prazo = "";
  if (estado === "past_due" && pastDueSince) {
    const limite = new Date(pastDueSince);
    limite.setDate(limite.getDate() + DIAS_CARENCIA);
    prazo = limite.toLocaleDateString("pt-BR");
  }

  const dias = planExpiresAt ? diasAte(planExpiresAt) : null;
  const data = planExpiresAt ? new Date(planExpiresAt).toLocaleDateString("pt-BR") : "";

  let cor = "border-destructive/40 bg-destructive/10 text-destructive";
  if (
    estado === "past_due" ||
    estado === "vencendo" ||
    (estado === "contratar" && dias !== null && dias > 3) ||
    (estado === "trial_ativo" && dias !== null && dias <= 2)
  ) {
    cor = "border-warning/40 bg-warning/10 text-warning";
  } else if (estado === "trial_ativo") {
    cor = "border-primary/40 bg-primary/10 text-primary";
  }

  const Icone =
    estado === "past_due"
      ? AlertTriangle
      : estado === "trial_ativo"
        ? Clock
        : estado === "vencendo" || estado === "contratar"
          ? CalendarClock
          : Ban;

  let titulo: string;
  let corpo: string;
  switch (estado) {
    case "trial_expirado":
      titulo = "Seu teste grátis terminou";
      corpo =
        "As conexões remotas estão bloqueadas. Escolha um plano para reativar o acesso agora.";
      break;
    case "trial_ativo":
      if (dias === null) {
        titulo = "Teste grátis em andamento";
        corpo = "Assine para manter o acesso após o período de teste.";
      } else {
        titulo =
          dias === 0
            ? "Seu teste grátis termina hoje"
            : dias === 1
              ? "Seu teste grátis termina amanhã"
              : `Teste grátis: faltam ${dias} dias`;
        corpo = `Assine agora para não perder o acesso em ${data}.`;
      }
      break;
    case "contratar":
      // `dias` conta até o bloqueio (meia-noite de Brasília): com 1, hoje é o
      // último dia; com 0, o bloqueio já está em cima.
      titulo =
        dias === 0
          ? "O prazo para contratar o seu plano está acabando"
          : dias === 1
            ? "Hoje é o último dia para contratar o seu plano"
            : `Faltam ${dias} dias para contratar o seu plano`;
      corpo =
        dias === 0
          ? "O AcessoFast agora é pago. Contrate agora para não ter o acesso remoto bloqueado."
          : dias === 1
            ? `O AcessoFast agora é pago. Sem a contratação, o acesso remoto será bloqueado amanhã, ${data}.`
            : `O AcessoFast agora é pago. Sem a contratação, o acesso remoto será bloqueado em ${data}.`;
      break;
    case "prazo_encerrado":
      titulo = "O prazo para contratar o plano terminou";
      corpo =
        "As conexões remotas estão bloqueadas. Contrate um plano para liberar o acesso assim que o pagamento for confirmado.";
      break;
    case "plano_vencido":
      titulo = "Seu plano venceu";
      corpo = "As conexões remotas estão bloqueadas. Renove para reativar o acesso agora.";
      break;
    case "vencendo":
      titulo = `Seu plano vence em ${data}`;
      corpo = "Renove antes do vencimento para não interromper o acesso remoto.";
      break;
    case "suspenso":
      titulo = "Acesso remoto bloqueado por falta de pagamento";
      corpo =
        "Novas conexões estão bloqueadas. Regularize o pagamento para reativar imediatamente.";
      break;
    default:
      titulo = "Pagamento pendente";
      corpo = prazo
        ? `Regularize até ${prazo} para não perder o acesso remoto.`
        : "Regularize o pagamento para não perder o acesso remoto.";
  }

  const acaoDestrutiva =
    estado === "trial_expirado" || estado === "plano_vencido" || estado === "prazo_encerrado";
  const contratacao = estado === "contratar" || estado === "prazo_encerrado";
  const rotuloAcao =
    estado === "trial_expirado" || estado === "trial_ativo"
      ? "Assinar agora"
      : contratacao
        ? "Contratar plano"
        : "Renovar plano";
  const reason =
    estado === "trial_ativo" || estado === "trial_expirado" || contratacao ? "assinar" : "renovar";

  return (
    <>
      <div
        role="status"
        className={"flex flex-wrap items-center gap-3 border-b px-4 py-3 text-[13px] " + cor}
      >
        <Icone className="h-4 w-4 shrink-0" aria-hidden />

        <div className="min-w-0 flex-1">
          <p className="font-medium">{titulo}</p>
          <p className="opacity-90">{corpo}</p>
        </div>

        {legado ? (
          canPay && invoiceUrl ? (
            <Button
              size="sm"
              variant={suspenso ? "destructive" : "default"}
              onClick={() => window.open(invoiceUrl, "_blank", "noopener,noreferrer")}
            >
              <CreditCard className="mr-2 h-4 w-4" />
              Regularizar pagamento
            </Button>
          ) : (
            <span className="opacity-90">
              {suspenso ? "Bloqueio financeiro." : "Pendência financeira."} Entre em contato com seu
              administrador responsável.
            </span>
          )
        ) : canPay ? (
          <Button
            size="sm"
            variant={acaoDestrutiva ? "destructive" : "default"}
            onClick={() => handleCheckout()}
          >
            <CreditCard className="mr-2 h-4 w-4" />
            {rotuloAcao}
          </Button>
        ) : (
          <span className="opacity-90">Entre em contato com o administrador da conta.</span>
        )}
      </div>

      <PlanPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        currentPlanCode={currentPlanCode}
        activeUsers={activeUsers ?? 0}
        reason={reason}
      />
    </>
  );
}
