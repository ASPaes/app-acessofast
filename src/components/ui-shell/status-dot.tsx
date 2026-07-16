import type { ReactNode } from "react";

export type StatusTone = "online" | "warning" | "danger" | "neutral" | "active";

const toneClass: Record<StatusTone, string> = {
  online: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-text-dim",
  active: "bg-primary",
};

const textClass: Record<StatusTone, string> = {
  online: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  neutral: "text-text-dim",
  active: "text-primary",
};

export function StatusDot({
  tone = "neutral",
  children,
  pulse = false,
  className = "",
}: {
  tone?: StatusTone;
  children?: ReactNode;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] ${textClass[tone]} ${className}`}>
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${toneClass[tone]} ${pulse ? "animate-pulse" : ""}`}
        aria-hidden
      />
      {children}
    </span>
  );
}