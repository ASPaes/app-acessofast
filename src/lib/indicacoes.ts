import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Cadastros de revendedor feitos pelo site que esperam a aprovacao da equipe. O site
// promete resposta em ate 1 dia util e nao ha e-mail avisando: o numero no menu e o
// aviso.
export const REVENDEDORES_PENDENTES_KEY = ["revendedores-pendentes"] as const;

export function useRevendedoresPendentes(habilitado: boolean) {
  return useQuery({
    queryKey: REVENDEDORES_PENDENTES_KEY,
    enabled: habilitado,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("revendedores_pendentes");
      if (error) throw error;
      return data ?? 0;
    },
  });
}
