import type { ReactNode } from "react";

export type MetricItem = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
};

export function MetricStrip({ items }: { items: MetricItem[] }) {
  return (
    <div className="rounded-md border border-border/60 bg-card overflow-hidden">
      <div className="grid divide-x divide-border/60" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((it) => (
          <div key={it.label} className="px-5 py-4 flex flex-col justify-center min-h-[88px]">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-medium">
                {it.label}
              </span>
              {it.icon && <span className="text-muted-foreground/70">{it.icon}</span>}
            </div>
            <div className="text-[22px] leading-none font-semibold tabular-nums text-foreground">
              {it.value}
            </div>
            {it.hint && (
              <div className="text-[11px] text-muted-foreground mt-1.5">{it.hint}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}