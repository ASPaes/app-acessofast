import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MessageCircle } from "lucide-react";

/**
 * Convite do grupo do AcessoFast no WhatsApp, mostrado depois do pagamento.
 * O mesmo link está na tela /obrigado do site comercial (repo ASPaes/acessofast),
 * para onde o Asaas manda quem paga plano. Trocou o link? Troque nos dois.
 */
export const LINK_GRUPO_WHATSAPP = "https://chat.whatsapp.com/CrFBEtSZ5t9HOHzpTpbRYA";

// Quem já clicou em "Entrar no grupo" neste navegador não recebe o convite de novo
// a cada compra. É só conveniência: sem o storage, o convite aparece e pronto.
const CHAVE = "acessofast:entrou-no-grupo-whatsapp";

export function jaEntrouNoGrupo(): boolean {
  try {
    return localStorage.getItem(CHAVE) === "1";
  } catch {
    return false;
  }
}

function marcarQueEntrou() {
  try {
    localStorage.setItem(CHAVE, "1");
  } catch {
    // navegador sem storage: o convite volta na próxima compra, sem prejuízo
  }
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Primeira linha, sobre o pagamento que acabou de ser feito. */
  aviso: string;
};

export function ConviteGrupoWhatsapp({ open, onOpenChange, aviso }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Entre no grupo do AcessoFast no WhatsApp</DialogTitle>
          <DialogDescription>{aviso}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Um clique no botão e você entra direto no nosso grupo.
        </p>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Agora não
          </Button>
          <Button asChild>
            <a
              href={LINK_GRUPO_WHATSAPP}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                marcarQueEntrou();
                onOpenChange(false);
              }}
            >
              <MessageCircle className="mr-2 h-4 w-4" aria-hidden />
              Entrar no grupo
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
