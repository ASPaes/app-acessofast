import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/hooks/use-me";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CATEGORIA_CURTA,
  DESCRICAO_MAX,
  STATUS,
  STATUS_CLASSE,
  STATUS_ROTULO,
  SUGESTOES_NOVAS_KEY,
} from "@/lib/sugestoes";

// ---------------------------------------------------------------------------
// Triagem da caixa de sugestoes. E da plataforma: so a ASP le o que todas as
// empresas mandaram, muda o status e responde. A resposta aparece para quem mandou,
// na propria caixa dele.
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_authenticated/sugestoes")({
  head: () => ({
    meta: [{ title: "Sugestões — Acessofast" }, { name: "robots", content: "noindex" }],
  }),
  component: SugestoesPage,
});

const LISTA_KEY = ["sugestoes-triagem"] as const;

// "abertas" e o filtro padrao: o que ainda pede decisao. Feita e descartada saem
// da frente, mas continuam a um clique.
const FILTROS = [
  { valor: "abertas", rotulo: "Em aberto" },
  { valor: "todas", rotulo: "Todas" },
  ...STATUS,
] as const;

type Sugestao = {
  id: string;
  categoria: string;
  titulo: string;
  descricao: string;
  status: string;
  resposta: string | null;
  respondida_em: string | null;
  created_at: string;
  autor: { full_name: string | null; email: string | null } | null;
  empresa: { name: string } | null;
};

function SugestoesPage() {
  const { data: me, isPending: mePending } = useMe();
  const isSuper = me?.role === "super_admin";
  const [filtro, setFiltro] = useState<string>("abertas");

  const lista = useQuery({
    queryKey: LISTA_KEY,
    enabled: isSuper,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sugestoes")
        .select(
          "id, categoria, titulo, descricao, status, resposta, respondida_em, created_at, autor:profiles!sugestoes_autor_id_fkey(full_name, email), empresa:tenants(name)",
        )
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as Sugestao[];
    },
  });

  if (!mePending && !isSuper) {
    return (
      <div className="space-y-6 p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Sugestões</h1>
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Esta tela é da equipe do AcessoFast. Para mandar uma sugestão, use o botão Sugestão no
            topo do painel.
          </CardContent>
        </Card>
      </div>
    );
  }

  const todas = lista.data ?? [];
  const contagem = (s: string) => todas.filter((x) => x.status === s).length;
  const visiveis = todas.filter((s) =>
    filtro === "todas"
      ? true
      : filtro === "abertas"
        ? s.status !== "feita" && s.status !== "descartada"
        : s.status === filtro,
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sugestões</h1>
          <p className="text-sm text-muted-foreground">
            O que os clientes mandaram pela caixa de sugestões do painel.
            {lista.data && ` ${contagem("nova")} nova(s), ${contagem("em_analise")} em análise.`}
          </p>
        </div>
        <Select value={filtro} onValueChange={setFiltro}>
          <SelectTrigger className="w-48" aria-label="Filtrar por status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTROS.map((f) => (
              <SelectItem key={f.valor} value={f.valor}>
                {f.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {lista.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : lista.isError ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Não foi possível carregar as sugestões. Tente de novo em instantes.
          </CardContent>
        </Card>
      ) : !visiveis.length ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            {todas.length ? "Nenhuma sugestão neste filtro." : "Nenhuma sugestão recebida ainda."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visiveis.map((s) => (
            // key com o que foi gravado: depois de salvar, o formulario recomeca do que ficou gravado.
            <SugestaoCard key={`${s.id}:${s.status}:${s.resposta ?? ""}`} sugestao={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function SugestaoCard({ sugestao: s }: { sugestao: Sugestao }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState(s.status);
  const [resposta, setResposta] = useState(s.resposta ?? "");
  const alterado = status !== s.status || resposta.trim() !== (s.resposta ?? "");

  const salvar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("sugestoes")
        .update({ status, resposta: resposta.trim() || null })
        .eq("id", s.id)
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Sem permissão para alterar esta sugestão.");
    },
    onSuccess: async () => {
      toast.success("Sugestão atualizada.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: LISTA_KEY }),
        queryClient.invalidateQueries({ queryKey: SUGESTOES_NOVAS_KEY }),
      ]);
    },
    onError: (e: unknown) => {
      toast.error((e as { message?: string })?.message ?? "Falha ao salvar");
    },
  });

  const autor = s.autor?.full_name || s.autor?.email || "Usuário removido";

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium leading-snug">{s.titulo}</p>
            <p className="text-xs text-muted-foreground">
              {CATEGORIA_CURTA[s.categoria] ?? s.categoria} · {s.empresa?.name ?? "—"} · {autor}
              {s.autor?.email && s.autor.full_name ? ` (${s.autor.email})` : ""} ·{" "}
              {new Date(s.created_at).toLocaleString("pt-BR", {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASSE[s.status] ?? ""}`}
          >
            {STATUS_ROTULO[s.status] ?? s.status}
          </span>
        </div>
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{s.descricao}</p>

        <div className="grid gap-3 border-t border-border/60 pt-3 sm:grid-cols-[12rem_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor={`status-${s.id}`} className="text-xs">
              Status
            </Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id={`status-${s.id}`} className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS.map((st) => (
                  <SelectItem key={st.valor} value={st.valor}>
                    {st.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`resposta-${s.id}`} className="text-xs">
              Resposta para o cliente{" "}
              <span className="font-normal text-muted-foreground">(ele vê na caixa dele)</span>
            </Label>
            <Textarea
              id={`resposta-${s.id}`}
              value={resposta}
              maxLength={DESCRICAO_MAX}
              rows={2}
              onChange={(e) => setResposta(e.target.value)}
              placeholder="Opcional"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          {s.respondida_em && (
            <span className="mr-auto text-xs text-muted-foreground">
              Respondida em {new Date(s.respondida_em).toLocaleDateString("pt-BR")}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={!alterado || salvar.isPending}
            onClick={() => {
              setStatus(s.status);
              setResposta(s.resposta ?? "");
            }}
          >
            Descartar
          </Button>
          <Button
            size="sm"
            disabled={!alterado || salvar.isPending}
            onClick={() => salvar.mutate()}
          >
            {salvar.isPending ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
