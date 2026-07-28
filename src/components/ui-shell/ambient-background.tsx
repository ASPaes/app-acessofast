import * as React from "react";

/**
 * Ambiente do painel — camada de fundo do shell autenticado.
 * ---------------------------------------------------------------------------
 * Três camadas fixas atrás do conteúdo:
 *
 *   1. manchas azuis grandes e muito diluídas — dão profundidade e fazem os
 *      painéis flutuarem em vez de parecerem recortes colados numa chapa preta;
 *   2. a constelação do login, desfocada e SEM a interação de mouse;
 *   3. granulado fino — degradês escuros de baixo contraste produzem banding
 *      (faixas visíveis) em telas de 8 bits; ~3,5% de ruído quebra as faixas.
 *
 * IMPORTANTE: este componente é usado só pelo `AppShell`, que por sua vez só
 * existe dentro de `/_authenticated`. A tela de login (`routes/auth.tsx` e o
 * `components/ParticleBackground.tsx` que ela usa) fica exatamente como está —
 * inclusive com a interação de ponteiro, que aqui foi deliberadamente removida.
 *
 * A camada é `fixed` e `pointer-events-none`: não entra no fluxo, não captura
 * clique e não rola com o conteúdo.
 */

const MANCHAS = [
  // canto superior esquerdo, logo depois da sidebar — puxa o olhar pro conteúdo
  "radial-gradient(1250px 700px at 4% -12%, rgba(47, 107, 255, 0.30), transparent 64%)",
  // topo direito, mais frio: dá variação de temperatura em vez de um azul só
  "radial-gradient(1000px 580px at 100% -8%, rgba(100, 164, 255, 0.17), transparent 60%)",
  // base direita — fecha a composição e sustenta o rodapé das tabelas longas
  "radial-gradient(1150px 800px at 86% 114%, rgba(47, 107, 255, 0.17), transparent 62%)",
  // base esquerda, discreta: tira o "vazio" do canto inferior
  "radial-gradient(860px 600px at 14% 104%, rgba(78, 161, 255, 0.10), transparent 64%)",
  // brilho horizontal amplo logo abaixo da barra superior
  "radial-gradient(1800px 320px at 46% 0%, rgba(47, 107, 255, 0.10), transparent 70%)",
  // véu no topo: separa a barra superior do corpo sem precisar de sombra
  "linear-gradient(180deg, rgba(23, 34, 56, 0.75) 0%, rgba(23, 34, 56, 0) 30%)",
  // vinheta suave: escurece as bordas e faz o centro respirar
  "radial-gradient(150% 120% at 50% 40%, transparent 52%, rgba(3, 6, 13, 0.55) 100%)",
].join(",");

const GRAO =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")";

export function AmbientBackground() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{ backgroundImage: MANCHAS }}
      />
      <Constelacao className="pointer-events-none fixed inset-0 z-0 h-full w-full" />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.035]"
        style={{ backgroundImage: GRAO, backgroundSize: "160px 160px" }}
      />
    </>
  );
}

/* ===========================================================================
 * CUSTO — leia antes de mexer em qualquer coisa aqui.
 *
 * A primeira versão travava a interface. O culpado não era a quantidade de
 * partículas nem a matemática: era `ctx.filter`, que o canvas 2D aplica **a cada
 * operação de desenho**. Com ~80 pontos, o laço de ligações emitia mais de mil
 * `stroke()` por quadro, e cada um passava por um blur próprio.
 *
 * Esta versão desenha nítido num canvas fora de tela e faz **uma única**
 * composição desfocada por quadro:
 *
 *     antes:  ~1.500 stroke() filtrados + 80 fill() filtrados  = ~1.580 ops
 *     agora:  5 stroke() + 1 fill() (nítidos) + 1 drawImage()  = 7 ops
 *
 * As 5 linhas vêm de agrupar as ligações em 5 faixas de opacidade: em vez de um
 * `stroke()` por segmento, monta-se um caminho por faixa e traça-se uma vez. A
 * perda de precisão no degradê é invisível depois do blur.
 *
 * Somam-se: canvas a 50% da resolução (4× menos pixels), 15 fps (é fundo), pausa
 * quando a aba perde foco e quadro estático sob `prefers-reduced-motion`.
 *
 * Para medir na sua máquina, acrescente `?perf=1` na URL.
 * =========================================================================== */

const ESCALA = 0.5; // resolução do canvas em relação à tela
/* 15 fps. Num fundo desfocado com deriva lentíssima a diferença para 30 fps é
   imperceptível — e corta pela metade tanto o loop quanto o recálculo do
   `backdrop-blur` da barra superior, que refaz o borrão sempre que a camada
   atrás dela repinta. */
const FPS = 15;
const DIST_LIGACAO = 140; // px, igual ao login
const MAX_PARTICULAS = 80;
const FAIXAS = 5; // faixas de opacidade das ligações

/* Ponto e linha são maiores e mais opacos que no login de propósito: depois de
   reduzir a resolução e passar o blur, um ponto de 1,6 px simplesmente some. O
   que se vê no fim tem a mesma presença do original — só que fora de foco. */
const RAIO_PONTO = 2.6;
const COR_PONTO = "rgba(147, 197, 253, 0.95)";
const OPACIDADE_LIGACAO = 0.34;
const ESPESSURA_LIGACAO = 1.4;

type Particula = { x: number; y: number; vx: number; vy: number };

