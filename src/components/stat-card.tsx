import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiRotulo, type KpiInfo } from "@/components/kpi-info";
import type { LucideIcon } from "lucide-react";

/**
 * Cartão de número do painel. Nasceu dentro do Dashboard e subiu para cá quando
 * a Auditoria passou a precisar do mesmo formato — número grande, ícone à
 * direita, uma linha de contexto embaixo.
 *
 * O motivo de compartilhar não é economizar código, é manter a leitura: um
 * número no painel deve ter sempre o mesmo tamanho e o mesmo peso, senão o
 * usuário passa a comparar tipografia em vez de comparar valores.
 */

/**
 * Cor categórica de métrica — identifica o cartão, não comunica estado.
 *
 * Os tons de fábrica do Tailwind tinham três pares indistinguíveis num ícone de
 * 16px. Medido em CIEDE2000 (ΔE76 subestima diferença justo na faixa amarela):
 *
 *   amber x yellow ... 4,4     <- "Sessões ativas" e "Créditos" liam igual
 *   blue  x sky ...... 8,0
 *   blue  x violet ... 14,4
 *
 * Abaixo de ~15 as pessoas confundem. Trocando yellow->lime, sky->cyan e
 * clareando o violeta, a MENOR distância do conjunto vai de 4,4 para 19,8 —
 * é o par mais próximo que decide se a codificação por cor funciona.
 *
 * Créditos ficou verde-limão e não rosa por significado, não estética: o rosa
 * que a otimização também aceitava fica a ΔE00 10,9 do vermelho de erro, e num
 * painel de cobrança um ícone de Créditos que lê como alarme é armadilha.
 */
export const STAT_COLORS = {
  blue: { icon: "text-viz-blue", wrap: "bg-viz-blue/10" },
  emerald: { icon: "text-viz-emerald", wrap: "bg-viz-emerald/10" },
  amber: { icon: "text-viz-amber", wrap: "bg-viz-amber/10" },
  violet: { icon: "text-viz-violet", wrap: "bg-viz-violet/10" },
  lime: { icon: "text-viz-lime", wrap: "bg-viz-lime/10" },
  cyan: { icon: "text-viz-cyan", wrap: "bg-viz-cyan/10" },
} as const;

export type StatColor = keyof typeof STAT_COLORS;

export function StatCard({
  title,
  value,
  icon: Icon,
  hint,
  loading,
  color = "blue",
  info,
}: {
  title: string;
  value: number | string | undefined;
  icon: LucideIcon;
  hint: string;
  loading: boolean;
  color?: StatColor;
  /**
   * Explicação do indicador. Opcional de propósito: um cartão sem `info`
   * continua exatamente como era, então nenhum uso existente quebra — mas a
   * ausência aqui é dívida, não escolha. Número no painel sem definição é
   * número que cada pessoa entende de um jeito.
   */
  info?: KpiInfo;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3 space-y-0">
        <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground">
          <KpiRotulo titulo={title} info={info} />
        </CardTitle>
        <div
          className={`h-9 w-9 rounded-lg flex items-center justify-center ${STAT_COLORS[color].wrap}`}
        >
          <Icon className={`h-4 w-4 ${STAT_COLORS[color].icon}`} />
        </div>
      </CardHeader>
      <CardContent className="pt-1">
        {loading ? (
          <Skeleton className="h-10 w-20" />
        ) : (
          <div className="text-4xl font-semibold tabular-nums tracking-tight">{value ?? 0}</div>
        )}
        <p className="text-[11px] text-muted-foreground mt-2">{hint}</p>
      </CardContent>
    </Card>
  );
}
