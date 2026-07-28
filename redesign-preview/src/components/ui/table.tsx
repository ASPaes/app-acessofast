import * as React from "react";
import { cx } from "@preview/lib/cx";

/**
 * Tabela do painel.
 * - Cabeçalho discreto e "sticky" (o técnico rola 200 linhas de auditoria).
 * - Sem borda em célula: só divisores horizontais sutis.
 * - Altura de linha vem do token --af-row-h (troca com a densidade).
 * - Rolagem horizontal fica contida no wrapper, o corpo da página nunca rola.
 */
export function TableWrap({
  className,
  children,
  minWidth = 720,
}: {
  className?: string;
  children: React.ReactNode;
  minWidth?: number;
}) {
  return (
    <div className={cx("af-scroll-x rounded-lg border border-line-subtle", className)}>
      <div style={{ minWidth }}>{children}</div>
    </div>
  );
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cx("w-full border-collapse text-[13px]", className)} {...props} />;
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cx("sticky top-0 z-[1] bg-surface-2 [&_th]:whitespace-nowrap", className)}
      {...props}
    />
  );
}

export function TH({
  className,
  align = "left",
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" | "center" }) {
  return (
    <th
      scope="col"
      className={cx(
        "h-9 border-b border-line-subtle px-3 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
        className,
      )}
      {...props}
    />
  );
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cx("[&_tr:last-child_td]:border-b-0", className)} {...props} />;
}

export function TR({
  className,
  interactive = false,
  muted = false,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean; muted?: boolean }) {
  return (
    <tr
      className={cx(
        "transition-colors duration-[var(--af-dur-hover)]",
        interactive && "cursor-pointer",
        "hover:bg-surface-hover/45",
        muted && "opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export function TD({
  className,
  align = "left",
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" | "center" }) {
  return (
    <td
      className={cx(
        "border-b border-line-subtle px-3 align-middle text-ink-2",
        "h-[var(--af-row-h)]",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
      {...props}
    />
  );
}

/** Célula de texto longo com truncamento + title nativo. */
export function Truncate({
  children,
  className,
  max = "max-w-[220px]",
}: {
  children: string;
  className?: string;
  max?: string;
}) {
  return (
    <span title={children} className={cx("block truncate", max, className)}>
      {children}
    </span>
  );
}