function Constelacao({ className }: { className?: string }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const [ms, setMs] = React.useState<number | null>(null);

  const medir =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).has("perf");

  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    // Canvas fora de tela: recebe o desenho nítido. O blur acontece uma única
    // vez, na hora de compor este buffer no canvas visível.
    const buffer = document.createElement("canvas");
    const bctx = buffer.getContext("2d", { alpha: true });
    if (!bctx) return;

    const reduzirMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let largura = 0;
    let altura = 0;
    let raf = 0;
    let ultimo = 0;
    let particulas: Particula[] = [];

    // Coordenadas das ligações por faixa. Reaproveitadas entre quadros (só
    // zeramos o comprimento) para não gerar lixo a 15 fps.
    const faixas: number[][] = Array.from({ length: FAIXAS }, () => []);

    const montar = () => {
      largura = canvas.clientWidth;
      altura = canvas.clientHeight;
      const w = Math.max(1, Math.floor(largura * ESCALA));
      const h = Math.max(1, Math.floor(altura * ESCALA));

      canvas.width = w;
      canvas.height = h;
      buffer.width = w;
      buffer.height = h;

      // Desenhamos em pixels de tela; o contexto reduz ao rasterizar.
      bctx.setTransform(ESCALA, 0, 0, ESCALA, 0, 0);
      bctx.lineWidth = ESPESSURA_LIGACAO;
      bctx.lineCap = "round";

      // `filter` do canvas 2D não existe em todo navegador. Sem ele, o desfoque
      // do upscale de 2× já entrega um resultado aceitável.
      try {
        ctx.filter = "blur(2px)";
      } catch {
        /* sem filtro nativo: seguimos só com o upscale */
      }

      const quantidade = Math.min(MAX_PARTICULAS, Math.floor((largura * altura) / 15000));
      particulas = Array.from({ length: quantidade }, () => ({
        x: Math.random() * largura,
        y: Math.random() * altura,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
      }));
    };

    const desenhar = () => {
      bctx.clearRect(0, 0, largura, altura);
      for (const f of faixas) f.length = 0;

      const limite = DIST_LIGACAO * DIST_LIGACAO;
      for (let i = 0; i < particulas.length; i++) {
        const a = particulas[i]!;
        for (let j = i + 1; j < particulas.length; j++) {
          const b = particulas[j]!;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= limite) continue;
          const proximidade = 1 - Math.sqrt(d2) / DIST_LIGACAO;
          const faixa = Math.min(FAIXAS - 1, Math.floor(proximidade * FAIXAS));
          faixas[faixa]!.push(a.x, a.y, b.x, b.y);
        }
      }

      // Um traço por faixa — no lugar de um por segmento.
      for (let f = 0; f < FAIXAS; f++) {
        const coords = faixas[f]!;
        if (coords.length === 0) continue;
        const alpha = (((f + 0.5) / FAIXAS) * OPACIDADE_LIGACAO).toFixed(3);
        bctx.strokeStyle = `rgba(96, 165, 250, ${alpha})`;
        bctx.beginPath();
        for (let k = 0; k < coords.length; k += 4) {
          bctx.moveTo(coords[k]!, coords[k + 1]!);
          bctx.lineTo(coords[k + 2]!, coords[k + 3]!);
        }
        bctx.stroke();
      }

      // Todos os pontos em um caminho só.
      bctx.fillStyle = COR_PONTO;
      bctx.beginPath();
      for (const p of particulas) {
        bctx.moveTo(p.x + RAIO_PONTO, p.y);
        bctx.arc(p.x, p.y, RAIO_PONTO, 0, Math.PI * 2);
      }
      bctx.fill();

      // Uma única composição desfocada.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(buffer, 0, 0);
    };

    // Só deriva: nenhuma força de repulsão, nenhum ponteiro.
    const mover = () => {
      for (const p of particulas) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = largura;
        else if (p.x > largura) p.x = 0;
        if (p.y < 0) p.y = altura;
        else if (p.y > altura) p.y = 0;
      }
    };

    const intervalo = 1000 / FPS;
    let soma = 0;
    let amostras = 0;

    const loop = (agora: number) => {
      raf = requestAnimationFrame(loop);
      if (agora - ultimo < intervalo) return;
      ultimo = agora;

      if (!medir) {
        mover();
        desenhar();
        return;
      }
      const t0 = performance.now();
      mover();
      desenhar();
      soma += performance.now() - t0;
      amostras++;
      if (amostras >= FPS) {
        setMs(soma / amostras);
        soma = 0;
        amostras = 0;
      }
    };

    const aoRedimensionar = () => {
      montar();
      desenhar();
    };

    const aoTrocarVisibilidade = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduzirMovimento) {
        ultimo = 0;
        raf = requestAnimationFrame(loop);
      }
    };

    montar();
    desenhar();
    if (!reduzirMovimento) raf = requestAnimationFrame(loop);

    window.addEventListener("resize", aoRedimensionar);
    document.addEventListener("visibilitychange", aoTrocarVisibilidade);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", aoRedimensionar);
      document.removeEventListener("visibilitychange", aoTrocarVisibilidade);
    };
  }, [medir]);

  return (
    <>
      <canvas ref={ref} aria-hidden className={className} />
      {medir && (
        <div className="fixed bottom-4 left-4 z-[999] rounded-md border border-border bg-black/85 px-3 py-2 font-mono text-[12px] text-white">
          fundo: {ms === null ? "medindo…" : `${ms.toFixed(2)} ms/quadro`} · {FPS} fps
        </div>
      )}
    </>
  );
}
