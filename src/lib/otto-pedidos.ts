import { useEffect, useRef } from "react";

// Pedidos que o ajudante do Otto (topo do painel) faz a janelas que moram em
// outras partes da tela: "Adicionar dispositivo" vive na página Dispositivos, as
// Novidades e a Caixa de sugestões vivem na barra do topo. O pedido fica guardado
// até alguém atender, porque quem pede pode estar em outra página: o ajudante
// navega para Dispositivos e a tela que abre a janela só monta depois. Pedido
// que ninguém atendeu em alguns segundos caduca: a janela não pode abrir sozinha
// numa visita futura.

export type PedidoDoOtto = "adicionar-dispositivo" | "abrir-novidades" | "abrir-sugestoes";

const EVENTO = "otto:pedido";
const VALIDADE_MS = 15_000;
const pendentes = new Map<PedidoDoOtto, number>();

export function pedirAoPainel(pedido: PedidoDoOtto) {
  pendentes.set(pedido, Date.now());
  window.dispatchEvent(new CustomEvent(EVENTO));
}

/** Atende o pedido quando ele chega, ou na montagem se já estava esperando. */
export function useAtenderPedido(pedido: PedidoDoOtto, atender: () => void) {
  const atual = useRef(atender);
  atual.current = atender;
  useEffect(() => {
    const tentar = () => {
      const feito = pendentes.get(pedido);
      if (feito === undefined) return;
      pendentes.delete(pedido);
      if (Date.now() - feito < VALIDADE_MS) atual.current();
    };
    tentar();
    window.addEventListener(EVENTO, tentar);
    return () => window.removeEventListener(EVENTO, tentar);
  }, [pedido]);
}
