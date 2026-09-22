/**
 * A nota livre — de máquina (address_book.observacoes) ou de cliente
 * (clients.observacoes) — e a preferência de como ela é lida.
 *
 * Mora aqui, e não em cada tela, porque a preferência é UMA: quem desliga a nota
 * flutuante em Dispositivos não quer que ela volte a pular em Clientes. Duas
 * cópias do selo divergiriam na primeira mudança de gosto — foi o que aconteceu
 * com a regra de presença (ver lib/presenca e a migration 20260918120000).
 */
import { useEffect, useState } from "react";
import { StickyNote } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

// Fica no navegador, e não no perfil, porque é gosto de quem opera, não regra da
// empresa — cada técnico escolhe o seu sem que isso vire configuração de conta.
const OBS_HOVER_LS_KEY = "acessofast:observacoes-hover";

/**
 * Preferência "nota flutuante ao passar o mouse", ligada por padrão.
 *
 * Lê o localStorage na montagem: navegar entre Dispositivos e Clientes remonta a
 * rota, então a escolha feita numa tela já vale na outra. Toda leitura e escrita
 * vai em try/catch — em janela anônima, ou com dados de site bloqueados, o
 * acessador lança, e uma preferência de conforto não pode derrubar a tela.
 */
export function useObservacaoHover(): [boolean, (v: boolean) => void] {
  const [hover, setHover] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem(OBS_HOVER_LS_KEY) !== "0";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(OBS_HOVER_LS_KEY, hover ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [hover]);

  return [hover, setHover];
}

/**
 * Selo da nota, ao lado do nome. Só aparece quando há nota: linha sem observação
 * não ganha enfeite nenhum.
 *
 * Com `hover` ligado a nota sai flutuando ao passar o mouse; desligado, o selo
 * continua avisando que a nota existe — o texto abre pelo editor. O clique abre
 * o editor nos dois modos: quem já está com o mouse em cima não devia ter de
 * caçar o menu.
 */
export function NotaObservacao({
  texto,
  hover,
  onAbrir,
  rotulo = "Observações",
}: {
  texto: string | null;
  hover: boolean;
  onAbrir: () => void;
  /** Cabeçalho do cartão e rótulo do leitor de tela. */
  rotulo?: string;
}) {
  const nota = texto?.trim();
  if (!nota) return null;

  const selo = (
    <button
      type="button"
      onClick={(e) => {
        // A linha inteira pode ser clicável (expandir, abrir detalhe): sem isto o
        // clique no selo dispararia as duas coisas.
        e.stopPropagation();
        onAbrir();
      }}
      title={hover ? undefined : "Ver observações"}
      aria-label={rotulo}
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-warning hover:text-warning/70"
    >
      <StickyNote className="h-3.5 w-3.5" />
    </button>
  );

  if (!hover) return selo;

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>{selo}</HoverCardTrigger>
      <HoverCardContent align="start" className="w-72 p-3">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
          <StickyNote className="h-3 w-3" />
          {rotulo}
        </div>
        {/* whitespace-pre-wrap para a nota sair com as quebras de linha que a
            pessoa digitou; break-words para um caminho de rede colado ali não
            esticar o cartão. */}
        <p className="mt-1.5 whitespace-pre-wrap break-words text-xs">{nota}</p>
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * O interruptor da preferência. Vem junto com o selo de propósito: o texto
 * explica o que cada posição faz, e uma segunda redação na outra tela já seria
 * uma segunda explicação para manter.
 */
export function SwitchObservacaoHover({
  hover,
  onChange,
  id = "obs-hover",
}: {
  hover: boolean;
  onChange: (v: boolean) => void;
  id?: string;
}) {
  return (
    <div className="flex items-center gap-2 px-2">
      <Switch id={id} checked={hover} onCheckedChange={onChange} />
      <Label
        htmlFor={id}
        className="text-xs text-muted-foreground flex items-center gap-1"
        title="Ligado: a observação aparece flutuando ao passar o mouse sobre o selo. Desligado: o selo só avisa que existe, e o texto abre ao editar."
      >
        <StickyNote className="h-3 w-3" />
        Observação ao passar o mouse
      </Label>
    </div>
  );
}
