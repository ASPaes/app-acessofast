import * as React from "react";
import { cx } from "@preview/lib/cx";

/**
 * Cor categórica de métrica.
 * ---------------------------------------------------------------------------
 * Cada métrica do painel tem uma cor fixa — CPU é ciano, memória é violeta,
 * disco é âmbar, e assim por diante. Não é enfeite: com 4 a 6 cartões lado a
 * lado, a cor é o que permite reencontrar a métrica certa sem reler os rótulos.
 *
 * Os seis tons são escolhidos pela MENOR distância perceptual entre dois deles
 * (CIEDE2000), não por gosto — o par mais próximo é o que decide se a
 * codificação funciona. Ver a justificativa em tokens.css.
 *
 * Por ser um código de cor, ele **nunca carrega o significado sozinho**: o
 * rótulo textual está sempre ali. Estado (online/offline/erro) continua saindo
 * do vocabulário semântico em `badge.tsx`, não daqui.
 */
export type VizTone = "blue" | "emerald" | "amber" | "violet" | "cyan" | "lime";

const TONES: Record<VizTone, { fg: string; bg: string }> = {
  blue: {
    fg: "text-[var(--af-viz-blue)]",
    bg: "bg-[color-mix(in_oklab,var(--af-viz-blue)_15%,transparent)]",
  },
  emerald: {
    fg: "text-[var(--af-viz-emerald)]",
    bg: "bg-[color-mix(in_oklab,var(--af-viz-emerald)_15%,transparent)]",
  },
  amber: {
    fg: "text-[var(--af-viz-amber)]",
    bg: "bg-[color-mix(in_oklab,var(--af-viz-amber)_15%,transparent)]",
  },
  violet: {
    fg: "text-[var(--af-viz-violet)]",
    bg: "bg-[color-mix(in_oklab,var(--af-viz-violet)_15%,transparent)]",
  },
  cyan: {
    fg: "text-[var(--af-viz-cyan)]",
    bg: "bg-[color-mix(in_oklab,var(--af-viz-cyan)_15%,transparent)]",
  },
  lime: {
    fg: "text-[var(--af-viz-lime)]",
    bg: "bg-[color-mix(in_oklab,var(--af-viz-lime)_15%,transparent)]",
  },
};

export const vizFg = (tone: VizTone) => TONES[tone].fg;
export const vizBg = (tone: VizTone) => TONES[tone].bg;

/** Ícone de métrica dentro do quadradinho colorido. */
export function VizIcon({
  tone,
  children,
  size = "md",
  className,
}: {
  tone: VizTone;
  children: React.ReactNode;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cx(
        "grid shrink-0 place-items-center rounded-md",
        size === "sm" ? "size-7 [&_svg]:size-3.5" : "size-8 [&_svg]:size-4",
        TONES[tone].bg,
        TONES[tone].fg,
        className,
      )}
    >
      {children}
    </span>
  );
}
