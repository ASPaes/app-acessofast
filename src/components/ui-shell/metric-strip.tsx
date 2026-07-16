import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export type MetricItemData = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  loading?: boolean;
};

export function MetricStrip({ items }: { items: MetricItemData[] }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface">
      <div className="grid divide-x divide-border-subtle" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((it, i) => (
          <MetricItem key={i} {...it} />
        ))}
      </div>
    </div>
  );
}

function MetricItem({ label, value, hint, icon: Icon, loading }: MetricItemData) {
  return (
    <div className="flex flex-col gap-1.5 px-5 py-4 min-w-0">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-3.5 w-3.5 text-text-dim" strokeWidth={1.75} />}
        <span className="text-[10.5px] uppercase tracking-[0.14em] text-text-dim font-medium">
          {label}
        </span>
      </div>
      {loading ? (
        <Skeleton className="h-7 w-16" />
      ) : (
        <div className="text-[22px] font-semibold tabular-nums text-foreground leading-none font-mono">
          {value}
        </div>
      )}
      {hint && (
        <div className="text-[11px] text-muted-foreground truncate">{hint}</div>
      )}
    </div>
  );
}