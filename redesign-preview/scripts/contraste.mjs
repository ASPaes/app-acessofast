/**
 * Conferência de contraste dos tokens de cor.
 *
 * Lê os valores direto de src/styles/tokens.css — não há lista duplicada aqui,
 * então mexer numa cor e esquecer de rodar isto é o único jeito de passar
 * despercebido.
 *
 * Regra aplicada: WCAG 2.1 AA para texto normal = 4,5:1. Texto grande (≥18,66px
 * ou ≥14px em negrito) exigiria só 3:1, mas o painel praticamente não tem texto
 * grande em tom discreto — então usamos o critério mais rígido para tudo.
 *
 * Uso (a partir de redesign-preview/):  bun scripts/contraste.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.resolve(aqui, "../src/styles/tokens.css"), "utf8");

function token(nome) {
  const m = css.match(new RegExp(`--${nome}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token --${nome} não encontrado em tokens.css`);
  return m[1];
}

const canal = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

const luminancia = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
};

const razao = (a, b) => {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (escuro + 0.05);
};

const MINIMO = 4.5;

const superficies = [
  "bg",
  "bg-secondary",
  "sidebar",
  "surface",
  "surface-2",
  "surface-raised",
  "surface-hover",
  // Superfícies do acabamento vidro. Entram na conferência como qualquer outra
  // porque são opacas — antes eram translúcidas e o contraste dependia do ponto
  // da tela, o que nenhum guard automático conseguia cobrir.
  "glass",
  "glass-2",
  "glass-head",
];
const textos = ["text", "text-secondary", "text-muted"];

let falhas = 0;

console.log(`Contraste dos tokens · mínimo AA para texto normal: ${MINIMO}:1\n`);

for (const s of superficies) {
  const corS = token(`af-${s}`);
  const colunas = textos.map((t) => {
    const corT = token(`af-${t}`);
    const r = razao(corT, corS);
    if (r < MINIMO) falhas++;
    const rotulo = `${t} ${r.toFixed(2)}:1`;
    return r < MINIMO ? `${rotulo} ✗` : rotulo.padEnd(22);
  });
  console.log(`${(s + " " + corS).padEnd(26)} ${colunas.join(" ")}`);
}

console.log("");

// Botão primário: repouso E hover. O hover importa tanto quanto — é o estado
// em que a pessoa está prestes a clicar.
for (const alvo of ["af-primary", "af-primary-hover"]) {
  const cor = token(alvo);
  const r = razao(token("af-text-on-primary"), cor);
  if (r < MINIMO) falhas++;
  console.log(
    `${(alvo.replace("af-", "") + " " + cor).padEnd(26)} texto branco ${r.toFixed(2)}:1${
      r < MINIMO ? " ✗" : ""
    }`,
  );
}

// Azul claro usado como TEXTO (links, valores em destaque) sobre as superfícies.
for (const s of ["surface", "surface-raised"]) {
  const cor = token(`af-${s}`);
  const r = razao(token("af-primary-light"), cor);
  if (r < MINIMO) falhas++;
  console.log(`primary-light sobre ${s.padEnd(15)} ${r.toFixed(2)}:1${r < MINIMO ? " ✗" : ""}`);
}

/* ---------------------------------------------------------------------------
 * Paleta categórica das métricas: separação perceptual.
 *
 * Contraste não cobre isto. Dois tons podem ter contraste ótimo contra o fundo
 * e mesmo assim ser indistinguíveis ENTRE SI — foi o caso de amber x yellow,
 * que tinham 10:1 e 9:1 de contraste e ΔE00 4,4 um do outro.
 *
 * O que decide se a codificação por cor funciona é o par MAIS PRÓXIMO do
 * conjunto, porque é nele que a pessoa erra. Medido em CIEDE2000: ΔE76
 * superestima diferença na região azul e subestima na amarela, justo as duas
 * pontas deste caso.
 * ------------------------------------------------------------------------- */

