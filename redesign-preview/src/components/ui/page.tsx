import * as React from "react";
import { cx } from "@preview/lib/cx";
import { VizIcon, type VizTone } from "./viz";

/**
 * Cabeçalho de página.
 * Banda fixa no topo do conteúdo: título, descrição e a ação principal sempre
 * no mesmo lugar em todas as telas. Filtros e controles ficam na Toolbar,
 * logo abaixo — separar os dois foi o que tirou os oito controles espremidos
 * dentro do CardHeader da tela de Dispositivos.
 */
export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em] text-ink">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-[74ch] text-[13.5px] leading-relaxed text-muted">
            {description}
          </p>
        ) : null}
        {meta ? <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** Faixa de filtros/controles. Agrupa por função: buscar | filtrar | visualizar. */
export function Toolbar({
  children,
  className,
  end,
}: {
  children?: React.ReactNode;
  className?: string;
  end?: React.ReactNode;
}) {
  return (
    <div
      className={cx(
        "af-panel-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line-subtle",
        "bg-bg-secondary px-3 py-2.5",
        className,
      )}
    >
      {children}
      {end ? <div className="ml-auto flex flex-wrap items-center gap-2">{end}</div> : null}
    </div>
  );
}

export function ToolbarDivider() {
  return <span aria-hidden className="mx-0.5 hidden h-5 w-px bg-line-subtle sm:block" />;
}

/**
 * Controle segmentado — troca de visão/período sem virar 3 botões soltos.
 *
 * Escala: o botão interno é um degrau abaixo do campo de formulário, e o
 * padding do trilho (2px) devolve a diferença — então o conjunto fecha na MESMA
 * altura dos campos ao lado (36px no `md`, 32px no `sm`). Antes o trilho tinha
 * 32px numa faixa de controles de 36px e ficava visivelmente subdimensionado,
 * com os ícones lendo como detalhe em vez de ação.
 *
 * Os ícones são maiores do que a proporção usual pede — 20px num botão de 32px,
 * contra os 16/32 do painel atual. Num seletor sem rótulo o glifo é a única
 * informação, então ele carrega o peso que o texto carregaria. E há um motivo
 * concreto: `LayoutGrid` desenha quatro quadrados com vão entre eles; a 16px
 * cada quadrado fica com ~5px e o ícone degrada para quatro pontinhos. A 20px
 * os quadrados voltam a ler como quadrados.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label?: string; icon?: React.ReactNode; title: string }>;
  label: string;
  size?: "sm" | "md";
}) {
  const sm = size === "sm";
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            aria-label={o.label ? undefined : o.title}
            onClick={() => onChange(o.value)}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-md font-medium",
              "transition-colors duration-[var(--af-dur-hover)]",
              // `shrink-0` no ícone não é enfeite: sem ele o SVG é um item
              // flexível e o navegador o ESPREME para caber na caixa de
              // conteúdo, sem erro nenhum no console. Era o que acontecia aqui
              // — o ícone chegava a 8px de largura por 20 de altura.
              "[&_svg]:shrink-0",
              sm ? "h-7 text-[12.5px] [&_svg]:size-4" : "h-8 text-[13px] [&_svg]:size-5",
              // O padding sai daqui e SÓ daqui. Antes o tamanho trazia um
              // `px-*` e este ramo trazia outro: duas utilidades da mesma
              // propriedade no mesmo elemento, onde quem vence é a ordem do CSS
              // gerado, não a ordem em que foram escritas. O `px-0` perdia.
              o.label ? (sm ? "px-2.5" : "px-3") : sm ? "w-7 justify-center" : "w-8 justify-center",
              active
                ? "bg-primary-soft text-primary-light shadow-sm"
                : "text-ink-2 hover:bg-surface-hover hover:text-ink",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Métrica compacta em faixa — usada nos resumos das telas. */
export function StatStrip({ children }: { children: React.ReactNode }) {
  return (
    <div className="af-panel flex flex-wrap items-stretch divide-x divide-[var(--af-border-subtle)] overflow-hidden rounded-xl border border-line-subtle bg-surface">
      {children}
    </div>
  );
}

export function StatCell({
  label,
  value,
  hint,
  icon,
  tone,
  viz,
  loading = false,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  /** cor semântica, para contadores de estado (online, em atendimento, offline) */
  tone?: "success" | "info" | "warning" | "neutral";
  /** cor categórica em caixinha, para métricas (créditos, sessões, grátis hoje) */
  viz?: VizTone;
  loading?: boolean;
}) {
  const fg = tone
    ? {
        success: "text-success",
        info: "text-info",
        warning: "text-warning",
        neutral: "text-muted",
      }[tone]
    : "text-muted";
  return (
    // A largura mínima é maior do que a caixa aparenta precisar (184px) por um
    // motivo medido: abaixo disso o rótulo em versalete quebra em duas linhas
    // ("SESSÕES ATIVAS"), e como a faixa é `items-stretch`, a quebra de UMA
    // célula estica TODAS as outras. A altura do bloco era ditada pela célula
    // mais apertada, não pelo conteúdo.
    <div className="flex min-w-[184px] flex-1 items-start gap-2.5 px-4 py-3">
      {icon && viz ? (
        <VizIcon tone={viz} size="sm" className="mt-[1px]">
          {icon}
        </VizIcon>
      ) : icon ? (
        <span className={cx("mt-[6px] inline-flex [&_svg]:size-4", fg)}>{icon}</span>
      ) : null}
      <div className="min-w-0">
        <p className="af-eyebrow">{label}</p>
        <p className="af-num mt-1 text-[20px] font-semibold leading-none text-ink">
          {loading ? <span className="af-skeleton inline-block h-5 w-12 rounded" /> : value}
        </p>
        {hint ? <p className="mt-1 text-[11.5px] text-muted">{hint}</p> : null}
      </div>
    </div>
  );
}

/** Seção com título dentro de uma página (sem virar painel). */
export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
          {description ? <p className="mt-0.5 text-[12.5px] text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
