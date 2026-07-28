import * as React from "react";
import { AlertTriangle, Info, CheckCircle2, XCircle } from "lucide-react";
import { cx } from "@preview/lib/cx";
import { Button } from "./button";

/* -------------------------------------------------------------------------- */
/* Skeleton                                                                    */
/* -------------------------------------------------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("af-skeleton rounded-md", className)} />;
}

export function SkeletonRows({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i}>
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className="h-[var(--af-row-h)] border-b border-line-subtle px-3">
              <Skeleton className={cx("h-3.5", j === 0 ? "w-40" : "w-20")} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cx("h-3.5", i === lines - 1 ? "w-2/5" : "w-full")} />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Estado vazio                                                                */
/* -------------------------------------------------------------------------- */

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2 py-10" : "gap-3 py-16",
      )}
    >
      {icon ? (
        <div className="grid size-11 place-items-center rounded-xl border border-line-subtle bg-surface-2 text-muted [&_svg]:size-5">
          {icon}
        </div>
      ) : null}
      <div className="max-w-[42ch] space-y-1">
        <p className="text-[14px] font-medium text-ink">{title}</p>
        {description ? (
          <p className="text-[13px] leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Estado de erro                                                              */
/* -------------------------------------------------------------------------- */

export function ErrorState({
  title = "Não foi possível carregar",
  description = "A consulta falhou. Tente novamente — se persistir, avise o administrador da conta.",
  onRetry,
  compact = false,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={cx(
        "flex flex-col items-center justify-center gap-3 text-center",
        compact ? "py-10" : "py-16",
      )}
    >
      <div className="grid size-11 place-items-center rounded-xl border border-[color-mix(in_oklab,var(--af-danger)_28%,transparent)] bg-danger-soft text-danger">
        <AlertTriangle className="size-5" aria-hidden />
      </div>
      <div className="max-w-[46ch] space-y-1">
        <p className="text-[14px] font-medium text-ink">{title}</p>
        <p className="text-[13px] leading-relaxed text-muted">{description}</p>
      </div>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Tentar de novo
        </Button>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Alert (faixa informativa dentro do conteúdo)                                */
/* -------------------------------------------------------------------------- */

const alertTones = {
  info: {
    box: "border-[color-mix(in_oklab,var(--af-info)_28%,transparent)] bg-info-soft",
    fg: "text-info",
    Icon: Info,
  },
  warning: {
    box: "border-[color-mix(in_oklab,var(--af-warning)_28%,transparent)] bg-warning-soft",
    fg: "text-warning",
    Icon: AlertTriangle,
  },
  danger: {
    box: "border-[color-mix(in_oklab,var(--af-danger)_28%,transparent)] bg-danger-soft",
    fg: "text-danger",
    Icon: XCircle,
  },
  success: {
    box: "border-[color-mix(in_oklab,var(--af-success)_28%,transparent)] bg-success-soft",
    fg: "text-success",
    Icon: CheckCircle2,
  },
  neutral: {
    box: "border-line-subtle bg-surface-2",
    fg: "text-muted",
    Icon: Info,
  },
} as const;

export function Alert({
  tone = "neutral",
  title,
  children,
  action,
  className,
}: {
  tone?: keyof typeof alertTones;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const t = alertTones[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cx(
        "flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3",
        t.box,
        className,
      )}
    >
      <t.Icon className={cx("mt-[2px] size-4 shrink-0", t.fg)} aria-hidden />
      <div className="min-w-0 flex-1">
        {title ? <p className={cx("text-[13px] font-medium", t.fg)}>{title}</p> : null}
        {children ? (
          <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">{children}</div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Progress                                                                    */
/* -------------------------------------------------------------------------- */

export function Progress({
  value,
  tone = "primary",
  label,
}: {
  value: number;
  tone?: "primary" | "success" | "warning" | "danger";
  label?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const bar = {
    primary: "bg-primary",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
  }[tone];
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
    >
      <div
        className={cx(
          "h-full rounded-full transition-[width] duration-500 ease-[var(--af-ease)]",
          bar,
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
