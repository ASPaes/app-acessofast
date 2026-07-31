import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Perfil de quem está logado. A mesma consulta estava copiada em cinco telas,
 * cada uma com a sua chave de cache — o que fazia o painel buscar o próprio
 * perfil cinco vezes por navegação e, pior, abria espaço para duas telas
 * discordarem sobre o papel do usuário depois de uma troca de conta.
 *
 * A chave "me" é a que o app-shell e a sidebar já usavam, então o cache é
 * compartilhado com quem ainda não migrou.
 */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      const uid = userData.user?.id;
      if (!uid) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("id, role, tenant_id")
        .eq("id", uid)
        .single();
      if (error) throw error;
      return data;
    },
  });
}
