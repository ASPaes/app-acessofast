import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Oferta de lancamento — o MESMO preco que o site comercial mostra e cobra.
//
// A regra mora no banco (public.launch_offer_status): desconto sobre o preco de
// tabela enquanto sobrar vaga entre as N primeiras empresas contratantes. O site
// (src/lib/launch-offer.ts, repo ASPaes/acessofast), a create-checkout-prod e a
// create-renewal-prod leem a mesma RPC; este arquivo repete so o arredondamento.
// Se os calculos divergirem, a tela promete um valor e o Asaas cobra outro.
// ---------------------------------------------------------------------------

export type OfertaLancamento = {
  /** Ja combina "ligada" com "ainda tem vaga": true = o desconto vale. */
  is_active: boolean;
  discount_percent: number;
  /** Cobrancas mensais com o preco de lancamento; null = sem prazo. */
  discount_months: number | null;
  slots_left: number;
};

export function useOfertaLancamento(enabled = true) {
  return useQuery({
    queryKey: ["oferta-lancamento"],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<OfertaLancamento | null> => {
      const { data, error } = await supabase.rpc("launch_offer_status");
      if (error) throw error;
      const linha = (Array.isArray(data) ? data[0] : data) as OfertaLancamento | undefined;
      return linha ?? null;
    },
  });
}

/** Mesmo arredondamento da create-checkout-prod e da create-renewal-prod. */
export function aplicarDesconto(centavos: number, percent: number): number {
  return Math.round((centavos * (100 - percent)) / 100);
}

/** Percentual da oferta, ou null quando ela não vale agora. */
export function percentualDaOferta(oferta: OfertaLancamento | null | undefined): number | null {
  return oferta?.is_active ? oferta.discount_percent : null;
}

/** "Preço de lançamento · 12 primeiros meses", como no card do site. */
export function rotuloDaOferta(oferta: OfertaLancamento): string {
  return oferta.discount_months === null
    ? "Preço de lançamento"
    : `Preço de lançamento · ${oferta.discount_months} primeiros meses`;
}
