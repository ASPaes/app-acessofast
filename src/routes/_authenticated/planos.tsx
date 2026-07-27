import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/planos")({
  head: () => ({
    meta: [{ title: "Planos — Acessofast" }, { name: "robots", content: "noindex" }],
  }),
  component: PlanosPage,
});

type Plano = {
  code: string;
  name: string;
  max_users: number | null;
  max_concurrent_per_tech: number | null;
  is_active: boolean;
  is_custom: boolean;
  sort_order: number;
};

type Empresa = {
  id: string;
  name: string;
  plan_code: string | null;
  seat_limit: number;
  max_concurrent_per_tech: number | null;
  billing_mode: string;
  billing_status: string;
  is_active: boolean;
  profiles: { count: number }[] | null;
};

// Espelha o retorno da RPC assign_plan (schema vivo). over_limit = a empresa ja tem
// mais usuarios do que o limite de assentos que acabou de ser gravado.
type ResultadoAtribuicao = {
  plan_code: string;
  seat_limit: number;
  max_concurrent_per_tech: number | null;
  current_users: number;
  over_limit: boolean;
};

const SEM_LIMITE = "sem limite";

// Limite efetivo de simultaneas = override do tenant ?? o do plano; NULL nos dois = sem
// limite. Mesma precedencia do gate em create_access_grant (nao inventar outra aqui).
function limiteEfetivo(
  empresa: Empresa,
  plano: Plano | undefined,
): {
  valor: number | null;
  origem: "empresa" | "plano" | "nenhum";
} {
  if (empresa.max_concurrent_per_tech !== null) {
    return { valor: empresa.max_concurrent_per_tech, origem: "empresa" };
  }
  if (plano?.max_concurrent_per_tech != null) {
    return { valor: plano.max_concurrent_per_tech, origem: "plano" };
  }
  return { valor: null, origem: "nenhum" };
}

