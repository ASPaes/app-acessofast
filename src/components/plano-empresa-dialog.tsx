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
import type { SituacaoCobranca } from "@/lib/pagante";

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

/** Mesmo teto da RPC conceder_dias_gratis: acima disso é digitação errada. */
const MAX_DIAS_GRATIS = 90;

export type EmpresaPlano = {
  id: string;
  name: string;
  plan_code: string | null;
  seat_limit: number;
  max_concurrent_per_tech: number | null;
  /** usuários já cadastrados, para avisar quando o plano reduz assentos */
  usuarios: number;
  is_trial: boolean;
  plan_expires_at: string | null;
  situacao: SituacaoCobranca;
};

/**
 * Por que a conta não pode ganhar dias grátis — os mesmos casos que a RPC
 * recusa, para o campo já chegar desligado em vez de virar um erro no Salvar.
 * O Individual entra porque assign_plan grava esse plano como gratuito, e
 * conta gratuita não tem teste.
 */
function motivoSemDiasGratis(empresa: EmpresaPlano, codigo: string): string | null {
  if (empresa.situacao === "pagante") return "Conta pagante: dias grátis não se aplicam.";
  if (empresa.situacao === "isenta") return "Conta isenta: ela já não é cobrada nem bloqueada.";
  if (codigo === "individual") return "O plano Individual é gratuito e não tem teste.";
  return null;
}

function traduzirErroDias(msg: string): string {
  if (msg.includes("conta_com_assinatura")) return "a conta tem assinatura ativa no Asaas";
  if (msg.includes("periodo_pago_em_andamento")) return "a conta tem um período pago em andamento";
  if (msg.includes("conta_isenta")) return "a conta está isenta";
  if (msg.includes("conta_sem_plano_pago")) return "a conta não está em plano pago";
  if (msg.includes("dias_invalidos")) return `informe de 1 a ${MAX_DIAS_GRATIS} dias`;
  return msg;
}

const dataCurta = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

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
  const [diasGratis, setDiasGratis] = useState("");

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
    // Vazio de propósito, mesmo com teste em andamento: o campo é "conceder a
    // partir de hoje", e reabrir o diálogo só para trocar técnicos não pode
    // reiniciar a contagem de quem já está em teste.
    setDiasGratis("");
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
      const resultado = (data ?? [])[0] as ResultadoAtribuicao | undefined;

      // Os dias vêm depois do plano porque assign_plan decide se a conta fica
      // em plano pago (o Individual vira gratuito), e é isso que a RPC dos dias
      // confere. Se só esta parte falhar, o plano já foi salvo e o aviso diz
      // isso, em vez de um erro que faria pensar que nada mudou.
      const dias = semDiasGratis || diasGratis.trim() === "" ? null : Number(diasGratis);
      if (dias === null) return { resultado, fimTeste: null, erroDias: null };
      const r = await supabase.rpc("conceder_dias_gratis", {
        p_tenant: empresa.id,
        p_dias: dias,
      });
      return {
        resultado,
        fimTeste: r.error ? null : (r.data as string),
        erroDias: r.error ? traduzirErroDias(r.error.message) : null,
      };
    },
    onSuccess: ({ resultado, fimTeste, erroDias }) => {
      queryClient.invalidateQueries({ queryKey: ["tenants-empresas"] });
      queryClient.invalidateQueries({ queryKey: ["planos-empresas"] });
      queryClient.invalidateQueries({ queryKey: ["financeiro-plataforma-tenants"] });
      if (erroDias) {
        toast.error(`Plano salvo, mas os dias grátis não foram aplicados: ${erroDias}.`);
      } else if (resultado?.over_limit) {
        toast.warning(
          `Plano salvo, mas a empresa tem ${resultado.current_users} usuário(s) para ${resultado.seat_limit} assento(s).`,
        );
      } else if (fimTeste) {
        toast.success(`Plano salvo. Teste grátis até ${dataCurta(fimTeste)}.`);
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
      ["Acessos simultâneos por técnico", simultaneas],
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
    if (diasGratis.trim() !== "" && !semDiasGratis) {
      const n = Number(diasGratis);
      if (!Number.isInteger(n) || n < 1 || n > MAX_DIAS_GRATIS) {
        toast.error(`Dias grátis: informe um número inteiro de 1 a ${MAX_DIAS_GRATIS}.`);
        return;
      }
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

  const semDiasGratis = empresa ? motivoSemDiasGratis(empresa, codigo) : null;

  // Data em que o teste termina se salvar agora — a mesma conta da RPC
  // (agora + N dias), para o texto bater com o que a conta vai mostrar.
  const diasDigitados = Number(diasGratis);
  const fimPrevisto =
    diasGratis.trim() !== "" &&
    Number.isInteger(diasDigitados) &&
    diasDigitados >= 1 &&
    diasDigitados <= MAX_DIAS_GRATIS
      ? new Date(Date.now() + diasDigitados * 86_400_000).toISOString()
      : null;

  const testeAtual = empresa?.is_trial && empresa.plan_expires_at ? empresa.plan_expires_at : null;
  const testeAtualVigente = testeAtual !== null && new Date(testeAtual).getTime() > Date.now();

  let dicaDias: string;
  if (semDiasGratis) {
    dicaDias = semDiasGratis;
  } else if (fimPrevisto) {
    dicaDias = `Fica em teste grátis até ${dataCurta(fimPrevisto)}. Depois disso o acesso remoto é bloqueado até a conta assinar.`;
  } else if (testeAtual && testeAtualVigente) {
    dicaDias = `Em teste grátis até ${dataCurta(testeAtual)}. Deixe vazio para manter; preencher troca a data, contando de hoje.`;
  } else if (testeAtual) {
    dicaDias = `O teste terminou em ${dataCurta(testeAtual)}. Preencha para liberar mais dias.`;
  } else {
    dicaDias =
      "Vazio: a conta segue sem teste. Preencha para ela usar o plano de graça por alguns dias.";
  }

  return (
    <Dialog open={empresa !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Plano — {empresa?.name}</DialogTitle>
          <DialogDescription>
            Escolher um plano preenche os limites dele. Digite por cima só para combinar uma exceção
            com esta empresa. Dias grátis põem a conta em teste até a data indicada.
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
            <Label htmlFor="plano-simultaneas">Acessos simultâneos por técnico</Label>
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

          <div className="space-y-2">
            <Label htmlFor="plano-dias-gratis">Dias grátis (teste)</Label>
            <Input
              id="plano-dias-gratis"
              type="number"
              min={1}
              max={MAX_DIAS_GRATIS}
              step={1}
              value={semDiasGratis ? "" : diasGratis}
              disabled={!!semDiasGratis}
              placeholder="sem teste"
              onChange={(ev) => setDiasGratis(ev.target.value)}
            />
            <p className="text-xs text-muted-foreground">{dicaDias}</p>
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
