import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, UserX } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Otto } from "@/components/otto/otto";

/**
 * Tela obrigatória do administrador quando a empresa tem mais usuários ativos do
 * que o plano permite. Acontece quando ela contrata um plano menor que a equipe,
 * o que vale desde 23/10/2026 por decisão do Ryan.
 *
 * Enquanto sobrar gente, o servidor recusa toda conexão da empresa
 * (private.usuarios_acima_do_plano). Esta tela é a saída: o administrador marca
 * quem continua, e o resto é bloqueado. Bloquear não apaga nada: o usuário volta
 * em Usuários quando houver vaga, e reativar sem vaga é recusado pelo banco.
 */
export function AjusteDeUsuarios({
  tenantId,
  meId,
  vagas,
}: {
  tenantId: string;
  meId: string;
  vagas: number;
}) {
  const queryClient = useQueryClient();
  // O próprio administrador fica: a RPC não deixa ninguém se bloquear.
  const [manter, setManter] = useState<Set<string>>(() => new Set([meId]));

  const { data: usuarios, isPending } = useQuery({
    queryKey: ["ajuste-usuarios", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, role")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .neq("role", "super_admin");
      if (error) throw error;
      // Administradores primeiro: costumam ser os que ficam.
      return (data ?? []).sort(
        (a, b) =>
          Number(b.role === "admin") - Number(a.role === "admin") ||
          (a.full_name || a.email || "").localeCompare(b.full_name || b.email || "", "pt-BR"),
      );
    },
  });

  const total = usuarios?.length ?? 0;
  const aBloquear = (usuarios ?? []).filter((u) => !manter.has(u.id));
  const cheio = manter.size >= vagas;

  const bloquear = useMutation({
    mutationFn: async (ids: string[]) => {
      // Mesma RPC da tela Usuários, que confere papel e empresa no servidor.
      for (const id of ids) {
        const { error } = await supabase.rpc("set_user_active", { p_user_id: id, p_active: false });
        if (error) throw error;
      }
    },
    onSuccess: (_data, ids) => {
      toast.success(
        ids.length === 1
          ? "1 usuário bloqueado. Os acessos da empresa estão liberados."
          : `${ids.length} usuários bloqueados. Os acessos da empresa estão liberados.`,
      );
    },
    onError: (err: Error) => {
      toast.error(`Não foi possível bloquear todos: ${err.message}`);
    },
    onSettled: () => {
      // Também no erro: parte pode ter sido bloqueada antes da falha.
      queryClient.invalidateQueries({ queryKey: ["active-users-count"] });
      queryClient.invalidateQueries({ queryKey: ["ajuste-usuarios"] });
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    },
  });

  function alternar(id: string, marcado: boolean) {
    setManter((atual) => {
      const novo = new Set(atual);
      if (marcado) novo.add(id);
      else novo.delete(id);
      return novo;
    });
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <Card>
        <CardHeader className="flex flex-row items-start gap-4 space-y-0">
          <Otto estado="aguardando" className="w-14 shrink-0" />
          <div className="space-y-1.5">
            <CardTitle className="text-lg">Escolha quem continua usando o AcessoFast</CardTitle>
            <CardDescription>
              {`O plano contratado permite ${vagas} ${vagas === 1 ? "usuário" : "usuários"} e a empresa tem ${total} ativos. Marque até ${vagas} para continuar: os outros serão bloqueados.`}
            </CardDescription>
            <p className="text-sm text-muted-foreground">
              Enquanto isso, os acessos remotos da empresa estão pausados. Ninguém é apagado: quem
              for bloqueado pode ser reativado em Usuários quando houver vaga.
            </p>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <p className="text-sm font-medium tabular-nums">
            {`${manter.size} de ${vagas} ${vagas === 1 ? "vaga usada" : "vagas usadas"}`}
          </p>

          {isPending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Carregando usuários…
            </div>
          ) : (
            <ul className="divide-y divide-border/60 rounded-md border border-border/60">
              {(usuarios ?? []).map((u) => {
                const souEu = u.id === meId;
                const marcado = manter.has(u.id);
                return (
                  <li key={u.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
                      <Checkbox
                        checked={marcado}
                        disabled={souEu || bloquear.isPending || (!marcado && cheio)}
                        onCheckedChange={(v) => alternar(u.id, v === true)}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{u.full_name || u.email}</p>
                        {u.full_name && (
                          <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                        )}
                      </div>
                      {souEu && <Badge variant="outline">Você</Badge>}
                      <Badge variant="secondary">
                        {u.role === "admin" ? "Administrador" : "Técnico"}
                      </Badge>
                      {!marcado && <span className="text-xs text-destructive">será bloqueado</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="destructive"
              disabled={isPending || bloquear.isPending || aBloquear.length === 0}
              onClick={() => bloquear.mutate(aBloquear.map((u) => u.id))}
            >
              {bloquear.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <UserX className="mr-2 h-4 w-4" aria-hidden />
              )}
              {aBloquear.length === 1
                ? "Bloquear 1 usuário e liberar os acessos"
                : `Bloquear ${aBloquear.length} usuários e liberar os acessos`}
            </Button>
            <p className="text-xs text-muted-foreground">
              Precisa de mais vagas? Depois de escolher, troque de plano no Financeiro e reative
              quem quiser em Usuários.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
