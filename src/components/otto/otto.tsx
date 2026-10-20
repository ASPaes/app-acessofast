import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";

import { cn } from "@/lib/utils";

// Otto, o mascote do AcessoFast: um monitor de massinha branco com o rosto na
// tela e uma luzinha embaixo que acende na cor do estado. O desenho é o mesmo
// do estudo do mascote (mascote-acessofast/candidatos.html, candidato B com corpo
// branco, olhos ovais, bochecha e formato padrão), passado para JSX. Mudança no
// desenho se faz lá e se traz para cá; este arquivo é igual no painel e no site.
//
// As animações (flutuar, piscar, acenar…) ficam em styles.css, nas classes
// `otto*`, e só rodam para quem não pediu movimento reduzido.

export type OttoEstado =
  | "parado"
  | "ola"
  | "conectando"
  | "atendendo"
  | "aguardando"
  | "erro"
  | "concluido"
  | "offline";

type Balao = "pontos" | "cursor" | "pergunta" | "alerta" | "check";
type Olhos = "pontos" | "feliz" | "traco" | "dormindo" | "olhando";

const ESTADOS: Record<
  OttoEstado,
  { rotulo: string; cor?: string; tinta?: string; olhos: Olhos; balao?: Balao }
> = {
  parado: { rotulo: "parado", olhos: "pontos" },
  ola: { rotulo: "acenando", olhos: "feliz" },
  conectando: {
    rotulo: "conectando",
    cor: "#64a4ff",
    tinta: "#082457",
    olhos: "olhando",
    balao: "pontos",
  },
  atendendo: {
    rotulo: "em atendimento",
    cor: "#2c67fa",
    tinta: "#ffffff",
    olhos: "pontos",
    balao: "cursor",
  },
  aguardando: {
    rotulo: "aguardando",
    cor: "#f5b942",
    tinta: "#3a2500",
    olhos: "pontos",
    balao: "pergunta",
  },
  erro: { rotulo: "com erro", cor: "#f05252", tinta: "#ffffff", olhos: "traco", balao: "alerta" },
  concluido: {
    rotulo: "concluído",
    cor: "#31c48d",
    tinta: "#04291c",
    olhos: "feliz",
    balao: "check",
  },
  offline: { rotulo: "dormindo", cor: "#7c8aa5", olhos: "dormindo" },
};

// ---- geometria (calculada uma vez, ao carregar o módulo) ----

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Contorno suave por pontos médios: cada ponto vira o controle de uma quadrática. */
function suave(pts: [number, number][]) {
  const meio = (a: [number, number], b: [number, number]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const n = pts.length;
  const m = meio(pts[n - 1], pts[0]);
  let d = `M${r1(m[0])} ${r1(m[1])}`;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = meio(p, pts[(i + 1) % n]);
    d += `Q${r1(p[0])} ${r1(p[1])} ${r1(q[0])} ${r1(q[1])}`;
  }
  return d + "Z";
}

/** Superelipse: n = 2 é elipse; quanto maior, mais quadrada. */
function superelipse(cx: number, cy: number, rx: number, ry: number, n: number) {
  const pts: [number, number][] = [];
  const N = 80;
  const e = 2 / n;
  for (let i = 0; i < N; i++) {
    const t = ((i + 0.5) / N) * 2 * Math.PI;
    const c = Math.cos(t);
    const s = Math.sin(t);
    pts.push([
      cx + rx * Math.sign(c) * Math.abs(c) ** e,
      cy + ry * Math.sign(s) * Math.abs(s) ** e,
    ]);
  }
  return pts;
}

const CORPO = suave(superelipse(120, 112, 78, 60, 4));
const TELA = suave(superelipse(120, 109, 66, 45, 4.4));

const BRANCO = ["#ffffff", "#eef1f6", "#b4bfd2"];
const AROS = "#42537d";
const COR_OLHO = "#eef4ff";
const ROSTO = { x: 120, y: 111, g: 25 };
/** Cada camada do desenho ocupa o Otto inteiro, no mesmo enquadramento. */
const CAMADA = "absolute inset-0 block h-full w-full overflow-visible";

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

// ---- peças ----

