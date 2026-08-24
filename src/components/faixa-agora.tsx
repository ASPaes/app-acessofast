import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiRotulo, type KpiInfo } from "@/components/kpi-info";
import { STAT_COLORS, type StatColor } from "@/components/stat-card";
import type { LucideIcon } from "lucide-react";

/**
 * A faixa do INSTANTE, no topo do Dashboard.
 *
 * Existe para desfazer uma confusão que o painel tinha criado: cartões de
 * estado ("3 sessões acontecendo agora") ficavam lado a lado com cartões de
 * período ("acessos nos últimos 30 dias"), com a mesma forma e o mesmo peso.
 * Quem mexia no filtro via metade dos números mudar e a outra metade não, sem
 * nada na tela explicando por quê. Aqui a separação é física: o instante mora
 * fora das abas e fora de qualquer filtro.
 *
 * SOBRE A FORMA — e este é o ponto que a primeira versão errou. A tentativa de
 * marcar "isto é secundário" foi trocar a tipografia inteira: número bem menor,
 * rótulo menor ainda, sem ícone. O resultado não leu como hierarquia, leu como
 * peça de outro produto colada na tela.
 *
 * Hierarquia se faz com ESCALA dentro da mesma linguagem, não com linguagem
 * nova. Então aqui é o mesmo vocabulário do StatCard — rótulo em maiúsculas com
 * tracking largo, número tabular, ícone na caixinha colorida da paleta
 * categórica, dica de 11px — só que um degrau abaixo: número `text-3xl` contra
 * `text-4xl`, caixa do ícone de 28px contra 36px. Reconhece-se como parente dos
 * cartões, e ainda assim cede o primeiro plano a eles.
 *
 * O agrupamento num cartão só, com divisórias, é o que continua dizendo "estes
 * cinco números são uma coisa só, e não são os mesmos números das abas".
 */
export type ItemAgora = {
  titulo: string;
  valor: string | number | null | undefined;
  hint: string;
  icon: LucideIcon;
  color: StatColor;
  info?: KpiInfo;
};

export function FaixaAgora({ itens, loading }: { itens: ItemAgora[]; loading: boolean }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-stretch gap-y-6 p-0">
        {itens.map((item, i) => {
          const Icon = item.icon;
          return (
            <div
              key={item.titulo}
              // flex-1 em vez de largura fixa: com 3 ou com 5 itens a faixa
              // preenche a linha inteira. Na primeira versão os itens ficavam
              // encostados à esquerda e sobrava meia largura vazia, que lê como
              // conteúdo faltando.
              className={`flex-1 min-w-[11rem] px-5 py-4 ${
                i > 0 ? "border-l border-border/60" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  <KpiRotulo titulo={item.titulo} info={item.info} />
                </p>
                <div
                  className={`h-7 w-7 shrink-0 rounded-lg flex items-center justify-center ${
                    STAT_COLORS[item.color].wrap
                  }`}
                >
                  <Icon className={`h-3.5 w-3.5 ${STAT_COLORS[item.color].icon}`} />
                </div>
              </div>
              {loading ? (
                <Skeleton className="mt-2 h-8 w-16" />
              ) : (
                <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
                  {item.valor ?? 0}
                </p>
              )}
              <p className="mt-1.5 text-[11px] text-muted-foreground">{item.hint}</p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
