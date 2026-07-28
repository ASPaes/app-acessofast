import { Particles } from "./particles";
import { usePreview } from "@preview/data/preview-state";

/**
 * Ambiente do painel.
 * ---------------------------------------------------------------------------
 * O fundo chapado deixava a interface "crua": os painéis pareciam recortes
 * colados sobre uma chapa preta. Aqui entra uma camada atmosférica fixa —
 * manchas azuis grandes e muito diluídas + granulado fino — que dá profundidade
 * e faz os painéis flutuarem, do mesmo jeito que os cartões flutuam sobre o
 * fundo lavado das referências.
 *
 * Duas decisões técnicas:
 *
 * 1. As manchas são `radial-gradient`, não `<div>` com `filter: blur()`.
 *    O resultado visual é o mesmo (um borrão suave), mas sem custo de GPU e
 *    sem repintar a cada scroll — importante num painel que fica horas aberto.
 *
 * 2. O granulado existe por um motivo prático: degradês escuros e de baixo
 *    contraste produzem banding (faixas visíveis) em telas de 8 bits. Um ruído
 *    de ~3% quebra as faixas e ainda dá textura à superfície.
 *
 * A camada é `fixed` e `pointer-events-none`: não entra no fluxo, não captura
 * clique e não rola junto com o conteúdo.
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

/**
 * Ordem de pintura (todas em z-0, atrás do conteúdo em z-10):
 *   1. manchas azuis      — dão a profundidade
 *   2. constelação        — a mesma do login, desfocada e sem interação
 *   3. granulado          — mata o banding e fecha a textura
 */
export function Ambient() {
  const { fundoAnimado } = usePreview();
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{ backgroundImage: MANCHAS }}
      />
      {fundoAnimado && (
        <Particles className="pointer-events-none fixed inset-0 z-0 h-full w-full opacity-90" />
      )}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.035]"
        style={{ backgroundImage: GRAO, backgroundSize: "160px 160px" }}
      />
    </>
  );
}