function PlanosPage() {
  const [emEdicao, setEmEdicao] = useState<Empresa | null>(null);

  const { data: me } = useQuery({
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

  const isSuper = me?.role === "super_admin";

  const { data: planos } = useQuery({
    queryKey: ["planos-catalogo"],
    enabled: !!isSuper,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plans")
        .select("code, name, max_users, max_concurrent_per_tech, is_active, is_custom, sort_order")
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as Plano[];
    },
  });

  const { data: empresas, isLoading } = useQuery({
    queryKey: ["planos-empresas"],
    enabled: !!isSuper,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select(
          "id, name, plan_code, seat_limit, max_concurrent_per_tech, billing_mode, billing_status, is_active, profiles(count)",
        )
        .order("name");
      if (error) throw error;
      return (data ?? []) as Empresa[];
    },
  });

  const planoPorCodigo = new Map((planos ?? []).map((p) => [p.code, p]));

  if (me && !isSuper) {
    return (
      <div className="p-6">
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-base">Planos</CardTitle>
            <CardDescription>Acesso restrito à equipe da plataforma.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Planos</h1>
        <p className="text-sm text-muted-foreground">
          Ajuste manual de plano, técnicos e sessões simultâneas por empresa.
        </p>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            Empresas e limites
          </CardTitle>
          <CardDescription>
            {empresas ? `${empresas.length} empresa(s)` : "Carregando…"} · Um valor definido na
            empresa sobrepõe o padrão do plano.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border/60 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Técnicos</TableHead>
                  <TableHead>Simultâneas por técnico</TableHead>
                  <TableHead>Cobrança</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading &&
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                {!isLoading && (empresas?.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                      Nenhuma empresa cadastrada ainda.
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  empresas?.map((e) => {
                    const plano = e.plan_code ? planoPorCodigo.get(e.plan_code) : undefined;
                    const usuarios = e.profiles?.[0]?.count ?? 0;
                    const conc = limiteEfetivo(e, plano);
                    return (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium">
                          {e.name}
                          {!e.is_active && (
                            <Badge variant="secondary" className="ml-2">
                              inativa
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {plano ? (
                            <span>{plano.name}</span>
                          ) : (
                            <span className="text-muted-foreground">
                              {e.plan_code ?? "sem plano"}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {usuarios} / {e.seat_limit}
                          {usuarios > e.seat_limit && (
                            <Badge variant="destructive" className="ml-2">
                              acima
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {conc.valor ?? SEM_LIMITE}
                          {conc.origem === "empresa" && (
                            <Badge variant="outline" className="ml-2">
                              override
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {e.billing_mode} · {e.billing_status}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => setEmEdicao(e)}>
                            Editar
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <EditarPlanoDialog
        empresa={emEdicao}
        planos={planos ?? []}
        onClose={() => setEmEdicao(null)}
      />
    </div>
  );
}

function EditarPlanoDialog({
  empresa,
  planos,
  onClose,
}: {
  empresa: Empresa | null;
  planos: Plano[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [codigo, setCodigo] = useState("");
  const [assentos, setAssentos] = useState("");
  const [simultaneas, setSimultaneas] = useState("");

  // Recarrega o formulario a cada empresa aberta. Campos numericos vazios = herdar do
  // plano (a RPC aplica o default quando o argumento nao vai no corpo).
  useEffect(() => {
    if (!empresa) return;
    setCodigo(empresa.plan_code ?? "");
    setAssentos(String(empresa.seat_limit));
    setSimultaneas(
      empresa.max_concurrent_per_tech === null ? "" : String(empresa.max_concurrent_per_tech),
    );
  }, [empresa]);

  const planoEscolhido = planos.find((p) => p.code === codigo);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!empresa) throw new Error("Nenhuma empresa selecionada");
      const seat = assentos.trim() === "" ? undefined : Number(assentos);
      const conc = simultaneas.trim() === "" ? undefined : Number(simultaneas);
      const { data, error } = await supabase.rpc("assign_plan", {
        p_tenant: empresa.id,
        p_code: codigo,
        p_seat_override: seat,
        p_conc_override: conc,
      });
      if (error) throw error;
      return (data ?? [])[0] as ResultadoAtribuicao | undefined;
    },
    onSuccess: (resultado) => {
      queryClient.invalidateQueries({ queryKey: ["planos-empresas"] });
      queryClient.invalidateQueries({ queryKey: ["tenants-empresas"] });
      if (resultado?.over_limit) {
        toast.warning(
          `Plano salvo, mas a empresa tem ${resultado.current_users} usuário(s) para ${resultado.seat_limit} assento(s).`,
        );
      } else {
        toast.success("Plano e limites atualizados.");
      }
      onClose();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Não foi possível salvar as alterações.");
    },
  });

  const submeter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!codigo) {
      toast.error("Escolha um plano.");
      return;
    }
    const campos: [string, string][] = [
      ["Técnicos", assentos],
      ["Simultâneas por técnico", simultaneas],
    ];
    for (const [rotulo, bruto] of campos) {
      if (bruto.trim() === "") continue;
      const n = Number(bruto);
      if (!Number.isInteger(n) || n < 1) {
        toast.error(`${rotulo}: informe um número inteiro maior ou igual a 1.`);
        return;
      }
    }
    mutation.mutate();
  };

  return (
    <Dialog open={empresa !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar plano — {empresa?.name}</DialogTitle>
          <DialogDescription>
            Deixe um campo numérico vazio para herdar o valor do plano.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submeter} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="plano-codigo">Plano</Label>
            <Select value={codigo} onValueChange={setCodigo}>
              <SelectTrigger id="plano-codigo">
                <SelectValue placeholder="Escolha um plano" />
              </SelectTrigger>
              <SelectContent>
                {planos.map((p) => (
                  <SelectItem key={p.code} value={p.code}>
                    {p.name}
                    {p.is_custom ? " · sob medida" : ""}
                    {p.is_active ? "" : " · inativo"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="plano-assentos">Técnicos (assentos)</Label>
            <Input
              id="plano-assentos"
              type="number"
              min={1}
              step={1}
              value={assentos}
              placeholder="herdar do plano"
              onChange={(ev) => setAssentos(ev.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Padrão do plano: {planoEscolhido?.max_users ?? SEM_LIMITE}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="plano-simultaneas">Sessões simultâneas por técnico</Label>
            <Input
              id="plano-simultaneas"
              type="number"
              min={1}
              step={1}
              value={simultaneas}
              placeholder="herdar do plano"
              onChange={(ev) => setSimultaneas(ev.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Padrão do plano: {planoEscolhido?.max_concurrent_per_tech ?? SEM_LIMITE} · super_admin
              não entra nessa conta.
            </p>
          </div>

          {planoEscolhido &&
            empresa &&
            planoEscolhido.max_users !== null &&
            (empresa.profiles?.[0]?.count ?? 0) > planoEscolhido.max_users &&
            assentos.trim() === "" && (
              <p className="flex items-start gap-2 text-xs text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />A empresa tem{" "}
                {empresa.profiles?.[0]?.count ?? 0} usuário(s) e este plano dá{" "}
                {planoEscolhido.max_users} assento(s). Informe um número em Técnicos para não
                reduzir.
              </p>
            )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
