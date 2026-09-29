import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  NOVIDADES,
  lerVisto,
  marcarVisto,
  podeVer,
  type Novidade,
  type TipoNovidade,
} from "@/lib/novidades";

// ---------------------------------------------------------------------------
// Novidades: o que foi lancado no AcessoFast, dia a dia. Fica na barra do topo, ao
// lado da caixa de sugestoes — as duas sao a conversa entre o cliente e a equipe:
// uma e o que ele pede, a outra e o que saiu.
//
// O ponto azul marca que ha nota que a pessoa ainda nao viu. "Visto" e a nota do
// topo no momento em que ela abriu o painel: nota nova entra no topo, entao basta
// comparar com ela — ate duas no mesmo dia se distinguem.
// ---------------------------------------------------------------------------

const TIPO: Record<TipoNovidade, { rotulo: string; classe: string }> = {
  novo: { rotulo: "Novo", classe: "bg-primary/12 text-primary" },
  melhoria: { rotulo: "Melhoria", classe: "bg-success/15 text-success" },
  correcao: { rotulo: "Correção", classe: "bg-warning/15 text-warning" },
};

const chaveDe = (n: Novidade) => `${n.data}|${n.titulo}`;

function dataPorExtenso(data: string) {
  // Meio-dia, para o fuso do navegador nao jogar a data para o dia anterior.
  return new Date(`${data}T12:00:00`).toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function Novidades({ userId, role }: { userId: string; role: string | null }) {
  const [aberto, setAberto] = useState(false);

  const visiveis = useMemo(() => NOVIDADES.filter((n) => podeVer(n.para, role)), [role]);
  const topo = visiveis[0] ? chaveDe(visiveis[0]) : null;
  const [visto, setVisto] = useState(() => lerVisto(userId));
  const temNova = !!topo && visto !== topo;

  const porDia = useMemo(() => {
    const grupos: { data: string; itens: Novidade[] }[] = [];
    for (const n of visiveis) {
      const ultimo = grupos[grupos.length - 1];
      if (ultimo?.data === n.data) ultimo.itens.push(n);
      else grupos.push({ data: n.data, itens: [n] });
    }
    return grupos;
  }, [visiveis]);

  return (
    <Sheet
      open={aberto}
      onOpenChange={(v) => {
        setAberto(v);
        if (v && topo) {
          marcarVisto(userId, topo);
          setVisto(topo);
        }
      }}
    >
      <SheetTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="relative gap-1.5 px-2.5 text-text-dim hover:text-foreground"
          title="O que foi lançado no AcessoFast"
        >
          <Sparkles />
          <span className="hidden sm:inline">Novidades</span>
          <span className="sr-only sm:hidden">Novidades</span>
          {temNova && (
            <>
              <span
                className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary"
                aria-hidden
              />
              <span className="sr-only"> (há novidades que você ainda não viu)</span>
            </>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border-subtle p-6 pb-4 text-left">
          <SheetTitle>Novidades do AcessoFast</SheetTitle>
          <SheetDescription>Tudo o que foi lançado, no dia em que entrou no ar.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-6 pt-4">
          {porDia.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma novidade por enquanto.</p>
          ) : (
            <ol className="space-y-6">
              {porDia.map((g) => (
                <li key={g.data}>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-text-dim">
                    {dataPorExtenso(g.data)}
                  </h3>
                  <ul className="space-y-3">
                    {g.itens.map((n) => (
                      <li
                        key={chaveDe(n)}
                        className="space-y-1.5 rounded-md border border-border/60 p-3"
                      >
                        <div className="flex items-start gap-2">
                          <span
                            className={`mt-px shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${TIPO[n.tipo].classe}`}
                          >
                            {TIPO[n.tipo].rotulo}
                          </span>
                          <p className="text-sm font-medium leading-snug">{n.titulo}</p>
                        </div>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {n.descricao}
                        </p>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
