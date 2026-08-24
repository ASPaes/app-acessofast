import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * A explicação de um indicador, aberta no próprio rótulo dele.
 *
 * O problema que resolve: um número grande sem definição é lido como se fosse
 * óbvio, e quase nunca é. "Sessões ativas" conta o quê — sessão aberta ou
 * máquina ligada? "Em atraso" é dinheiro perdido ou dinheiro atrasado? Quem não
 * sabe inventa uma definição própria, age sobre ela, e o painel passa a ser
 * discutido em vez de usado.
 *
 * Três campos obrigatórios, na ordem em que a dúvida aparece:
 *   - `oQue`   — a definição, em uma frase.
 *   - `porQue` — a decisão que esse número muda. Um indicador que não muda
 *                nenhuma decisão não devia estar no painel.
 *   - `comoCalculamos` — a conta, na linguagem dos dados. É o campo que impede
 *                a discussão de "esse número está errado": dá para conferir.
 *
 * `referencia` é opcional e só entra quando existe um valor de comparação
 * honesto. Sem base real, fica de fora — número de referência inventado é pior
 * que nenhum, porque vira meta.
 */
export type KpiInfo = {
  oQue: string;
  porQue: string;
  comoCalculamos: string;
  referencia?: string;
};

/**
 * Popover e não tooltip: o conteúdo tem quatro blocos e precisa ser lido com
 * calma, às vezes com o texto selecionado. Tooltip do Radix fecha ao mover o
 * mouse e não abre em toque nenhum — no celular o afordance simplesmente não
 * existiria. Botão de verdade, então: abre no clique, no toque e no teclado.
 */
export function KpiInfoBotao({ info, titulo }: { info: KpiInfo; titulo: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          // `normal-case` porque o rótulo do cartão é uppercase e o "?" herdaria
          // isso — irrelevante no ícone, relevante no aria-label lido em voz alta.
          className="normal-case text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background rounded-full"
          aria-label={`O que é ${titulo}`}
          onClick={(e) => e.stopPropagation()}
        >
          <HelpCircle className="h-3.5 w-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3 text-left">
        <p className="text-sm font-semibold leading-none">{titulo}</p>
        <Bloco rotulo="O que é" texto={info.oQue} />
        <Bloco rotulo="Por que importa" texto={info.porQue} />
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Como calculamos</p>
          <code className="block rounded bg-muted px-2 py-1.5 text-[11px] leading-relaxed text-foreground">
            {info.comoCalculamos}
          </code>
        </div>
        {info.referencia && <Bloco rotulo="Referência" texto={info.referencia} />}
      </PopoverContent>
    </Popover>
  );
}

function Bloco({ rotulo, texto }: { rotulo: string; texto: string }) {
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      <span className="font-medium text-foreground">{rotulo}:</span> {texto}
    </p>
  );
}

/**
 * O rótulo do indicador. Com `info`, ganha sublinhado tracejado — a convenção de
 * "há definição aqui" — e o botão de ajuda ao lado. Sem `info`, é texto puro:
 * sublinhar o que não abre nada seria prometer o que não se entrega.
 */
export function KpiRotulo({
  titulo,
  info,
  className = "",
}: {
  titulo: string;
  info?: KpiInfo;
  className?: string;
}) {
  if (!info) return <span className={className}>{titulo}</span>;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="border-b border-dashed border-current/40">{titulo}</span>
      <KpiInfoBotao info={info} titulo={titulo} />
    </span>
  );
}
