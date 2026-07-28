import * as React from "react";
import { AlertTriangle, Ban, CalendarClock, Clock, CreditCard } from "lucide-react";
import { cx } from "@preview/lib/cx";
import { Button } from "@preview/components/ui/button";
import type { EstadoBanner } from "@preview/data/preview-state";

/**
 * Faixa de cobrança — mesmos seis estados e os mesmos textos do componente
 * atual. Só a apresentação muda: a faixa deixa de ser um bloco chapado e passa
 * a ter marca lateral de severidade, título + corpo em duas linhas e a ação à
 * direita, alinhada com o resto do sistema.
 */
export function BillingBanner({
  estado,
  podePagar = true,
  onAcao,
}: {
  estado: EstadoBanner;
  podePagar?: boolean;
  onAcao?: () => void;
}) {
  if (estado === "nenhum") return null;

  const cfg = CONFIG[estado];

  return (
    <div
      role="status"
      // `af-faixa` + `--af-tinta`: a tinta de estado é 12% de opacidade, então
      // pintada direto sobre a atmosfera deixava a constelação passar por trás
      // do texto do aviso. A regra em app.css pinta a mesma tinta sobre uma
      // base opaca — a cor final é a de sempre, sem as bolinhas atrás.
      style={{ "--af-tinta": cfg.tinta } as React.CSSProperties}
      className={cx(
        "af-faixa flex flex-wrap items-center gap-x-4 gap-y-3 border-b px-4 py-3 sm:px-6",
        cfg.box,
      )}
    >
      <span className={cx("grid size-8 shrink-0 place-items-center rounded-md", cfg.iconBox)}>
        <cfg.Icone className="size-4" aria-hidden />
      </span>

      <div className="min-w-0 flex-1">
        <p className={cx("text-[13px] font-semibold", cfg.fg)}>{cfg.titulo}</p>
        <p className="text-[12.5px] leading-relaxed text-ink-2">{cfg.corpo}</p>
      </div>

      {podePagar ? (
        <Button
          size="sm"
          variant={cfg.destrutiva ? "danger" : "primary"}
          onClick={onAcao}
          className="shrink-0"
        >
          <CreditCard aria-hidden />
          {cfg.acao}
        </Button>
      ) : (
        <span className="text-[12.5px] text-muted">
          Entre em contato com o administrador da conta.
        </span>
      )}
    </div>
  );
}

const CONFIG: Record<
  Exclude<EstadoBanner, "nenhum">,
  {
    titulo: string;
    corpo: string;
    acao: string;
    destrutiva: boolean;
    Icone: typeof Clock;
    box: string;
    /** tinta de estado, aplicada sobre base opaca — ver `.af-faixa` em app.css */
    tinta: string;
    iconBox: string;
    fg: string;
  }
> = {
  trial_ativo: {
    titulo: "Teste grátis: faltam 4 dias",
    corpo: "Assine agora para não perder o acesso em 01/08/2026.",
    acao: "Assinar agora",
    destrutiva: false,
    Icone: Clock,
    box: "border-[color-mix(in_oklab,var(--af-primary)_30%,transparent)]",
    tinta: "var(--af-primary-soft)",
    iconBox: "bg-primary-soft-hover text-primary-light",
    fg: "text-primary-light",
  },
  trial_expirado: {
    titulo: "Seu teste grátis terminou",
    corpo: "As conexões remotas estão bloqueadas. Escolha um plano para reativar o acesso agora.",
    acao: "Assinar agora",
    destrutiva: true,
    Icone: Ban,
    box: "border-[color-mix(in_oklab,var(--af-danger)_30%,transparent)]",
    tinta: "var(--af-danger-soft)",
    iconBox: "bg-[color-mix(in_oklab,var(--af-danger)_18%,transparent)] text-danger",
    fg: "text-danger",
  },
  vencendo: {
    titulo: "Seu plano vence em 15/08/2026",
    corpo: "Renove antes do vencimento para não interromper o acesso remoto.",
    acao: "Renovar plano",
    destrutiva: false,
    Icone: CalendarClock,
    box: "border-[color-mix(in_oklab,var(--af-warning)_30%,transparent)]",
    tinta: "var(--af-warning-soft)",
    iconBox: "bg-[color-mix(in_oklab,var(--af-warning)_18%,transparent)] text-warning",
    fg: "text-warning",
  },
  past_due: {
    titulo: "Pagamento pendente",
    corpo: "Regularize até 02/08/2026 para não perder o acesso remoto.",
    acao: "Regularizar pagamento",
    destrutiva: false,
    Icone: AlertTriangle,
    box: "border-[color-mix(in_oklab,var(--af-warning)_30%,transparent)]",
    tinta: "var(--af-warning-soft)",
    iconBox: "bg-[color-mix(in_oklab,var(--af-warning)_18%,transparent)] text-warning",
    fg: "text-warning",
  },
  suspenso: {
    titulo: "Acesso remoto bloqueado por falta de pagamento",
    corpo: "Novas conexões estão bloqueadas. Regularize o pagamento para reativar imediatamente.",
    acao: "Regularizar pagamento",
    destrutiva: true,
    Icone: Ban,
    box: "border-[color-mix(in_oklab,var(--af-danger)_30%,transparent)]",
    tinta: "var(--af-danger-soft)",
    iconBox: "bg-[color-mix(in_oklab,var(--af-danger)_18%,transparent)] text-danger",
    fg: "text-danger",
  },
};
