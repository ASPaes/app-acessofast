import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";

// ---------------------------------------------------------------------------
// O slot de anuncio do plano gratuito — Fase 1 (painel).
//
// Dois lugares, os dois DECIDIDOS PELO SERVIDOR (edge function ad-serve): esta
// tela nao escolhe peca, nao conhece campanha e nao conta exibicao. Se
// escolhesse, os tetos de exibicao viravam sugestao — bastaria uma sessao de
// painel adulterada pra inflar o numero que depois se vende pro anunciante.
//
// Sobre a forma: NAO e interstitial de tela cheia com "fechar" bloqueado. Isso
// e a descricao literal de manual de adware, e o instalador ainda nao e
// assinado. O slot entra DENTRO de uma tela que o tecnico ja ia ler de qualquer
// jeito (a da credencial, a do saldo esgotado), no intervalo entre clicar em
// Conectar e a sessao abrir. Cobre o mesmo momento sem inventar friccao nova, e
// nunca aparece durante sessao ativa.
// ---------------------------------------------------------------------------

type Placement = "free_start" | "exhausted";
// 'embed' e a janela de 520px aberta pelo chat do DoctorSaaS (/conectar), que se
// fecha sozinha depois do clique. Vai junto na medicao porque o CTR dela nao e
// comparavel ao do painel — sem esse rotulo, um numero ruim nao teria diagnostico.
type Surface = "painel" | "embed";

type Anuncio = {
  impression_id: string;
  kind: "house" | "third_party";
  headline: string;
  body: string | null;
  cta_label: string;
  cta_url: string;
  image_url: string | null;
};

export function AnuncioSlot({
  placement,
  ativo,
  surface = "painel",
}: {
  placement: Placement;
  ativo: boolean;
  surface?: Surface;
}) {
  const navigate = useNavigate();
  const [anuncio, setAnuncio] = useState<Anuncio | null>(null);
  // Uma exibicao por abertura da tela. Sem esta trava o React em dev monta o
  // componente duas vezes e gravaria duas impressoes da mesma peca — que e
  // justamente o dado que precisa ser confiavel aqui.
  const jaPediu = useRef(false);
  // Invalida resposta em voo quando o slot e DESLIGADO. Repare que quem faz isso
  // e esta contagem, nao o cleanup do efeito: em dev o React monta, limpa e monta
  // de novo: um cleanup que marcasse "cancelado" mataria a resposta da unica
  // requisicao que o jaPediu deixou sair (a da 1a montagem), e a 2a montagem nem
  // chega a pedir. As duas travas se anulavam e o slot nunca aparecia — com a
  // impressao ja gravada no servidor, que e o pior dos dois mundos.
  const geracao = useRef(0);

  useEffect(() => {
    if (!ativo) {
      jaPediu.current = false;
      geracao.current += 1;
      setAnuncio(null);
      return;
    }
    if (jaPediu.current) return;
    jaPediu.current = true;
    const minhaGeracao = geracao.current;

    void (async () => {
      // Anuncio que falha nao vira erro na tela: o tecnico esta no meio de um
      // atendimento e a tela hospedeira (credencial, saldo) tem trabalho de
      // verdade a fazer. Sem peca, o slot some.
      const { data, error } = await supabase.functions.invoke<{ ad: Anuncio | null }>("ad-serve", {
        body: { placement, surface },
      });
      if (error || geracao.current !== minhaGeracao) return;
      setAnuncio(data?.ad ?? null);
    })();
  }, [ativo, placement, surface]);

  if (!anuncio) return null;

  const interno = anuncio.cta_url.startsWith("/");

  function clicar() {
    if (!anuncio) return;
    // Registro do clique em paralelo: segurar a navegacao esperando o track
    // atrasaria a unica coisa que o tecnico pediu. Perder um clique de metrica
    // custa menos que um painel que trava ao clicar.
    void supabase.functions.invoke("ad-serve", {
      body: { impression_id: anuncio.impression_id, event: "click" },
    });
    if (interno) void navigate({ to: anuncio.cta_url });
    else window.open(anuncio.cta_url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3">
      {/* Rotulo obrigatorio e diferente por tipo. Peca de terceiro tem que dizer
          que e publicidade; oferta da propria casa tem que dizer que e da casa.
          Slot sem rotulo faz o tecnico ler anuncio como recomendacao do produto,
          e e assim que se queima a confianca no painel inteiro. */}
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {anuncio.kind === "third_party" ? "Publicidade" : "Do AcessoFast"}
      </p>

      {anuncio.image_url && (
        <img
          src={anuncio.image_url}
          alt=""
          className="mb-2 max-h-32 w-full rounded object-cover"
          loading="lazy"
        />
      )}

      <p className="text-sm font-medium">{anuncio.headline}</p>
      {anuncio.body && <p className="mt-1 text-xs text-muted-foreground">{anuncio.body}</p>}

      <Button type="button" variant="outline" size="sm" className="mt-2.5" onClick={clicar}>
        {anuncio.cta_label}
        {!interno && <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden />}
      </Button>
    </div>
  );
}
