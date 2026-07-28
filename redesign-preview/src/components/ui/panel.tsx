import * as React from "react";
import { cx } from "@preview/lib/cx";

/**
 * Painel = a única "caixa" do sistema.
 * Regra do redesign: nem tudo mora dentro de um painel. Hierarquia vem de
 * espaçamento e variação de superfície; o painel só entra quando o conteúdo é
 * mesmo uma unidade (uma tabela, um bloco de métricas, um formulário).
 */
export function Panel({
  className,
  flush = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { flush?: boolean }) {
  return (
    <section
      className={cx(
        // `af-panel` é o gancho do acabamento translúcido (ver app.css). No modo
        // sólido estas classes valem; no modo vidro a regra com data-attribute
        // as sobrepõe por especificidade.
        "af-panel",
        "rounded-xl border border-line-subtle bg-surface shadow-md",
        "ring-1 ring-inset ring-white/[0.035]",
        flush ? "overflow-hidden" : "",
        className,
      )}
      {...props}
    />
  );
}

export function PanelHeader({
  title,
  description,
  icon,
  actions,
  className,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <header
      className={cx(
        "flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 py-4",
        (title || description) && "border-b border-line-subtle",
        className,
      )}
    >
      {(title || description) && (
        <div className="flex min-w-0 items-start gap-2.5">
          {icon ? <span className="mt-[3px] text-muted [&_svg]:size-4">{icon}</span> : null}
          <div className="min-w-0">
            {title ? (
              <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">
                {title}
              </h2>
            ) : null}
            {description ? <p className="mt-0.5 text-[12.5px] text-muted">{description}</p> : null}
          </div>
        </div>
      )}
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      {children}
    </header>
  );
}

export function PanelBody({
  className,
  padded = true,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { padded?: boolean }) {
  return <div className={cx(padded && "px-5 py-4", className)} {...props} />;
}

export function PanelFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <footer
      className={cx(
        "flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle px-5 py-3",
        "text-[12.5px] text-muted",
        className,
      )}
      {...props}
    />
  );
}

/** Divisor sutil para separar blocos dentro de um painel. */
export function Divider({ className }: { className?: string }) {
  return <div aria-hidden className={cx("h-px w-full bg-line-subtle", className)} />;
}
