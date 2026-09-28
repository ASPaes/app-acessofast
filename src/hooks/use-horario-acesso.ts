import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SituacaoHorario } from "@/lib/horario-acesso";

/**
 * Situação de AGORA do horário de acesso de cada empresa que o usuário enxerga — a RLS
 * decide: a própria empresa, ou todas para o super_admin. Mapa por tenant_id.
 *
 * Relê logo depois da próxima virada (abertura ou fechamento de alguma janela), para o
 * Conectar travar e destravar sozinho na hora certa, e no máximo a cada minuto.
 *
 * Erro na leitura não trava nada: sem a view (deploy fora de ordem) o painel se comporta
 * como antes da regra existir. Quem recusa de verdade é o servidor (connect-device).
 */
export function useHorarioAcesso(enabled = true) {
  return useQuery({
    queryKey: ["v_horario_acesso"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_horario_acesso")
        .select("tenant_id, ativo, fora, fecha_em, abre_em, timezone");
      if (error) throw error;
      const porEmpresa = new Map<string, SituacaoHorario>();
      // Cast pelo mesmo motivo da lista de Dispositivos: o PostgREST não prova NOT NULL
      // através de view, e tipa toda coluna como anulável.
      for (const s of (data ?? []) as unknown as SituacaoHorario[]) porEmpresa.set(s.tenant_id, s);
      return porEmpresa;
    },
    refetchInterval: (query) => {
      const agora = Date.now();
      let proxima = 60_000;
      for (const s of query.state.data?.values() ?? []) {
        for (const iso of [s.fecha_em, s.abre_em]) {
          if (!iso) continue;
          const ms = new Date(iso).getTime() - agora + 1_000;
          if (ms > 0 && ms < proxima) proxima = ms;
        }
      }
      return Math.max(proxima, 5_000);
    },
  });
}
