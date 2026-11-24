import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * A empresa já tem contratação paga, mesmo sem cliente no Asaas (Pix por fora da
 * plataforma não cria cliente lá). Fica `undefined` enquanto carrega ou se a
 * consulta falhar: só `false` quer dizer "nunca contratou", para a tela não mandar
 * contratar quem já pagou.
 */
export function useJaContratou(tenantId: string | null | undefined) {
  return useQuery({
    queryKey: ["conta-ja-contratou", tenantId],
    enabled: !!tenantId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("conta_ja_contratou");
      if (error) throw error;
      return data;
    },
  });
}
