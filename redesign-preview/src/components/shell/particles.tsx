import * as React from "react";

/**
 * Constelação de fundo — a mesma do login do AcessoFast, reaproveitada como
 * textura do painel.
 *
 * Duas diferenças em relação ao login:
 *
 * 1. **Sem interação de mouse.** No login o campo de pontos reage ao cursor.
 *    Aqui não: o painel é uma ferramenta de trabalho, e um fundo que se mexe
 *    junto com o ponteiro rouba atenção de quem está lendo uma tabela.
 *
 * 2. **Desfocada** — ver "Custo" abaixo, porque o COMO importa muito.
 *
 * ---------------------------------------------------------------------------
 * CUSTO — leia antes de mexer em qualquer coisa aqui.
 *
 * A primeira versão travava a interface. O culpado não era a quantidade de
 * partículas nem a matemática: era `ctx.filter`, que o canvas 2D aplica **a
 * cada operação de desenho**. Com ~80 pontos, o laço de ligações emitia mais de
 * mil `stroke()` por quadro, e cada um passava por um blur próprio.
 *
 * A versão atual desenha nítido em um canvas fora de tela e faz **uma única**
 * composição desfocada por quadro. Somando tudo:
 *
 *     antes:  ~1.500 stroke() filtrados + 80 fill() filtrados  = ~1.580 ops
 *     agora:  5 stroke() + 1 fill() (nítidos) + 1 drawImage()  = 7 ops
 *
 * As 5 linhas vêm de agrupar as ligações em 5 faixas de opacidade: em vez de um
 * `stroke()` por segmento (cada um com seu alpha), monta-se um caminho por
 * faixa e traça-se uma vez. A perda de precisão no degradê é invisível depois
 * do blur.
 *
 * Somam-se a isso: canvas a 50% da resolução (4× menos pixels), 15 fps (é
 * fundo), pausa quando a aba perde o foco e um quadro estático quando o sistema
 * pede `prefers-reduced-motion`.
 *
 * Para medir na sua máquina, abra com `?perf=1` na URL:
 *     http://localhost:5199/?perf=1#/dashboard
 * ---------------------------------------------------------------------------
 */

const ESCALA = 0.5; // resolução do canvas em relação à tela
/* 15 fps. Num fundo desfocado com deriva lentíssima, a diferença para 30 fps é
   imperceptível — e corta pela metade tanto o loop quanto o recálculo do
   `backdrop-blur` da barra superior, que precisa refazer o borrão sempre que a
   camada atrás dela repinta. */
const FPS = 15;
const DIST_LIGACAO = 140; // px, igual ao login
const MAX_PARTICULAS = 80;
const FAIXAS = 5; // faixas de opacidade das ligações

/* Ponto e linha são maiores e mais opacos que no login de propósito: depois de
   reduzir a resolução e passar o blur, um ponto de 1,6 px simplesmente some.
   O que se vê no fim tem a mesma presença do original — só que fora de foco. */
const RAIO_PONTO = 2.6;
const COR_PONTO = "rgba(147, 197, 253, 0.95)";
const OPACIDADE_LIGACAO = 0.34;
const ESPESSURA_LIGACAO = 1.4;

type Particula = { x: number; y: number; vx: number; vy: number };

export function Particles({ className }: { className?: string }) {
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

    // Coordenadas das ligações por faixa de opacidade. Reaproveitadas entre os
    // quadros (só zeramos o comprimento) para não gerar lixo a 24 fps.
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

      // Desenhamos em pixels de tela; o contexto reduz na hora de rasterizar.
      bctx.setTransform(ESCALA, 0, 0, ESCALA, 0, 0);
      bctx.lineWidth = ESPESSURA_LIGACAO;
      bctx.lineCap = "round";

      // `filter` do canvas 2D não existe em todo navegador. Se não pegar, o
      // desfoque do upscale de 2× já entrega um resultado aceitável.
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

      // Distribui cada ligação na faixa de opacidade correspondente.
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
          const destino = faixas[faixa]!;
          destino.push(a.x, a.y, b.x, b.y);
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
        // média de ~1 segundo
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
        <div className="fixed bottom-4 left-4 z-[999] rounded-md border border-line bg-black/85 px-3 py-2 font-mono text-[12px] text-white">
          fundo: {ms === null ? "medindo…" : `${ms.toFixed(2)} ms/quadro`} · {FPS} fps
        </div>
      )}
    </>
  );
}
