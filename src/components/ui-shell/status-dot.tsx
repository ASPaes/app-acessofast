import { cn } from "@/lib/utils";

type Tone = "online" | "warning" | "offline" | "neutral";

// Cor de ESTADO: sai do vocabulário semântico (--af-success/warning/danger),
// não da paleta crua do Tailwind. O brilho usa a mesma variável do ponto, para
// não haver dois tons de "verde de online" no mesmo pixel.
const toneClass: Record<Tone, string> = {
  online: "bg-success shadow-[0_0_8px_var(--af-success)]",
  warning: "bg-warning shadow-[0_0_8px_var(--af-warning)]",
  offline: "bg-destructive",
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