const rgb = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function lab(h) {
  let [r, g, b] = rgb(h).map((v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  let y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  [x, y, z] = [f(x), f(y), f(z)];
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function de00(h1, h2) {
  const [L1, a1, b1] = lab(h1);
  const [L2, a2, b2] = lab(h2);
  const rad = Math.PI / 180;
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))));
  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  const ang = (b, ap) => {
    if (b === 0 && ap === 0) return 0;
    const h = Math.atan2(b, ap) / rad;
    return h < 0 ? h + 360 : h;
  };
  const hp1 = ang(b1, ap1);
  const hp2 = ang(b2, ap2);
  const dL = L2 - L1;
  const dC = Cp2 - Cp1;
  let dhp = 0;
  if (Cp1 * Cp2 !== 0) {
    dhp = hp2 - hp1;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dhp / 2) * rad);
  const Lb = (L1 + L2) / 2;
  const Cpb = (Cp1 + Cp2) / 2;
  let hpb;
  if (Cp1 * Cp2 === 0) hpb = hp1 + hp2;
  else if (Math.abs(hp1 - hp2) <= 180) hpb = (hp1 + hp2) / 2;
  else hpb = hp1 + hp2 < 360 ? (hp1 + hp2 + 360) / 2 : (hp1 + hp2 - 360) / 2;
  const T =
    1 -
    0.17 * Math.cos((hpb - 30) * rad) +
    0.24 * Math.cos(2 * hpb * rad) +
    0.32 * Math.cos((3 * hpb + 6) * rad) -
    0.2 * Math.cos((4 * hpb - 63) * rad);
  const dTh = 30 * Math.exp(-Math.pow((hpb - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cpb, 7) / (Math.pow(Cpb, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lb - 50, 2)) / Math.sqrt(20 + Math.pow(Lb - 50, 2));
  const Sc = 1 + 0.045 * Cpb;
  const Sh = 1 + 0.015 * Cpb * T;
  const Rt = -Math.sin(2 * dTh * rad) * Rc;
  return Math.sqrt(
    Math.pow(dL / Sl, 2) + Math.pow(dC / Sc, 2) + Math.pow(dH / Sh, 2) + Rt * (dC / Sc) * (dH / Sh),
  );
}

/** Abaixo disto, num ícone de 16 px, as pessoas confundem os dois tons. */
const MIN_SEPARACAO = 15;

const VIZ = ["blue", "emerald", "amber", "violet", "cyan", "lime"];

console.log(`\nPaleta categórica · separação mínima entre tons: ΔE00 ${MIN_SEPARACAO}\n`);

const pares = [];
for (let i = 0; i < VIZ.length; i++) {
  for (let j = i + 1; j < VIZ.length; j++) {
    pares.push({
      a: VIZ[i],
      b: VIZ[j],
      d: de00(token(`af-viz-${VIZ[i]}`), token(`af-viz-${VIZ[j]}`)),
    });
  }
}
pares.sort((x, y) => x.d - y.d);

for (const p of pares.slice(0, 4)) {
  const ruim = p.d < MIN_SEPARACAO;
  if (ruim) falhas++;
  console.log(
    `  ${(p.a + " × " + p.b).padEnd(22)} ΔE00 ${p.d.toFixed(1).padStart(5)}${ruim ? " ✗" : ""}`,
  );
}
console.log(`  (${pares.length - 4} pares restantes, todos acima de ${pares[4].d.toFixed(1)})`);

// Os tons também aparecem como TEXTO pequeno no rodapé do cartão de métrica.
for (const v of VIZ) {
  const r = razao(token(`af-viz-${v}`), token("af-glass"));
  if (r < MINIMO) {
    falhas++;
    console.log(`  viz-${v} sobre vidro ${r.toFixed(2)}:1 ✗`);
  }
}

console.log(
  falhas === 0 ? "\nTodas as combinações passam." : `\n${falhas} combinação(ões) reprovada(s)`,
);

if (falhas > 0) process.exit(1);
