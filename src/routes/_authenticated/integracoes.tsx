import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { KeyRound, Plus, Copy, Check, Ban, Plug } from "lucide-react";

// ---------------------------------------------------------------------------
// Integracoes — chaves que o AcessoFast EMITE para um parceiro nos chamar.
//
// A chave e sorteada AQUI, no navegador de quem clica. O servidor recebe so o
// SHA-256 e o prefixo: nem o banco nem o log jamais veem o texto. Por isso ela
// aparece uma vez e nunca mais — perdeu, revoga e emite outra.
//
// A chave tambem e o vinculo entre os dois lados: emitida por tenant, ela e o
// unico jeito de o parceiro dizer de qual empresa ele esta falando. Isso e o que
// dispensa qualquer identificador de empresa viajando nas chamadas dele.
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_authenticated/integracoes")({
  head: () => ({
    meta: [{ title: "Integrações — Acessofast" }, { name: "robots", content: "noindex" }],
  }),
  component: IntegracoesPage,
});

type ChaveRow = {
  id: string;
  nome: string | null;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

const PREFIXO = "af_ds_";

function gerarChave(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // base64url: cabe em header, em .env e em campo de formulario sem escapar.
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return PREFIXO + b64;
}

async function sha256Hex(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function dataCurta(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function IntegracoesPage() {
  const queryClient = useQueryClient();
  const [abrindo, setAbrindo] = useState(false);
  const [nome, setNome] = useState("");
  const [recemGerada, setRecemGerada] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [revogando, setRevogando] = useState<ChaveRow | null>(null);

  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("id, role, tenant_id")
        .eq("id", u.user.id)
        .maybeSingle();
      return data;
    },
  });

  const podeEmitir = me.data?.role === "admin" || me.data?.role === "super_admin";

  const chaves = useQuery({
    enabled: podeEmitir,
    queryKey: ["integration_keys"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_keys")
        .select("id, nome, key_prefix, created_at, last_used_at, revoked_at")
        .eq("provider", "doctorsaas")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ChaveRow[];
    },
  });

  // Linha ausente vale o padrao: nao reativa. Por isso `?? false` em vez de
  // esperar a tabela ter uma linha por empresa.
  const config = useQuery({
    enabled: podeEmitir,
    queryKey: ["integration_settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_settings")
        .select("reactivate_on_sync")
        .eq("provider", "doctorsaas")
        .maybeSingle();
      if (error) throw error;
      return data?.reactivate_on_sync ?? false;
    },
  });

  const salvarConfig = useMutation({
    mutationFn: async (valor: boolean) => {
      const tenantId = me.data?.tenant_id;
      if (!tenantId) throw new Error("Sua conta não está vinculada a uma empresa.");
      const { error } = await supabase.from("integration_settings").upsert(
        {
          tenant_id: tenantId,
          provider: "doctorsaas",
          reactivate_on_sync: valor,
          updated_at: new Date().toISOString(),
          updated_by: me.data?.id ?? null,
        },
        { onConflict: "tenant_id,provider" },
      );
      if (error) throw error;
      return valor;
    },
    onSuccess: async (valor) => {
      toast.success(
        valor
          ? "A sincronização passa a reativar clientes que voltarem na lista do DoctorSaaS."
          : "Cliente desativado aqui continua desativado, mesmo que volte na lista do DoctorSaaS.",
      );
      await queryClient.invalidateQueries({ queryKey: ["integration_settings"] });
    },
    onError: (e: unknown) => {
      toast.error((e as { message?: string })?.message ?? "Falha ao salvar");
    },
  });

  const emitir = useMutation({
    mutationFn: async () => {
      const tenantId = me.data?.tenant_id;
      if (!tenantId) throw new Error("Sua conta não está vinculada a uma empresa.");
      const chave = gerarChave();
      const { error } = await supabase.from("integration_keys").insert({
        tenant_id: tenantId,
        provider: "doctorsaas",
        nome: nome.trim() || null,
        key_prefix: chave.slice(0, 14),
        key_hash: await sha256Hex(chave),
      });
      if (error) throw error;
      return chave;
    },
    onSuccess: async (chave) => {
      setAbrindo(false);
      setNome("");
      setCopiado(false);
      setRecemGerada(chave);
      await queryClient.invalidateQueries({ queryKey: ["integration_keys"] });
    },
    onError: (e: unknown) => {
      toast.error((e as { message?: string })?.message ?? "Falha ao gerar a chave");
    },
  });

  const revogar = useMutation({
    mutationFn: async (chave: ChaveRow) => {
      const { error } = await supabase
        .from("integration_keys")
        .update({ revoked_at: new Date().toISOString(), revoked_by: me.data?.id ?? null })
        .eq("id", chave.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      setRevogando(null);
      toast.success("Chave revogada. As chamadas com ela param agora.");
      await queryClient.invalidateQueries({ queryKey: ["integration_keys"] });
    },
    onError: (e: unknown) => {
      toast.error((e as { message?: string })?.message ?? "Falha ao revogar");
    },
  });

  async function copiar() {
    if (!recemGerada) return;
    try {
      await navigator.clipboard.writeText(recemGerada);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error("Não foi possível copiar — selecione e copie à mão.");
    }
  }

  if (!me.isPending && !podeEmitir) {
    return (
      <div className="space-y-6 p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Integrações</h1>
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Emitir chave de integração é decisão de administração da conta. Fale com o administrador
            do AcessoFast da sua empresa.
          </CardContent>
        </Card>
      </div>
    );
  }

  const ativas = (chaves.data ?? []).filter((c) => !c.revoked_at);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Integrações</h1>
          <p className="text-sm text-muted-foreground">
            Chaves que outros sistemas usam para falar com o AcessoFast em nome desta empresa.
          </p>
        </div>
        <Button type="button" onClick={() => setAbrindo(true)}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden />
          Gerar chave
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plug className="h-4 w-4" aria-hidden />
            DoctorSaaS
          </CardTitle>
          <CardDescription>
            Cole a chave no DoctorSaaS, na configuração da integração. Com ela, o atendimento
            identifica sozinho de qual cliente é cada conversa — e a janelinha do Conectar abre
            direto nas máquinas certas, sem perguntar nada ao técnico.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Status:</span>
            {chaves.isPending ? (
              <Skeleton className="h-5 w-24" />
            ) : ativas.length > 0 ? (
              <Badge variant="default">
                {ativas.some((c) => c.last_used_at) ? "Conectado" : "Chave gerada, sem uso ainda"}
              </Badge>
            ) : (
              <Badge variant="secondary">Não conectado</Badge>
            )}
          </div>

          {chaves.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (chaves.data ?? []).length === 0 ? (
            <p className="rounded-md border border-border/60 bg-muted/40 p-3 text-sm text-muted-foreground">
              Nenhuma chave ainda. Gere uma e cole no DoctorSaaS.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Chave</TableHead>
                  <TableHead>Criada</TableHead>
                  <TableHead>Último uso</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(chaves.data ?? []).map((c) => (
                  <TableRow key={c.id} className={c.revoked_at ? "opacity-60" : undefined}>
                    <TableCell>
                      <div className="font-mono text-xs">{c.key_prefix}…</div>
                      {c.nome && <div className="text-xs text-muted-foreground">{c.nome}</div>}
                      {c.revoked_at && (
                        <Badge variant="outline" className="mt-1">
                          Revogada em {dataCurta(c.revoked_at)}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {dataCurta(c.created_at)}
                    </TableCell>
                    {/* O melhor sinal de que a integracao esta viva: sem isto, uma
                        chave que parou de funcionar parece igual a uma que funciona. */}
                    <TableCell className="text-xs text-muted-foreground">
                      {dataCurta(c.last_used_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      {!c.revoked_at && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setRevogando(c)}
                        >
                          <Ban className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                          Revogar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Quem manda no cadastro. So faz diferenca depois que a importacao em
          lote roda, mas o lugar de decidir e antes dela. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Importação de clientes</CardTitle>
          <CardDescription>
            Quando o DoctorSaaS manda a carteira, criamos o que falta e corrigimos o nome de quem já
            existe — o nome de lá é o que vale. O casamento é sempre por CNPJ.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start justify-between gap-4 rounded-md border border-border/60 p-3">
            <div className="space-y-1">
              <Label htmlFor="reativar" className="text-sm font-medium">
                Reativar cliente que voltar na lista
              </Label>
              <p className="text-xs text-muted-foreground">
                {config.data
                  ? "Ligado: a lista do DoctorSaaS manda. Cliente desativado aqui volta a ficar ativo se reaparecer lá."
                  : "Desligado: o AcessoFast manda. Quem foi desativado aqui continua desativado, e a importação apenas avisa que ele veio na lista."}
              </p>
            </div>
            <Switch
              id="reativar"
              checked={config.data ?? false}
              disabled={config.isPending || salvarConfig.isPending}
              onCheckedChange={(v) => salvarConfig.mutate(v)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Gerar */}
      <Dialog open={abrindo} onOpenChange={(v) => !v && setAbrindo(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerar chave de integração</DialogTitle>
            <DialogDescription>
              A chave aparece uma única vez, agora. Ela não fica guardada em lugar nenhum — se
              perder, revogue esta e gere outra.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="chave-nome">Identificação (opcional)</Label>
            <Input
              id="chave-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: workspace do DoctorSaaS"
            />
            <p className="text-xs text-muted-foreground">
              Só para você reconhecer a linha depois, quando houver mais de uma.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAbrindo(false)}>
              Cancelar
            </Button>
            <Button type="button" disabled={emitir.isPending} onClick={() => emitir.mutate()}>
              <KeyRound className="mr-1.5 h-4 w-4" aria-hidden />
              Gerar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mostrada uma vez */}
      <Dialog open={recemGerada !== null} onOpenChange={(v) => !v && setRecemGerada(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copie agora</DialogTitle>
            <DialogDescription>
              Esta é a única vez que a chave aparece. Guardamos só um resumo dela para reconhecer a
              linha — não temos como mostrar de novo.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={recemGerada ?? ""} className="font-mono text-xs" />
            <Button type="button" variant="outline" size="sm" onClick={() => void copiar()}>
              {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              <span className="ml-1">{copiado ? "Copiado" : "Copiar"}</span>
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setRecemGerada(null)}>
              Já guardei
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revogar */}
      <AlertDialog open={revogando !== null} onOpenChange={(v) => !v && setRevogando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar esta chave?</AlertDialogTitle>
            <AlertDialogDescription>
              As chamadas feitas com ela param imediatamente. Se o DoctorSaaS ainda estiver usando
              esta chave, a identificação automática do cliente para de funcionar e o técnico volta
              a escolher à mão. A linha continua na lista, como registro.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revogando && revogar.mutate(revogando)}
              disabled={revogar.isPending}
            >
              Revogar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
