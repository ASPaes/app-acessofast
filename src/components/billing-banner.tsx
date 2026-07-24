import { AlertTriangle, CreditCard, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  status: string | null | undefined;
  invoiceUrl: string | null | undefined;
  pastDueSince: string | null | undefined;
  canPay: boolean;
};

const DIAS_CARENCIA = 5;

export function BillingBanner({ status, invoiceUrl, pastDueSince, canPay }: Props) {
  if (status !== "past_due" && status !== "suspended") return null;

  const suspenso = status === "suspended";

  let prazo = "";
  if (!suspenso && pastDueSince) {
    const limite = new Date(pastDueSince);
    limite.setDate(limite.getDate() + DIAS_CARENCIA);
    prazo = limite.toLocaleDateString("pt-BR");
  }

  return (
    <div
      role="status"
      className={
        "flex flex-wrap items-center gap-3 border-b px-4 py-3 text-[13px] " +
        (suspenso
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-amber-500/40 bg-amber-500/10 text-amber-500")
      }
    >
      {suspenso ? (
        <Ban className="h-4 w-4 shrink-0" aria-hidden />
      ) : (
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      )}

      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {suspenso
            ? "Acesso remoto bloqueado por falta de pagamento"
            : "Pagamento pendente"}
        </p>
        <p className="opacity-90">
          {suspenso
            ? "Novas conexões estão bloqueadas. Regularize o pagamento para reativar imediatamente."
            : prazo
              ? `Regularize até ${prazo} para não perder o acesso remoto.`
              : "Regularize o pagamento para não perder o acesso remoto."}
        </p>
      </div>

      {canPay && invoiceUrl ? (
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
          {suspenso ? "Bloqueio financeiro." : "Pendência financeira."} Entre em
          contato com seu administrador responsável.
        </span>
      )}
    </div>
  );
}
