import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${
        compact ? "py-8" : "py-14"
      }`}
    >
      {Icon && (
        <div className="mb-3 text-text-dim">
          <Icon className="h-5 w-5" strokeWidth={1.5} />
        </div>
      )}
      <div className="text-[13px] font-medium text-foreground">{title}</div>
      {description && (
        <div className="mt-1 max-w-sm text-[12px] text-muted-foreground">
          {description}
        </div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}