import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import acessofastLogo from "@/assets/acessofast-logo.png.asset.json";

// ---------------------------------------------------------------------------
// Pagina do revendedor, sem login: quem tem o link (com a chave dele) ve quantas
// vendas fez. So a quantidade, por decisao do Ryan (26/10/2026): nada de empresa,
// valor ou clique. O link sai da tela Indicacoes do painel.
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/revendedor/$chave")({
  head: () => ({
    meta: [{ title: "Suas indicações — AcessoFast" }, { name: "robots", content: "noindex" }],
  }),
  component: PaginaDoRevendedor,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Painel = {
  nome: string;
  codigo: string;
  vendas_total: number;
  vendas_mes: number;
  meses: { mes: string; vendas: number }[];
};

function nomeDoMes(competencia: string) {
  const s = new Date(`${competencia}T12:00:00`).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function PaginaDoRevendedor() {
  const { chave } = Route.useParams();
  const [copiado, setCopiado] = useState(false);

  const painel = useQuery({
    queryKey: ["revendedor-painel", chave],
    queryFn: async () => {
      if (!UUID_RE.test(chave)) return null;
      const { data, error } = await supabase.rpc("revendedor_painel", { p_chave: chave });
      if (error) throw error;
      return ((Array.isArray(data) ? data[0] : data) ?? null) as Painel | null;
    },
  });

  const p = painel.data;
  const link = p ? `https://acessofast.com.br/r/${p.codigo}` : "";

  return (
    <div className="flex min-h-screen items-start justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center gap-2.5">
          <img src={acessofastLogo.url} alt="" className="h-9 w-9 object-contain" />
          <span className="text-lg font-semibold tracking-tight">AcessoFast</span>
        </div>

        {painel.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : painel.isError ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Não foi possível carregar agora. Tente de novo em instantes.
            </CardContent>
          </Card>
        ) : !p ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Link inválido. Confira com a equipe do AcessoFast o endereço da sua página.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="space-y-6 p-6">
              <div>
                <p className="text-sm text-muted-foreground">Olá,</p>
                <h1 className="text-2xl font-semibold tracking-tight">{p.nome}</h1>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-border/60 p-4">
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">
                    Neste mês
                  </p>
                  <p className="mt-1 text-3xl font-semibold tabular-nums">{p.vendas_mes}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.vendas_mes === 1 ? "venda" : "vendas"}
                  </p>
                </div>
                <div className="rounded-lg border border-border/60 p-4">
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">
                    No total
                  </p>
                  <p className="mt-1 text-3xl font-semibold tabular-nums">{p.vendas_total}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.vendas_total === 1 ? "venda" : "vendas"}
                  </p>
                </div>
              </div>

              {p.meses.length > 0 && (
                <div className="divide-y divide-border/60 rounded-md border border-border/60">
                  {p.meses.map((m) => (
                    <div
                      key={m.mes}
                      className="flex items-center justify-between px-3 py-2 text-sm"
                    >
                      <span>{nomeDoMes(m.mes)}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {m.vendas} {m.vendas === 1 ? "venda" : "vendas"}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-1.5">
                <p className="text-sm font-medium">Seu link de indicação</p>
                <div className="flex items-center gap-2 rounded-md border border-border/60 p-2 pl-3">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{link}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0"
                    aria-label="Copiar link"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(link);
                        setCopiado(true);
                        setTimeout(() => setCopiado(false), 1500);
                      } catch {
                        // Sem permissão de área de transferência: o link está à vista para copiar.
                      }
                    }}
                  >
                    {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  A venda conta quando a empresa que abriu o seu link paga o primeiro plano.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
