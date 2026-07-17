import { cn } from "@/lib/utils";

type Tone = "online" | "warning" | "offline" | "neutral";

const toneClass: Record<Tone, string> = {
  online: "bg-emerald-500 shadow-[0_0_8px_theme(colors.emerald.500)]",
  warning: "bg-amber-500 shadow-[0_0_8px_theme(colors.amber.500)]",
  offline: "bg-red-500",
  neutral: "bg-muted-foreground/50",
};

export function StatusDot({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-xs text-muted-foreground",
        className,
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          tone === "online" && "animate-pulse",
          toneClass[tone],
        )}
      />
      {children}
    </span>
  );
}