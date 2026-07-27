import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { toast } from "sonner";
import acessofastLogo from "@/assets/acessofast-logo.png.asset.json";
import { passosParaPapel, type TourRole } from "@/components/onboarding/tour-steps";

type Props = {
  userId: string | null | undefined;
  role: TourRole | null | undefined;
};

const LARGURA_BALAO = 320;
const ALTURA_BALAO_ESTIMADA = 200;
const MARGEM = 12;
const RESPIRO = 8;
const TENTATIVAS_ALVO = 120;

function entre(valor: number, minimo: number, maximo: number): number {
  return Math.min(Math.max(valor, minimo), Math.max(minimo, maximo));
}

/** Canto do balão: à direita do alvo quando cabe (caso da sidebar), senão abaixo. */
function posicaoDoBalao(rect: DOMRect): { top: number; left: number } {
  const cabeAoLado = window.innerWidth - rect.right >= LARGURA_BALAO + MARGEM * 2;
  const limiteTop = window.innerHeight - ALTURA_BALAO_ESTIMADA - MARGEM;
  if (cabeAoLado) {
    return {
      top: entre(rect.top, MARGEM, limiteTop),
      left: rect.right + MARGEM + RESPIRO,
    };
  }
  return {
    top: entre(rect.bottom + MARGEM + RESPIRO, MARGEM, limiteTop),
    left: entre(rect.left, MARGEM, window.innerWidth - LARGURA_BALAO - MARGEM),
  };
}

export function OnboardingTour({ userId, role }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  // -1 = tela de boas-vindas; 0..n-1 = passos com destaque.
  const [etapa, setEtapa] = useState(-1);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [encerrado, setEncerrado] = useState(false);

  // Query própria (e silenciosa): se a coluna ainda não existir no banco, o erro
  // fica contido aqui e o painel segue normal, sem tour.
  const { data: status } = useQuery({
    queryKey: ["onboarding-status", userId],
    enabled: !!userId,
    retry: false,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, onboarding_done_at")
        .eq("id", userId as string)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const passos = useMemo(() => (role ? passosParaPapel(role) : []), [role]);
  const ativo = !encerrado && !!role && passos.length > 0 && !!status && !status.onboarding_done_at;
  const passo = ativo && etapa >= 0 ? passos[etapa] : null;

  const concluir = useMutation({
    mutationFn: async () => {
      if (!userId) return;
      const { error } = await supabase
        .from("profiles")
        .update({ onboarding_done_at: new Date().toISOString() })
        .eq("id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["onboarding-status", userId] });
    },
    onError: () => {
      // Falhar ao gravar não pode prender o usuário atrás do overlay.
      toast.error("Não foi possível registrar a conclusão do tour, mas o painel já está liberado.");
    },
    onSettled: () => {
      setEncerrado(true);
    },
  });

  const avancar = useCallback(() => {
    if (etapa >= passos.length - 1) {
      concluir.mutate();
      return;
    }
    setRect(null);
    setEtapa((i) => i + 1);
  }, [concluir, etapa, passos.length]);

  const voltar = useCallback(() => {
    setRect(null);
    setEtapa((i) => Math.max(0, i - 1));
  }, []);

  // Leva o painel até a tela do passo antes de destacar o alvo.
  useEffect(() => {
    if (!passo?.route || pathname === passo.route) return;
    void navigate({ to: passo.route });
  }, [navigate, passo, pathname]);

  // Procura o alvo (a tela pode ainda estar montando) e mede o recorte.
  useEffect(() => {
    if (!passo?.target) {
      setRect(null);
      return;
    }
    const seletor = `[data-tour="${passo.target}"]`;
    let quadro = 0;
    let tentativas = 0;

    const procurar = () => {
      const alvo = document.querySelector<HTMLElement>(seletor);
      if (alvo) {
        alvo.scrollIntoView({ block: "nearest", behavior: "smooth" });
        setRect(alvo.getBoundingClientRect());
        return;
      }
      if (tentativas++ < TENTATIVAS_ALVO) {
        quadro = requestAnimationFrame(procurar);
      } else {
        setRect(null);
      }
    };
    procurar();

    const remedir = () => {
      const alvo = document.querySelector<HTMLElement>(seletor);
      if (alvo) setRect(alvo.getBoundingClientRect());
    };
    window.addEventListener("resize", remedir);
    window.addEventListener("scroll", remedir, true);

    return () => {
      cancelAnimationFrame(quadro);
      window.removeEventListener("resize", remedir);
      window.removeEventListener("scroll", remedir, true);
    };
  }, [passo, pathname]);

  // Setas navegam; Esc não faz nada, o tour é obrigatório. Enter fica de fora
  // de propósito: com o botão focado ele já dispara o clique.
  useEffect(() => {
    if (!ativo || etapa < 0) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        avancar();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        voltar();
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [ativo, avancar, etapa, voltar]);

  if (!ativo) return null;

  if (etapa < 0) {
    return (
      <Dialog open>
        <DialogContent
          className="sm:max-w-md [&>button]:hidden"
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <img
              src={acessofastLogo.url}
              alt="AcessoFast"
              className="mb-2 h-10 w-10 object-contain"
            />
            <DialogTitle>Bem-vindo ao AcessoFast</DialogTitle>
            <DialogDescription>
              Vamos dar uma volta de 1 minuto pelo painel? São {passos.length} paradas rápidas e no
              fim você sabe para que serve cada tela. Isto aparece só neste primeiro acesso.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setEtapa(0)}>
              Bora, me mostra
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (typeof document === "undefined" || !passo) return null;

  const ultimo = etapa === passos.length - 1;
  const balao = rect ? posicaoDoBalao(rect) : null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70]"
      role="dialog"
      aria-modal="true"
      aria-label="Tour do painel"
    >
      {/* Captura qualquer clique: durante o tour o painel é só cenário. */}
      <div className={"absolute inset-0" + (rect ? "" : " bg-black/70")} />

      {rect && (
        <div
          className="pointer-events-none absolute rounded-md ring-2 ring-primary transition-all duration-200"
          style={{
            top: rect.top - RESPIRO,
            left: rect.left - RESPIRO,
            width: rect.width + RESPIRO * 2,
            height: rect.height + RESPIRO * 2,
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.7)",
          }}
        />
      )}

      <div
        className={
          "absolute w-[320px] rounded-lg border border-border/60 bg-background p-4 shadow-lg " +
          (balao ? "" : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2")
        }
        style={balao ? { top: balao.top, left: balao.left } : undefined}
      >
        <p className="text-[11px] uppercase tracking-[0.14em] text-text-dim">
          Passo {etapa + 1} de {passos.length}
        </p>
        <p className="mt-1 font-medium">{passo.title}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">{passo.body}</p>

        <div className="mt-4 flex items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1" aria-hidden>
            {passos.map((p, i) => (
              <span
                key={p.id}
                className={
                  "h-1.5 rounded-full transition-all " +
                  (i === etapa ? "w-4 bg-primary" : "w-1.5 bg-border")
                }
              />
            ))}
          </div>
          {etapa > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0"
              onClick={voltar}
              disabled={concluir.isPending}
            >
              <ArrowLeft className="mr-1 h-4 w-4" />
              Voltar
            </Button>
          )}
          <Button size="sm" className="shrink-0" onClick={avancar} disabled={concluir.isPending}>
            {ultimo ? (
              <>
                <Check className="mr-1 h-4 w-4" />
                Concluir
              </>
            ) : (
              <>
                Próximo
                <ArrowRight className="ml-1 h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
