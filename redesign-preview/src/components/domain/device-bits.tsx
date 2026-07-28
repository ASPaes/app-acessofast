import * as React from "react";
import { cx } from "@preview/lib/cx";
import { StatusBadge, type Tone } from "@preview/components/ui/badge";
import { tempoRelativo, restante } from "@preview/lib/format";
import {
  MARCADORES,
  type Consumo,
  type MarcadorCor,
  type StatusDispositivo,
} from "@preview/data/mock";

/**
 * Vocabulário de estado do dispositivo.
 * Regra do redesign: cor + ponto + rótulo — nunca só cor.
 *   online       verde
 *   atendimento  âmbar — mesmo tom do painel atual. O azul foi testado e
 *                descartado: competia com a marca e com o botão Conectar.
 *   offline      cinza
 *   inativo      cinza, com a linha inteira esmaecida
 */
const MAPA: Record<StatusDispositivo, { tone: Tone; rotulo: string; pulse: boolean }> = {
  online: { tone: "success", rotulo: "Online", pulse: false },
  atendimento: { tone: "warning", rotulo: "Em atendimento", pulse: true },
  offline: { tone: "neutral", rotulo: "Offline", pulse: false },
  inativo: { tone: "neutral", rotulo: "Inativo", pulse: false },
};

export function DeviceStatus({
  status,
  lastOnline,
}: {
  status: StatusDispositivo;
  lastOnline: string | null;
}) {
  const m = MAPA[status];
  const sufixo = status === "offline" && lastOnline ? ` · ${tempoRelativo(lastOnline)}` : "";
  return (
    <StatusBadge tone={m.tone} pulse={m.pulse}>
      {m.rotulo}
      {sufixo}
    </StatusBadge>
  );
}

/** Ícone de monitor colorido conforme o estado — reforço visual, não a única pista. */
export function DeviceGlyph({
  status,
  size = "md",
}: {
  status: StatusDispositivo;
  size?: "sm" | "md" | "lg";
}) {
  const cor =
    status === "atendimento"
      ? "text-warning bg-warning-soft"
      : status === "online"
        ? "text-success bg-success-soft"
        : "text-muted bg-surface-2";
  const box = { sm: "size-7", md: "size-8", lg: "size-10" }[size];
  const ico = { sm: "size-3.5", md: "size-4", lg: "size-5" }[size];
  return (
    <span
      aria-hidden
      className={cx(
        "grid shrink-0 place-items-center rounded-md border border-line-subtle",
        box,
        cor,
      )}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={ico}>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" strokeLinecap="round" />
      </svg>
    </span>
  );
}

const CORES_MARCADOR: Record<MarcadorCor, { chip: string; dot: string }> = {
  azul: {
    chip: "border-[color-mix(in_oklab,var(--af-info)_32%,transparent)] bg-info-soft text-info",
    dot: "bg-info",
  },
  verde: {
    chip: "border-[color-mix(in_oklab,var(--af-success)_32%,transparent)] bg-success-soft text-success",
    dot: "bg-success",
  },
  ambar: {
    chip: "border-[color-mix(in_oklab,var(--af-warning)_32%,transparent)] bg-warning-soft text-warning",
    dot: "bg-warning",
  },
  vermelho: {
    chip: "border-[color-mix(in_oklab,var(--af-danger)_32%,transparent)] bg-danger-soft text-danger",
    dot: "bg-danger",
  },
  violeta: {
    chip: "border-[color-mix(in_oklab,#a78bfa_32%,transparent)] bg-[color-mix(in_oklab,#a78bfa_12%,transparent)] text-[#b9a5fb]",
    dot: "bg-[#a78bfa]",
  },
  cinza: { chip: "border-line bg-neutral-soft text-muted", dot: "bg-muted" },
};

export function marcadorPorId(id: string) {
  return MARCADORES.find((m) => m.id === id) ?? null;
}

export function MarkerChip({ id }: { id: string }) {
  const m = marcadorPorId(id);
  if (!m) return null;
  const c = CORES_MARCADOR[m.cor];
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded border px-1.5 py-[1px] text-[10.5px] font-medium leading-none",
        c.chip,
      )}
    >
      {m.label}
    </span>
  );
}

export function MarkerDot({ cor }: { cor: MarcadorCor }) {
  return (
    <span aria-hidden className={cx("size-2 shrink-0 rounded-full", CORES_MARCADOR[cor].dot)} />
  );
}

/**
 * Selo de consumo do atendimento aberto (coluna "Consumo").
 * Mantém a mesma semântica atual: grátis corta em 2h, crédito só marca a
 * janela de reconexão, sessão de suporte (plan em conta metrada) não é cobrada.
 */
export function ConsumoBadge({ consumo, agora }: { consumo: Consumo | null; agora: number }) {
  if (!consumo) return <span className="text-muted">—</span>;
  if (consumo.fonte === "plan") {
    return <StatusBadge tone="neutral">Suporte</StatusBadge>;
  }
  const gratis = consumo.fonte === "free";
  return (
    <span
      title={
        gratis ? "Corte automático da sessão grátis" : "Reconexão sem custo até o fim da janela"
      }
    >
      <StatusBadge tone={gratis ? "success" : "primary"}>
        {gratis ? "Grátis" : "Crédito"} ·{" "}
        <span className="af-num">{restante(consumo.restanteMs - (agora % 1000))}</span>
      </StatusBadge>
    </span>
  );
}