function OlhosDoOtto({ tipo }: { tipo: Olhos }) {
  const { x, y, g } = ROSTO;
  const linha = {
    fill: "none",
    stroke: COR_OLHO,
    strokeWidth: 4.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <>
      {[x - g, x + g].map((ex) => {
        if (tipo === "feliz")
          return (
            <path
              key={ex}
              d={`M${ex - 8} ${y + 3}Q${ex} ${y - 10} ${ex + 8} ${y + 3}`}
              {...linha}
            />
          );
        if (tipo === "traco") return <path key={ex} d={`M${ex - 7} ${y}H${ex + 7}`} {...linha} />;
        if (tipo === "dormindo")
          return (
            <path key={ex} d={`M${ex - 8} ${y - 1}Q${ex} ${y + 8} ${ex + 8} ${y - 1}`} {...linha} />
          );
        const dx = tipo === "olhando" ? 4 : 0;
        const dy = tipo === "olhando" ? -1 : 0;
        return <ellipse key={ex} cx={ex + dx} cy={y + dy} rx={6.6} ry={8.8} fill={COR_OLHO} />;
      })}
    </>
  );
}

function IconeDoBalao({ tipo, cor }: { tipo: Balao; cor: string }) {
  // os pontinhos são camadas à parte (animam sozinhos), desenhados no Otto
  if (tipo === "pontos") return null;
  if (tipo === "cursor")
    return <path d="M-4.6-7.6V6.2L-1.2 3 1.2 8.2 3.9 7 1.6 1.9H6.4Z" fill={cor} />;
  if (tipo === "pergunta")
    return (
      <text
        y={6}
        textAnchor="middle"
        fontFamily="system-ui,sans-serif"
        fontWeight={700}
        fontSize={17}
        fill={cor}
      >
        ?
      </text>
    );
  if (tipo === "alerta")
    return (
      <>
        <path d="M0-7.5V1.5" stroke={cor} strokeWidth={3.4} strokeLinecap="round" />
        <circle cy={7} r={2} fill={cor} />
      </>
    );
  return (
    <path
      d="M-6.5 .5-2 5 6.5-4.5"
      fill="none"
      stroke={cor}
      strokeWidth={3.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

/** Os três brilhos do "concluído": posição, tamanho e o atraso de cada um (styles.css). */
const ESTRELAS = [
  { x: 38, y: 44, k: 9, classe: "otto-b1" },
  { x: 58, y: 27, k: 6, classe: "otto-b2" },
  { x: 33, y: 19, k: 4.5, classe: "otto-b3" },
];

function Estrela({ x, y, k, cor }: { x: number; y: number; k: number; cor: string }) {
  return (
    <path
      d={`M${x} ${y - k}Q${x} ${y} ${x + k} ${y}Q${x} ${y} ${x} ${y + k}Q${x} ${y} ${x - k} ${y}Q${x} ${y} ${x} ${y - k}Z`}
      fill={cor}
    />
  );
}

// ---- fora da tela ----
// Um observador só para todos os Ottos: o que sai da tela ganha `data-otto-fora`,
// que pausa as animações dele (styles.css) e o tira do olhar que segue o mouse.

let observadorDaTela: IntersectionObserver | null = null;

function observarTela(el: HTMLElement) {
  if (typeof IntersectionObserver === "undefined") return () => {};
  observadorDaTela ??= new IntersectionObserver(
    (entradas) => {
      for (const e of entradas) e.target.toggleAttribute("data-otto-fora", !e.isIntersecting);
    },
    { rootMargin: "100px" },
  );
  observadorDaTela.observe(el);
  return () => observadorDaTela?.unobserve(el);
}

// ---- o olhar ----
// O rosto (olhos e bochechas) é uma camada própria que se desloca dentro da
// tela. Fixo, pelas variáveis --otto-ox/--otto-oy (em unidades do desenho) que a
// classe `otto-olhar` lê em styles.css. Seguindo o
// mouse, por um ouvinte único da página: a cada quadro, cada Otto na tela olha
// para o campo de formulário em foco, se houver, ou para o ponteiro.
//
// Desempenho (o site chegou a travar com a primeira versão, 19/10/2026):
// - move a camada do rosto inteira (um `transform` direto nela, que a placa de
//   vídeo faz sem redesenhar), e não uma variável na raiz do Otto, que obrigava
//   o navegador a recalcular e repintar o desenho inteiro;
// - lê a posição de todos primeiro e só depois escreve, para não forçar um
//   layout novo a cada Otto;
// - só escreve quando o rosto anda o bastante para se ver, no máximo 20 vezes
//   por segundo, e ignora quem está fora da tela.

const OLHAR_X = 9; // deslocamento máximo do rosto, em unidades do desenho
const OLHAR_Y = 6;
const PASSO_MINIMO = 0.3; // abaixo disso, em unidades do desenho, não vale escrever
const INTERVALO_DO_OLHAR = 50; // ms
type Seguidor = { rosto: HTMLElement | null; x: number; y: number };
const seguidores = new Map<HTMLElement, Seguidor>();
let ponteiro: { x: number; y: number } | null = null;
let quadroPendente = false;
let ultimaMirada = 0;

function alvoDoOlhar() {
  const foco = document.activeElement;
  if (foco instanceof HTMLElement && foco.matches("input, textarea, select")) {
    const r = foco.getBoundingClientRect();
    return { x: r.left + Math.min(r.width / 2, 120), y: r.top + r.height / 2 };
  }
  return ponteiro;
}

function mirarTodos(agora: number) {
  quadroPendente = false;
  // No máximo 20 vezes por segundo: a transição do rosto (styles.css) preenche
  // o caminho entre um passo e outro, então o olho continua andando liso.
  if (agora - ultimaMirada < INTERVALO_DO_OLHAR) {
    pedirQuadro();
    return;
  }
  ultimaMirada = agora;
  const alvo = alvoDoOlhar();
  if (!alvo) return;
  // 1) só leitura
  const medidas: [Seguidor, DOMRect][] = [];
  for (const [el, s] of seguidores) {
    if (el.hasAttribute("data-otto-fora")) continue;
    if (!s.rosto?.isConnected) s.rosto = el.querySelector<HTMLElement>(".otto-olhar");
    if (s.rosto) medidas.push([s, el.getBoundingClientRect()]);
  }
  // 2) só escrita
  for (const [s, r] of medidas) {
    const alcance = Math.max(r.width * 2.5, 200);
    const x = Math.max(-1, Math.min(1, (alvo.x - (r.left + r.width / 2)) / alcance)) * OLHAR_X;
    const y = Math.max(-1, Math.min(1, (alvo.y - (r.top + r.height * 0.45)) / alcance)) * OLHAR_Y;
    if (Math.abs(x - s.x) < PASSO_MINIMO && Math.abs(y - s.y) < PASSO_MINIMO) continue;
    s.x = x;
    s.y = y;
    // a camada do rosto tem a largura do desenho (224 unidades): 1 unidade = 1/2,24 %
    s.rosto!.style.transform = `translate(${(x / 2.24).toFixed(2)}%, ${(y / 2.24).toFixed(2)}%)`;
  }
}

function pedirQuadro() {
  if (quadroPendente) return;
  quadroPendente = true;
  requestAnimationFrame(mirarTodos);
}

function aoMoverPonteiro(e: PointerEvent) {
  ponteiro = { x: e.clientX, y: e.clientY };
  pedirQuadro();
}

function seguirOlhar(el: HTMLElement) {
  if (seguidores.size === 0) {
    window.addEventListener("pointermove", aoMoverPonteiro, { passive: true });
    window.addEventListener("pointerdown", aoMoverPonteiro, { passive: true });
    window.addEventListener("scroll", pedirQuadro, { passive: true });
    document.addEventListener("focusin", pedirQuadro);
    document.addEventListener("focusout", pedirQuadro);
  }
  seguidores.set(el, { rosto: null, x: 0, y: 0 });
  pedirQuadro();
  return () => {
    seguidores.delete(el);
    if (seguidores.size > 0) return;
    window.removeEventListener("pointermove", aoMoverPonteiro);
    window.removeEventListener("pointerdown", aoMoverPonteiro);
    window.removeEventListener("scroll", pedirQuadro);
    document.removeEventListener("focusin", pedirQuadro);
    document.removeEventListener("focusout", pedirQuadro);
  };
}

// ---- o Otto ----

export type OttoProps = {
  estado?: OttoEstado;
  /** Largura vem daqui (ex.: "w-24"); a altura acompanha. */
  className?: string;
  /** Flutuar, piscar e o resto. Desligue onde muitos Ottos aparecem juntos. */
  animado?: boolean;
  /**
   * Texto para leitor de tela. Sem ele o Otto é decoração (aria-hidden), que é o
   * caso comum: o texto ao lado já diz o que ele está "dizendo".
   */
  rotulo?: string;
  /** Olha para o mouse (ou para o campo de formulário em foco) enquanto estiver na tela. */
  seguirMouse?: boolean;
  /** Olhar fixo, de -1 a 1 em cada eixo: [1, 0] é para a direita. Não combine com seguirMouse. */
  olhar?: [number, number];
};

export function Otto({
  estado = "parado",
  className,
  animado = true,
  rotulo,
  seguirMouse = false,
  olhar,
}: OttoProps) {
  const raiz = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = raiz.current;
    if (!el) return;
    return observarTela(el);
  }, []);
  useEffect(() => {
    const el = raiz.current;
    if (!seguirMouse || !el) return;
    return seguirOlhar(el);
  }, [seguirMouse]);
  const estiloOlhar = olhar
    ? ({
        "--otto-ox": olhar[0] * OLHAR_X,
        "--otto-oy": olhar[1] * OLHAR_Y,
      } as CSSProperties)
    : undefined;
  const id = "otto" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const st = ESTADOS[estado];
  const luz = st.cor ?? "#2c67fa";
  const brilhoCor = st.cor ?? "#5f8cff";
  const brilhoForca = estado === "offline" ? 0.08 : st.cor ? 0.3 : 0.16;
  const pisca = st.olhos === "pontos" || st.olhos === "olhando";
  const corDoBrilho = estado === "concluido" && st.cor ? misturar(st.cor, "#ffffff", 0.3) : null;
  const tudo = { x: 0, y: 0, width: 240, height: 240 };
  const u = (s: string) => `url(#${id}${s})`;

  return (
    <span
      className={cn(
        "otto relative inline-block aspect-square shrink-0",
        animado && "otto-vivo",
        className,
      )}
      ref={raiz}
      style={estiloOlhar}
      role={rotulo ? "img" : undefined}
      aria-label={rotulo}
      aria-hidden={rotulo ? undefined : true}
    >
      {/* Três camadas sobrepostas, no mesmo enquadramento. O corpo, com os filtros
          caros, só se desenha quando o estado muda. O rosto anda inteiro (o olhar
          move a camada, sem redesenhar nada) e os enfeites animam por cima sem
          repintar o corpo. Num desenho só, cada piscada ou passo do olhar refazia
          todos os desfoques, e o site travava. */}
      <span className="otto-corpo absolute inset-0 block">
        <svg viewBox="8 16 224 224" className={CAMADA} aria-hidden>
          <defs>
            <radialGradient
              id={`${id}g`}
              gradientUnits="userSpaceOnUse"
              cx={98.2}
              cy={81.2}
              r={148.2}
            >
              <stop offset="0" stopColor={BRANCO[0]} />
              <stop offset=".5" stopColor={BRANCO[1]} />
              <stop offset="1" stopColor={BRANCO[2]} />
            </radialGradient>
            {st.cor && (
              <linearGradient
                id={`${id}t`}
                gradientUnits="userSpaceOnUse"
                x1={0}
                y1={69.5}
                x2={0}
                y2={198}
              >
                <stop offset="0" stopColor={st.cor} stopOpacity={0} />
                <stop offset="1" stopColor={st.cor} stopOpacity={0.8} />
              </linearGradient>
            )}
            <linearGradient
              id={`${id}a`}
              gradientUnits="userSpaceOnUse"
              x1={0}
              y1={125}
              x2={0}
              y2={198}
            >
              <stop offset="0" stopColor="#060e22" stopOpacity={0} />
              <stop offset="1" stopColor="#060e22" stopOpacity={0.28} />
            </linearGradient>
            <radialGradient id={`${id}gl`} gradientUnits="userSpaceOnUse" cx={120} cy={128} r={118}>
              <stop offset="0" stopColor={brilhoCor} stopOpacity={brilhoForca} />
              <stop offset=".55" stopColor={brilhoCor} stopOpacity={r1(brilhoForca * 3.8) / 10} />
              <stop offset="1" stopColor={brilhoCor} stopOpacity={0} />
            </radialGradient>
            <linearGradient id={`${id}scr`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#12254f" />
              <stop offset="1" stopColor="#060d1c" />
            </linearGradient>
            <radialGradient id={`${id}sg`} cx=".5" cy="1.05" r=".9">
              <stop offset="0" stopColor={luz} stopOpacity={0.5} />
              <stop offset="1" stopColor={luz} stopOpacity={0} />
            </radialGradient>
            <filter id={`${id}b8`} x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="8" />
            </filter>
            <filter id={`${id}b3`} x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="3" />
            </filter>
            <filter id={`${id}eb`} filterUnits="userSpaceOnUse" {...tudo}>
              <feGaussianBlur stdDeviation="7" />
            </filter>
            <g id={`${id}S`}>
              <path d={CORPO} />
              <rect x={110} y={164} width={20} height={26} rx={4} />
              <rect x={84} y={184} width={72} height={14} rx={7} />
            </g>
            <mask id={`${id}m`} maskUnits="userSpaceOnUse" {...tudo}>
              <use href={`#${id}S`} fill="#fff" />
            </mask>
            <mask id={`${id}e`} maskUnits="userSpaceOnUse" {...tudo}>
              <rect {...tudo} fill="#fff" />
              <g filter={u("eb")}>
                <use href={`#${id}S`} fill="#000" />
              </g>
            </mask>
            <clipPath id={`${id}sc`}>
              <path d={TELA} />
            </clipPath>
          </defs>

          <circle cx={120} cy={128} r={118} fill={u("gl")} />

          {/* corpo de massinha: gradiente, tinta do estado, sombra de baixo e aro nas bordas */}
          <g mask={u("m")}>
            <rect {...tudo} fill={u("g")} />
            {st.cor && <rect {...tudo} fill={u("t")} />}
            <rect {...tudo} fill={u("a")} />
            <rect {...tudo} fill={AROS} opacity={0.45} mask={u("e")} />
            <ellipse cx={92} cy={59} rx={36} ry={7} fill="#fff" opacity={0.78} filter={u("b8")} />
            <ellipse
              cx={166}
              cy={59}
              rx={12}
              ry={3.5}
              transform="rotate(6 166 59)"
              fill="#fff"
              opacity={0.9}
              filter={u("b3")}
            />
          </g>

          {/* tela, reflexo e a luzinha de estado no pé */}
          <path d={TELA} fill={u("scr")} />
          <path d={TELA} fill={u("sg")} />
          <g clipPath={u("sc")}>
            <ellipse
              cx={86}
              cy={70}
              rx={52}
              ry={13}
              transform="rotate(-24 86 70)"
              fill="#fff"
              opacity={0.07}
            />
          </g>
          <path d={TELA} fill="none" stroke="#040914" strokeOpacity={0.55} strokeWidth={1.5} />
          <circle cx={120} cy={163} r={6} fill={luz} opacity={0.4} filter={u("b3")} />
          <circle cx={120} cy={163} r={2.7} fill={luz} />
        </svg>

        {/* rosto: bochechas e olhos andam juntos quando ele olha para os lados. Os
            olhos são uma camada à parte para a piscada ser só da placa de vídeo. */}
        <span className="otto-olhar absolute inset-0 block">
          <svg viewBox="8 16 224 224" className={CAMADA} aria-hidden>
            <defs>
              <filter id={`${id}rb`} x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation="3" />
              </filter>
            </defs>
            <ellipse
              cx={80}
              cy={122}
              rx={10}
              ry={6}
              fill="#ff6f91"
              opacity={0.5}
              filter={u("rb")}
            />
            <ellipse
              cx={160}
              cy={122}
              rx={10}
              ry={6}
              fill="#ff6f91"
              opacity={0.5}
              filter={u("rb")}
            />
          </svg>
          <svg viewBox="8 16 224 224" className={cn(CAMADA, pisca && "otto-pisca")} aria-hidden>
            <defs>
              <filter id={`${id}eg`} filterUnits="userSpaceOnUse" {...tudo}>
                <feDropShadow
                  dx="0"
                  dy="0"
                  stdDeviation="3.2"
                  floodColor={luz}
                  floodOpacity=".95"
                />
              </filter>
            </defs>
            <g filter={u("eg")}>
              <OlhosDoOtto tipo={st.olhos} />
            </g>
          </svg>
        </span>

        {/* enfeites: cada pedaço que anima é uma camada à parte, e a animação move a
            camada inteira — isso a placa de vídeo faz sem ocupar o processador. */}
        {st.balao && st.cor && (
          <svg viewBox="8 16 224 224" className={CAMADA} aria-hidden>
            <g transform="translate(200 50)">
              <circle r={15} fill={st.cor} stroke="#060d18" strokeWidth={3.5} />
              <IconeDoBalao tipo={st.balao} cor={st.tinta ?? "#ffffff"} />
            </g>
          </svg>
        )}
        {st.balao === "pontos" &&
          [-6.5, 0, 6.5].map((dx, i) => (
            <svg
              key={dx}
              viewBox="8 16 224 224"
              className={cn(CAMADA, `otto-d${i + 1}`)}
              aria-hidden
            >
              <circle cx={200 + dx} cy={50} r={2.5} fill={st.tinta ?? "#ffffff"} />
            </svg>
          ))}
        {estado === "ola" && (
          <svg viewBox="8 16 224 224" className={cn(CAMADA, "otto-aceno")} aria-hidden>
            <defs>
              <radialGradient id={`${id}hg`} cx=".36" cy=".28" r=".85">
                <stop offset="0" stopColor={BRANCO[0]} />
                <stop offset=".55" stopColor={BRANCO[1]} />
                <stop offset="1" stopColor={BRANCO[2]} />
              </radialGradient>
            </defs>
            <circle
              cx={214}
              cy={118}
              r={11.5}
              fill={u("hg")}
              stroke={AROS}
              strokeOpacity={0.3}
              strokeWidth={1.2}
            />
          </svg>
        )}
        {corDoBrilho &&
          ESTRELAS.map((e) => (
            <svg
              key={e.classe}
              viewBox="8 16 224 224"
              className={cn(CAMADA, "otto-brilho", e.classe)}
              // cada estrela pulsa em volta do próprio centro
              style={{
                transformOrigin: `${((e.x - 8) / 2.24).toFixed(1)}% ${((e.y - 16) / 2.24).toFixed(1)}%`,
              }}
              aria-hidden
            >
              <Estrela x={e.x} y={e.y} k={e.k} cor={corDoBrilho} />
            </svg>
          ))}
        {estado === "offline" && (
          <svg viewBox="8 16 224 224" className={cn(CAMADA, "otto-zz")} aria-hidden>
            <g fontFamily="ui-monospace,monospace" fontWeight={500} fill="#a9b8d4">
              <text x={191} y={59} fontSize={18}>
                z
              </text>
              <text x={206} y={42} fontSize={13}>
                z
              </text>
            </g>
          </svg>
        )}
      </span>
    </span>
  );
}

// ---- tela vazia com o Otto ----

/**
 * Lugar onde não há nada para mostrar (lista vazia, busca sem resultado). O
 * Otto acima, o título curto e, se precisar, uma frase e uma ação embaixo.
 */
export function OttoVazio({
  estado = "parado",
  titulo,
  children,
  acao,
  pequeno = false,
  className,
}: {
  estado?: OttoEstado;
  titulo: ReactNode;
  children?: ReactNode;
  acao?: ReactNode;
  /** Para cartões pequenos, onde o Otto de 96 px empurraria demais. */
  pequeno?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center",
        pequeno ? "gap-2 py-4" : "gap-3 py-8",
        className,
      )}
    >
      <Otto estado={estado} className={pequeno ? "w-14" : "w-24"} />
      <div className="space-y-1">
        <p className={cn("font-medium text-foreground", pequeno ? "text-[13px]" : "text-sm")}>
          {titulo}
        </p>
        {children && (
          <p className="mx-auto max-w-sm text-sm font-normal text-muted-foreground">{children}</p>
        )}
      </div>
      {acao}
    </div>
  );
}
