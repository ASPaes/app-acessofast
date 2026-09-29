import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Caixa de sugestoes: rotulos compartilhados entre a caixa do cliente e a tela de
// triagem da plataforma. Os valores sao os do CHECK da tabela `sugestoes`.

export const CATEGORIAS = [
  { valor: "melhoria", rotulo: "Melhoria em algo que já existe" },
  { valor: "novo_recurso", rotulo: "Recurso novo" },
  { valor: "problema", rotulo: "Algo que não funciona bem" },
  { valor: "outro", rotulo: "Outro assunto" },
] as const;

export const CATEGORIA_CURTA: Record<string, string> = {
  melhoria: "Melhoria",
  novo_recurso: "Recurso novo",
  problema: "Problema",
  outro: "Outro",
};

export const STATUS = [
  { valor: "nova", rotulo: "Recebida" },
  { valor: "em_analise", rotulo: "Em análise" },
  { valor: "planejada", rotulo: "Planejada" },
  { valor: "feita", rotulo: "Feita" },
  { valor: "descartada", rotulo: "Não vamos fazer" },
] as const;

export const STATUS_ROTULO: Record<string, string> = Object.fromEntries(
  STATUS.map((s) => [s.valor, s.rotulo]),
);

export const STATUS_CLASSE: Record<string, string> = {
  nova: "bg-primary/10 text-primary",
  em_analise: "bg-warning/15 text-warning",
  planejada: "bg-primary/15 text-primary",
  feita: "bg-success/15 text-success",
  descartada: "bg-muted text-muted-foreground",
};

export const TITULO_MAX = 120;
export const DESCRICAO_MAX = 4000;
// Barra o "oi": a caixa e para sugestao, nao para recado. O gatilho da tabela exige o
// mesmo minimo em todo envio novo.
export const DESCRICAO_MIN = 20;

// Contagem das que ninguem da ASP abriu ainda. Mesma ideia do badge de solicitacoes
// de acesso: nao ha e-mail avisando, entao o numero precisa aparecer no menu.
export const SUGESTOES_NOVAS_KEY = ["sugestoes-novas"] as const;

export function useSugestoesNovas(habilitado: boolean) {
  return useQuery({
    queryKey: SUGESTOES_NOVAS_KEY,
    enabled: habilitado,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("sugestoes")
        .select("id", { count: "exact", head: true })
        .eq("status", "nova");
      if (error) throw error;
      return count ?? 0;
    },
  });
}
