import * as React from "react";
import { cx } from "@preview/lib/cx";

export type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-neutral-soft text-ink-2 border-line",
  primary:
    "bg-primary-soft text-primary-light border-[color-mix(in_oklab,var(--af-primary)_32%,transparent)]",
  success:
    "bg-success-soft text-success border-[color-mix(in_oklab,var(--af-success)_30%,transparent)]",
  warning:
    "bg-warning-soft text-warning border-[color-mix(in_oklab,var(--af-warning)_30%,transparent)]",
  danger:
    "bg-danger-soft text-danger border-[color-mix(in_oklab,var(--af-danger)_30%,transparent)]",
  info: "bg-info-soft text-info border-[color-mix(in_oklab,var(--af-info)_30%,transparent)]",
};

const dots: Record<Tone, string> = {
  neutral: "bg-muted",
  primary: "bg-primary-light",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

export function Badge({
  tone = "neutral",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cx(
        "inline-flex w-fit items-center gap-1.5 rounded-md border px-2 py-[3px]",
        "text-[11.5px] font-medium leading-none",
        tones[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

/**
 * Estado nunca é comunicado só por cor: o ponto vem sempre acompanhado do
 * rótulo textual, e leitores de tela recebem o texto normalmente.
 */
export function StatusBadge({
  tone = "neutral",
  pulse = false,
  children,
  className,
}: {
  tone?: Tone;
  pulse?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Badge tone={tone} className={className}>
      <span
        aria-hidden
        className={cx("h-1.5 w-1.5 shrink-0 rounded-full", dots[tone], pulse && "af-anim-breathe")}
      />
      {children}
    </Badge>
  );
}

/**
 * Ponto de estado isolado.
 * `inline-block` é obrigatório: `<span>` é inline por padrão e ignora
 * largura/altura — sem isso o ponto some em todo contexto que não seja flex.
 */
export function Dot({ tone = "neutral", className }: { tone?: Tone; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("inline-block h-2 w-2 shrink-0 rounded-full", dots[tone], className)}
    />
  );
}
