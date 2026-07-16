import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>
        )}
        {meta && (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
            {meta}
          </div>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

export function SectionHeader({
  title,
  count,
  hint,
  actions,
}: {
  title: string;
  count?: number | string;
  hint?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border-subtle pb-3">
      <div className="flex items-baseline gap-3 min-w-0">
        <h2 className="text-[14px] font-semibold text-foreground">{title}</h2>
        {count !== undefined && (
          <span className="text-[12px] tabular-nums text-text-dim font-mono">
            {count}
          </span>
        )}
        {hint && (
          <span className="text-[12px] text-muted-foreground">{hint}</span>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}