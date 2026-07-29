import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Solicitações de acesso pendentes visíveis para quem está logado. A RLS de
// `join_requests` já limita ao próprio tenant (ou a tudo, se super_admin), então
// a consulta não precisa filtrar por empresa.
//
// Compartilhado entre o badge da sidebar e a tela de Usuários: mesma queryKey,
// então o react-query serve os dois com uma requisição só e um invalidate
// atualiza os dois.
export const SOLICITACOES_QUERY_KEY = ["join-requests-pendentes"] as const;

export type SolicitacaoAcesso = {
  id: string;
  tenant_id: string;
  tenant_name: string | null;
  user_id: string;
  full_name: string | null;
  email: string;
  created_at: string;
};

export function useSolicitacoesAcesso(habilitado: boolean) {
  return useQuery({
    queryKey: SOLICITACOES_QUERY_KEY,
    enabled: habilitado,
    queryFn: async (): Promise<SolicitacaoAcesso[]> => {
      const { data, error } = await supabase
        .from("join_requests")
        .select("id, tenant_id, tenant_name, user_id, full_name, email, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}
