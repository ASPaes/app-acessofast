import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
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
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

/**
 * Atribuição de plano a uma empresa.
 *
 * Veio da antiga tela /planos, que listava as empresas só para dar acesso a
 * este formulário — a pergunta "qual plano esta empresa tem" nasce na linha da
 * empresa, não numa tela separada que repete a mesma lista.
 *
 * O que NÃO veio junto é o catálogo (preço e limites de cada plano): alterar um
 * plano afeta todas as empresas que o assinam, e essa ação não pode morar
 * dentro da linha de um cliente específico, onde parece local e não é.
 */

const SEM_LIMITE = "sem limite";

export type EmpresaPlano = {
  id: string;
  name: string;
  plan_code: string | null;
  seat_limit: number;
  max_concurrent_per_tech: number | null;
  /** usuários já cadastrados, para avisar quando o plano reduz assentos */
  usuarios: number;
};

type Plano = {
  code: string;
  name: string;
  max_users: number | null;
  max_concurrent_per_tech: number | null;
  is_active: boolean;
  is_custom: boolean;
};

type ResultadoAtribuicao = {
  over_limit: boolean;
  current_users: number;
  seat_limit: number;
};

export function PlanoEmpresaDialog({
  empresa,
  onClose,
}: {
  empresa: EmpresaPlano | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [codigo, setCodigo] = useState("");
  const [assentos, setAssentos] = useState("");
  const [simultaneas, setSimultaneas] = useState("");

  // O catálogo é lido só para preencher o select. Editar plano continua sendo
  // outra coisa, em outro lugar.
  const { data: planos } = useQuery({
    queryKey: ["planos-catalogo"],
    enabled: empresa !== null,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plans")
        .select("code, name, max_users, max_concurrent_per_tech, is_active, is_custom, sort_order")
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as Plano[];
    },
  });

  // Ao abrir, os campos mostram o que a empresa tem hoje — não o que o plano
  // dela diz. Os dois divergem sempre que alguém combinou uma exceção, e é
  // justamente a exceção que precisa estar à vista antes de mexer.
  useEffect(() => {
    if (!empresa) return;
    setCodigo(empresa.plan_code ?? "");
    setAssentos(String(empresa.seat_limit));
    setSimultaneas(
      empresa.max_concurrent_per_tech === null ? "" : String(empresa.max_concurrent_per_tech),
    );
  }, [empresa]);

  const planoEscolhido = (planos ?? []).find((p) => p.code === codigo);

  /**
   * Trocar de plano preenche os limites com os do plano novo.
   *
   * Antes os números do plano anterior ficavam parados no formulário, e salvar
   * um Business com "10 técnicos" herdados do Team passava sem ninguém notar:
   * o campo preenchido é um override, e override silencioso é o pior tipo. Quem
   * quer exceção continua digitando por cima — a diferença é que agora ela é uma
   * decisão, não um resto.
   */
  const escolherPlano = (code: string) => {
    setCodigo(code);
    const p = (planos ?? []).find((x) => x.code === code);
    if (!p) return;
    setAssentos(p.max_users === null ? "" : String(p.max_users));
    setSimultaneas(p.max_concurrent_per_tech === null ? "" : String(p.max_concurrent_per_tech));
  };

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
      queryClient.invalidateQueries({ queryKey: ["tenants-empresas"] });
      queryClient.invalidateQueries({ queryKey: ["planos-empresas"] });
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
    if (exigeAssentos) {
      toast.error("Plano sob medida: informe quantos técnicos foram combinados.");
      return;
    }
    mutation.mutate();
  };

  // Quantos assentos a empresa fica tendo de fato: o que está no campo, ou o
  // padrão do plano quando o campo ficou vazio.
  const assentosEfetivos =
    assentos.trim() === "" ? (planoEscolhido?.max_users ?? null) : Number(assentos);

  const reduzAssentos =
    empresa !== null &&
    assentosEfetivos !== null &&
    Number.isFinite(assentosEfetivos) &&
    empresa.usuarios > assentosEfetivos;

  // Plano sob medida não tem número de assentos para herdar: a RPC recusa com
  // seat_count_required, então o campo deixa de ser opcional.
  const exigeAssentos = planoEscolhido?.max_users === null && assentos.trim() === "";

  return (
    <Dialog open={empresa !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Plano — {empresa?.name}</DialogTitle>
          <DialogDescription>
            Escolher um plano preenche os limites dele. Digite por cima só para combinar uma exceção
            com esta empresa.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submeter} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="plano-codigo">Plano</Label>
            <Select value={codigo} onValueChange={escolherPlano}>
              <SelectTrigger id="plano-codigo">
                <SelectValue placeholder="Escolha um plano" />
              </SelectTrigger>
              <SelectContent>
                {(planos ?? []).map((p) => (
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
              placeholder={
                planoEscolhido?.max_users === null ? "combinado com o cliente" : "herdar do plano"
              }
              onChange={(ev) => setAssentos(ev.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {!planoEscolhido
                ? "Escolha um plano para preencher o padrão."
                : planoEscolhido.max_users === null
                  ? "Plano sob medida: informe quantos técnicos foram combinados."
                  : `Padrão do plano: ${planoEscolhido.max_users}`}
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
              {planoEscolhido
                ? `Padrão do plano: ${planoEscolhido.max_concurrent_per_tech ?? SEM_LIMITE}`
                : "Escolha um plano para preencher o padrão"}{" "}
              · super_admin não entra nessa conta.
            </p>
          </div>

          {reduzAssentos && (
            <p className="flex items-start gap-2 text-xs text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />A empresa tem {empresa?.usuarios}{" "}
              usuário(s) para {assentosEfetivos} assento(s). Aumente Técnicos se ninguém deve ficar
              de fora.
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
