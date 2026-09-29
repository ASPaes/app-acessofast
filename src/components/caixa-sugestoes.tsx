import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lightbulb } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CATEGORIAS,
  CATEGORIA_CURTA,
  DESCRICAO_MAX,
  STATUS_CLASSE,
  STATUS_ROTULO,
  SUGESTOES_NOVAS_KEY,
  TITULO_MAX,
} from "@/lib/sugestoes";

// ---------------------------------------------------------------------------
// Caixa de sugestoes do cliente. Fica na barra do topo, e nao no menu lateral: e um
// canal com a ASP, nao uma area de trabalho — e precisa estar a um clique de quem
// teve a ideia no meio de um atendimento, em qualquer tela.
//
// Autor, empresa e status nao saem daqui: o gatilho da tabela decide (ver a migracao
// 20260929120000_caixa_de_sugestoes). A aba "Enviadas" e o retorno — sem ela, a
// caixa vira um buraco onde a sugestao some.
// ---------------------------------------------------------------------------

const MINHAS_KEY = ["sugestoes-minhas"] as const;

export function CaixaSugestoes() {
  const [aberta, setAberta] = useState(false);
  const [aba, setAba] = useState("nova");

  return (
    <Dialog
      open={aberta}
      onOpenChange={(v) => {
        setAberta(v);
        if (v) setAba("nova");
      }}
    >
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="gap-1.5 px-2.5 text-text-dim hover:text-foreground"
          title="Mande uma ideia para a equipe do AcessoFast"
        >
          <Lightbulb />
          <span className="hidden sm:inline">Sugestão</span>
          <span className="sr-only sm:hidden">Sugestão</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Caixa de sugestões</DialogTitle>
          <DialogDescription>
            O que faria o AcessoFast funcionar melhor para você? A equipe lê todas as sugestões e
            responde por aqui.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={aba} onValueChange={setAba}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="nova">Nova sugestão</TabsTrigger>
            <TabsTrigger value="enviadas">Enviadas</TabsTrigger>
          </TabsList>
          <TabsContent value="nova" className="mt-4">
            <FormSugestao onEnviada={() => setAba("enviadas")} />
          </TabsContent>
          <TabsContent value="enviadas" className="mt-4">
            <MinhasSugestoes ativa={aberta && aba === "enviadas"} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function FormSugestao({ onEnviada }: { onEnviada: () => void }) {
  const queryClient = useQueryClient();
  const [categoria, setCategoria] = useState<string>("melhoria");
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");

  const tituloOk = titulo.trim().length >= 3;
  const descricaoOk = descricao.trim().length >= 10;

  const enviar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("sugestoes")
        .insert({ categoria, titulo: titulo.trim(), descricao: descricao.trim() });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Sugestão enviada. Obrigado!");
      setTitulo("");
      setDescricao("");
      setCategoria("melhoria");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MINHAS_KEY }),
        queryClient.invalidateQueries({ queryKey: SUGESTOES_NOVAS_KEY }),
      ]);
      onEnviada();
    },
    onError: (e: unknown) => {
      toast.error((e as { message?: string })?.message ?? "Não foi possível enviar a sugestão");
    },
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (tituloOk && descricaoOk && !enviar.isPending) enviar.mutate();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="sugestao-categoria">Sobre o quê?</Label>
        <Select value={categoria} onValueChange={setCategoria}>
          <SelectTrigger id="sugestao-categoria">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIAS.map((c) => (
              <SelectItem key={c.valor} value={c.valor}>
                {c.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="sugestao-titulo">Resumo</Label>
        <Input
          id="sugestao-titulo"
          value={titulo}
          maxLength={TITULO_MAX}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Ex.: Poder agrupar os dispositivos por loja"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="sugestao-descricao">Conte mais</Label>
        <Textarea
          id="sugestao-descricao"
          value={descricao}
          maxLength={DESCRICAO_MAX}
          rows={6}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder="Como isso ajudaria no seu dia a dia? Se possível, conte a situação em que sentiu falta."
        />
        <p className="text-right text-xs text-muted-foreground">
          {descricao.length}/{DESCRICAO_MAX}
        </p>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={!tituloOk || !descricaoOk || enviar.isPending}>
          {enviar.isPending ? "Enviando..." : "Enviar sugestão"}
        </Button>
      </div>
    </form>
  );
}

function MinhasSugestoes({ ativa }: { ativa: boolean }) {
  // A RLS entrega so as que a propria pessoa mandou.
  const { data, isPending, isError } = useQuery({
    queryKey: MINHAS_KEY,
    enabled: ativa,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sugestoes")
        .select("id, categoria, titulo, descricao, status, resposta, respondida_em, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  if (isPending)
    return <p className="py-6 text-center text-sm text-muted-foreground">Carregando...</p>;
  if (isError)
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Não foi possível carregar suas sugestões. Tente de novo em instantes.
      </p>
    );
  if (!data.length)
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Você ainda não mandou nenhuma sugestão.
      </p>
    );

  return (
    <ul className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
      {data.map((s) => (
        <li key={s.id} className="space-y-2 rounded-md border border-border/60 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium leading-snug">{s.titulo}</p>
              <p className="text-xs text-muted-foreground">
                {CATEGORIA_CURTA[s.categoria] ?? s.categoria} ·{" "}
                {new Date(s.created_at).toLocaleDateString("pt-BR")}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASSE[s.status] ?? ""}`}
            >
              {STATUS_ROTULO[s.status] ?? s.status}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-xs text-muted-foreground">{s.descricao}</p>
          {s.resposta && (
            <div className="rounded-md bg-muted/50 p-2.5 text-xs">
              <p className="mb-1 font-medium text-foreground">
                Resposta da equipe AcessoFast
                {s.respondida_em && ` · ${new Date(s.respondida_em).toLocaleDateString("pt-BR")}`}
              </p>
              <p className="whitespace-pre-wrap text-muted-foreground">{s.resposta}</p>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
