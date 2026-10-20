import { memo, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// O Otto em tamanho de ícone (16 a 24 px), para os selos de status da lista de
// Dispositivos. A lista tem centenas de linhas, e o Otto inteiro (otto.tsx) traz
// desfoques, máscaras e camadas que nesse tamanho nem aparecem e, multiplicados
// por 500, pesariam na página. Este é um desenho só, sem filtro nenhum: o mesmo
// monitor, com o rosto ampliado para ler pequeno e o corpo tingido na cor do selo.
//
// Quando o status muda (a lista se atualiza sozinha), ele dá um pulinho para
// chamar o olho — só na mudança, nunca ao abrir a página.

export type OttoMiniEstado = "online" | "atendimento" | "sem_status" | "offline";

type Olhos = "feliz" | "pontos" | "olhando" | "dormindo";

const ESTADOS: Record<OttoMiniEstado, { cor: string; olhos: Olhos }> = {
  online: { cor: "#31c48d", olhos: "feliz" },
  atendimento: { cor: "#f5b942", olhos: "olhando" },
  sem_status: { cor: "#d6a443", olhos: "pontos" },
  offline: { cor: "#7c8aa5", olhos: "dormindo" },
};

// ---- geometria (a mesma superelipse do otto.tsx, com menos pontos) ----

const r1 = (n: number) => Math.round(n * 10) / 10;

function contorno(cx: number, cy: number, rx: number, ry: number, n: number) {
  const N = 32;
  const e = 2 / n;
  const pts: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const t = ((i + 0.5) / N) * 2 * Math.PI;
    const c = Math.cos(t);
    const s = Math.sin(t);
    pts.push([
      cx + rx * Math.sign(c) * Math.abs(c) ** e,
      cy + ry * Math.sign(s) * Math.abs(s) ** e,
    ]);
  }
  const meio = (a: [number, number], b: [number, number]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m = meio(pts[N - 1], pts[0]);
  let d = `M${r1(m[0])} ${r1(m[1])}`;
  for (let i = 0; i < N; i++) {
    const q = meio(pts[i], pts[(i + 1) % N]);
    d += `Q${r1(pts[i][0])} ${r1(pts[i][1])} ${r1(q[0])} ${r1(q[1])}`;
  }
  return d + "Z";
}

const CORPO = contorno(120, 112, 78, 60, 4);
const TELA = contorno(120, 109, 66, 45, 4.4);
const OLHO_Y = 108;
const OLHOS_X = [95, 145];

function misturar(a: string, b: string, t: number) {
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const A = hex(a);
  const B = hex(b);
  return (
    "#" +
    A.map((v, i) =>
      Math.round(v + (B[i] - v) * t)
        .toString(16)
        .padStart(2, "0"),
    ).join("")
  );
}

function Olhos({ tipo }: { tipo: Olhos }) {
  const linha = {
    fill: "none",
    stroke: "#eef4ff",
    strokeWidth: 9,
    strokeLinecap: "round" as const,
  };
  return (
    <>
      {OLHOS_X.map((x) => {
        if (tipo === "feliz")
          return (
            <path
              key={x}
              d={`M${x - 12} ${OLHO_Y + 6}Q${x} ${OLHO_Y - 12} ${x + 12} ${OLHO_Y + 6}`}
              {...linha}
            />
          );
        if (tipo === "dormindo")
          return (
            <path
              key={x}
              d={`M${x - 12} ${OLHO_Y - 2}Q${x} ${OLHO_Y + 11} ${x + 12} ${OLHO_Y - 2}`}
              {...linha}
            />
          );
        const dx = tipo === "olhando" ? 7 : 0;
        return <ellipse key={x} cx={x + dx} cy={OLHO_Y} rx={9.5} ry={12.5} fill="#eef4ff" />;
      })}
    </>
  );
}

function Desenho({ estado }: { estado: OttoMiniEstado }) {
  const { cor, olhos } = ESTADOS[estado];
  const corpo = misturar("#eef1f6", cor, 0.32);
  const pe = misturar("#c9d1df", cor, 0.4);
  const tela = estado === "offline" ? "#141b2b" : misturar("#0b1838", cor, 0.12);
  return (
    <svg viewBox="38 46 164 158" className="block h-full w-full" aria-hidden>
      <rect x={110} y={164} width={20} height={26} rx={4} fill={pe} />
      <rect x={84} y={184} width={72} height={14} rx={7} fill={pe} />
      <path d={CORPO} fill={corpo} />
      <path d={TELA} fill={tela} />
      <Olhos tipo={olhos} />
    </svg>
  );
}

/** Otto do selo de status. Memo: a lista re-renderiza a cada segundo quando há atendimento. */
export const OttoMini = memo(function OttoMini({
  estado,
  className,
}: {
  estado: OttoMiniEstado;
  className?: string;
}) {
  const anterior = useRef(estado);
  const [pulo, setPulo] = useState(false);
  useEffect(() => {
    if (anterior.current === estado) return;
    anterior.current = estado;
    setPulo(true);
    const t = window.setTimeout(() => setPulo(false), 700);
    return () => window.clearTimeout(t);
  }, [estado]);

  return (
    <span className={cn("otto-mini inline-block shrink-0", pulo && "otto-mini-pulo", className)}>
      <Desenho estado={estado} />
    </span>
  );
});
