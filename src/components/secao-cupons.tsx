import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, Copy, Info, TicketPercent, Users } from "lucide-react";
import { toast } from "sonner";
import { AplicarCupomDialog } from "@/components/aplicar-cupom-dialog";
import { mensagemDoMotivo } from "@/lib/cupom-motivos";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";



// Espelha public.promo_codes. Nao confundir com a tabela `vouchers`, que e outra
// coisa (cortesia 1/CNPJ pos-venda). Aqui e o codigo aberto que o visitante digita
// no site ao contratar.
type Cupom = {
  id: string;
  code: string;
  description: string | null;
  extra_trial_days: number;
  discount_percent: number | null;
  discount_months: number | null;
  plan_codes: string[] | null;
  max_redemptions: number | null;
  redemptions_count: number;
  valid_from: string;
  valid_until: string | null;
  is_active: boolean;
  created_at: string;
};

type Resgate = {
  id: string;
  code: string;
  admin_email: string | null;
  tenant_id: string | null;
  redeemed_at: string;
  applied_extra_trial_days: number;
  applied_discount_percent: number | null;
  applied_discount_months: number | null;
  source: string;
  consumed_at: string | null;
  tenants: { name: string } | null;
};

type Plano = { code: string; name: string };

// Os mesmos limites dos CHECKs da tabela. Validar aqui e so para o comercial ver o
// erro no campo em vez de um 23514 cru vindo do banco.
const CODIGO_REGEX = /^[A-Z0-9._-]{3,32}$/;
const MAX_DIAS_TESTE = 365;

// Fora do formato de codigo aceito pelo banco, entao nunca colide com um id real.
const NENHUMA_EMPRESA = "__nenhuma__";

// Estado derivado, na mesma ordem em que o backend recusa o resgate. Serve para o
// comercial entender por que um codigo parou de funcionar sem abrir o suporte.
type Situacao = "inativo" | "agendado" | "expirado" | "esgotado" | "ativo";

function situacaoDe(c: Cupom, agora: number): Situacao {
  if (!c.is_active) return "inativo";
  if (new Date(c.valid_from).getTime() > agora) return "agendado";
  if (c.valid_until && new Date(c.valid_until).getTime() <= agora) return "expirado";
  if (c.max_redemptions !== null && c.redemptions_count >= c.max_redemptions) return "esgotado";
  return "ativo";
}

const ROTULO_SITUACAO: Record<
  Situacao,
  { texto: string; variante: "default" | "secondary" | "destructive" | "outline" }
> = {
  ativo: { texto: "ativo", variante: "default" },
  inativo: { texto: "inativo", variante: "secondary" },
  agendado: { texto: "agendado", variante: "outline" },
  expirado: { texto: "expirado", variante: "destructive" },
  esgotado: { texto: "esgotado", variante: "destructive" },
};

function formatarData(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR");
}

// O 42501 vem do guard de super_admin dentro das RPCs; os 235xx sao os CHECKs e o
// unique de `code`. Sem esse mapa o comercial le "new row violates check constraint".
function mensagemDeErro(err: unknown, padrao: string) {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code === "42501") return "Somente a equipe da plataforma pode gerenciar cupons.";
  if (e?.code === "23505") return "Já existe um cupom com esse código.";
  if (e?.code === "23514")
    return "O banco recusou os valores informados. Revise código e benefícios.";
  return e?.message || padrao;
}

/**
 * Cupons, antes uma tela própria em /cupons.
 *
 * Virou seção do Financeiro porque a decisão que ela apoia é a mesma: cupom,
 * plano e pacote de crédito são todos alavancas de receita, e escolher entre
 * "dar 30 dias de teste" e "dar 20% por três meses" exige olhar o que já está
 * entrando. Em telas separadas, essa comparação não acontecia.
 *
 * Não faz mais a própria verificação de papel: quem monta a seção já é a visão
 * de super_admin do Financeiro. Verificar duas vezes daria a impressão de que
 * este componente é seguro sozinho — a proteção real é o RLS de promo_codes.
 */
export function SecaoCupons() {
  const [criando, setCriando] = useState(false);
  const [verResgatesDe, setVerResgatesDe] = useState<Cupom | null>(null);
  const [aplicarEm, setAplicarEm] = useState<Cupom | null>(null);

  const { data: cupons, isLoading } = useQuery({
    queryKey: ["cupons"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("promo_codes")
        .select(
          "id, code, description, extra_trial_days, discount_percent, discount_months, plan_codes, max_redemptions, redemptions_count, valid_from, valid_until, is_active, created_at",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Cupom[];
    },
  });

  const { data: planos } = useQuery({
    queryKey: ["planos-catalogo"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plans")
        .select("code, name")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as Plano[];
    },
  });

  const agora = Date.now();
  const nomePorPlano = new Map((planos ?? []).map((p) => [p.code, p.name]));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Códigos abertos que o visitante digita no site ao contratar: dias extras de teste e/ou
          desconto percentual.
        </p>
        <Button onClick={() => setCriando(true)}>Novo cupom</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TicketPercent className="h-4 w-4 text-primary" />
            Cupons de parceiro
          </CardTitle>
          <CardDescription>
            {cupons ? `${cupons.length} cupom(ns)` : "Carregando…"} · Cupom não se edita: para mudar
            um benefício, desative e crie outro.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border/60 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Benefício</TableHead>
                  <TableHead>Planos</TableHead>
                  <TableHead>Resgates</TableHead>
                  <TableHead>Validade</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Ativo</TableHead>
                  <TableHead className="w-px" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading &&
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                {!isLoading && (cupons?.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                      Nenhum cupom criado ainda.
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  cupons?.map((c) => {
                    const situacao = situacaoDe(c, agora);
                    const rotulo = ROTULO_SITUACAO[situacao];
                    return (
                      <TableRow key={c.id}>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-medium">{c.code}</span>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              title="Copiar código"
                              onClick={() => {
                                navigator.clipboard
                                  .writeText(c.code)
                                  .then(() => toast.success("Código copiado."))
                                  .catch(() => toast.error("Não foi possível copiar."));
                              }}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                          {c.description && (
                            <div className="text-xs text-muted-foreground">{c.description}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Beneficios cupom={c} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {c.plan_codes === null
                            ? "qualquer plano"
                            : c.plan_codes.map((code) => nomePorPlano.get(code) ?? code).join(", ")}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          <Button
                            variant="link"
                            className="h-auto p-0 tabular-nums"
                            onClick={() => setVerResgatesDe(c)}
                          >
                            {c.redemptions_count}
                            {c.max_redemptions === null ? "" : ` / ${c.max_redemptions}`}
                          </Button>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {c.valid_until ? `até ${formatarData(c.valid_until)}` : "sem prazo"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={rotulo.variante}>{rotulo.texto}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <ChaveAtivo cupom={c} situacao={situacao} />
                        </TableCell>
                        <TableCell className="pl-0">
                          {/* O comercial fecha por telefone e aplica o código na
                              conta do cliente sem depender de o cliente digitar. */}
                          <Button
                            size="sm"
                            variant="outline"
                            className="whitespace-nowrap"
                            disabled={situacao !== "ativo"}
                            title={
                              situacao === "ativo"
                                ? "Aplicar este cupom em uma empresa"
                                : `Cupom ${situacao}: não dá para aplicar.`
                            }
                            onClick={() => setAplicarEm(c)}
                          >
                            <Building2 className="mr-2 h-3.5 w-3.5" />
                            Aplicar a uma empresa
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

      <NovoCupomDialog aberto={criando} planos={planos ?? []} onClose={() => setCriando(false)} />
      <ResgatesDialog cupom={verResgatesDe} onClose={() => setVerResgatesDe(null)} />
      <AplicarCupomDialog
        open={aplicarEm !== null}
        onOpenChange={(v) => !v && setAplicarEm(null)}
        codigoFixo={aplicarEm?.code}
      />
    </div>
  );
}

function Beneficios({ cupom }: { cupom: Cupom }) {
  return (
    <div className="flex flex-wrap gap-1">
      {cupom.extra_trial_days > 0 && (
        <Badge variant="outline" className="font-normal">
          +{cupom.extra_trial_days} dias de teste
        </Badge>
      )}
      {cupom.discount_percent !== null && (
        <Badge variant="outline" className="font-normal">
          {cupom.discount_percent}% ·{" "}
          {cupom.discount_months === null
            ? "todas as cobranças"
            : `${cupom.discount_months} ${cupom.discount_months === 1 ? "mês" : "meses"}`}
        </Badge>
      )}
    </div>
  );
}

function ChaveAtivo({ cupom, situacao }: { cupom: Cupom; situacao: Situacao }) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (ativo: boolean) => {
      const { error } = await supabase.rpc("set_promo_code_active", {
        p_id: cupom.id,
        p_active: ativo,
      });
      if (error) throw error;
      return ativo;
    },
    onSuccess: (ativo) => {
      queryClient.invalidateQueries({ queryKey: ["cupons"] });
      toast.success(ativo ? "Cupom ativado." : "Cupom desativado.");
      // Reativar nao mexe em prazo nem em teto: o codigo volta a `is_active` mas
      // continua sendo recusado por `expired` / `exhausted`.
      if (ativo && (situacao === "expirado" || situacao === "esgotado")) {
        toast.warning(
          situacao === "expirado"
            ? "O cupom continua vencido — a validade não muda ao reativar."
            : "O cupom continua esgotado — o teto de resgates não muda ao reativar.",
        );
      }
    },
    onError: (err) => {
      toast.error(mensagemDeErro(err, "Não foi possível alterar o cupom."));
    },
  });

  return (
    <Switch
      checked={cupom.is_active}
      disabled={mutation.isPending}
      onCheckedChange={(v) => mutation.mutate(v)}
      aria-label={`Ativar cupom ${cupom.code}`}
    />
  );
}

function NovoCupomDialog({
  aberto,
  planos,
  onClose,
}: {
  aberto: boolean;
  planos: Plano[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [codigo, setCodigo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [diasTeste, setDiasTeste] = useState("");
  const [percentual, setPercentual] = useState("");
  const [duracao, setDuracao] = useState<"permanente" | "meses">("permanente");
  const [meses, setMeses] = useState("");
  const [planosEscolhidos, setPlanosEscolhidos] = useState<string[]>([]);
  const [teto, setTeto] = useState("");
  const [validoAte, setValidoAte] = useState("");
  // "" = só cria o cupom. Com empresa escolhida, o cupom nasce já aplicado nela:
  // é o caso do comercial que fecha por telefone e cria o código para um cliente
  // específico — sem isso ele criaria aqui e teria de aplicar de novo na lista.
  const [empresaAlvo, setEmpresaAlvo] = useState("");

  const { data: empresas } = useQuery({
    queryKey: ["tenants-para-cupom"],
    enabled: aberto,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, name, plan_code")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const limpar = () => {
    setCodigo("");
    setDescricao("");
    setDiasTeste("");
    setPercentual("");
    setDuracao("permanente");
    setMeses("");
    setPlanosEscolhidos([]);
    setTeto("");
    setValidoAte("");
    setEmpresaAlvo("");
  };

  const fechar = () => {
    limpar();
    onClose();
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const dias = diasTeste.trim() === "" ? 0 : Number(diasTeste);
      const pct = percentual.trim() === "" ? undefined : Number(percentual);
      const code = codigo.trim().toUpperCase();
      const { error } = await supabase.rpc("create_promo_code", {
        p_code: code,
        p_extra_trial_days: dias,
        p_discount_percent: pct,
        // discount_months so existe junto de um percentual; "permanente" e o NULL.
        p_discount_months: pct !== undefined && duracao === "meses" ? Number(meses) : undefined,
        p_description: descricao.trim() === "" ? undefined : descricao.trim(),
        // Nenhum plano marcado = NULL no banco = vale para qualquer plano.
        p_plan_codes: planosEscolhidos.length > 0 ? planosEscolhidos : undefined,
        p_max_redemptions: teto.trim() === "" ? undefined : Number(teto),
        p_valid_until: validoAte === "" ? undefined : new Date(validoAte).toISOString(),
      });
      if (error) throw error;

      if (empresaAlvo === "") return null;

      // O cupom já existe: uma recusa aqui (conta sem vencimento, plano fora da
      // lista) não desfaz a criação, só deixa de aplicar. Por isso a aplicação
      // reporta separado em vez de virar erro do formulário.
      const { data, error: aplicaErr } = await supabase.rpc("apply_promo_code_to_tenant", {
        p_tenant_id: empresaAlvo,
        p_code: code,
      });
      if (aplicaErr) throw aplicaErr;
      const linha = (Array.isArray(data) ? data[0] : data) ?? null;
      return {
        ...linha,
        empresa: (empresas ?? []).find((t) => t.id === empresaAlvo)?.name ?? "a empresa",
      };
    },
    onSuccess: (aplicacao) => {
      queryClient.invalidateQueries({ queryKey: ["cupons"] });

      if (!aplicacao) {
        toast.success("Cupom criado.");
      } else if (!aplicacao.ok) {
        toast.warning(
          `Cupom criado, mas não foi aplicado em ${aplicacao.empresa}: ${mensagemDoMotivo(aplicacao.reason)} Use o botão da lista para tentar em outra conta.`,
        );
      } else {
        const partes: string[] = [];
        if (aplicacao.dias_aplicados > 0 && aplicacao.novo_vencimento) {
          partes.push(
            `+${aplicacao.dias_aplicados} dias (vence ${formatarData(aplicacao.novo_vencimento)})`,
          );
        }
        if (aplicacao.discount_percent !== null) {
          partes.push(`${aplicacao.discount_percent}% reservado para a próxima cobrança`);
        }
        toast.success(`Cupom criado e aplicado em ${aplicacao.empresa}: ${partes.join(" · ")}`);
      }
      fechar();
    },
    onError: (err) => {
      toast.error(mensagemDeErro(err, "Não foi possível criar o cupom."));
    },
  });

  const submeter = (e: React.FormEvent) => {
    e.preventDefault();
    const code = codigo.trim().toUpperCase();
    if (!CODIGO_REGEX.test(code)) {
      toast.error("Código: 3 a 32 caracteres, só letras, números, ponto, hífen ou sublinhado.");
      return;
    }

    const dias = diasTeste.trim() === "" ? 0 : Number(diasTeste);
    if (!Number.isInteger(dias) || dias < 0 || dias > MAX_DIAS_TESTE) {
      toast.error(`Dias extras de teste: número inteiro entre 0 e ${MAX_DIAS_TESTE}.`);
      return;
    }

    const temPercentual = percentual.trim() !== "";
    const pct = Number(percentual);
    if (temPercentual && (!Number.isInteger(pct) || pct < 1 || pct > 100)) {
      toast.error("Desconto: número inteiro entre 1 e 100.");
      return;
    }
    if (dias === 0 && !temPercentual) {
      toast.error("Informe pelo menos um benefício: dias extras de teste ou desconto.");
      return;
    }
    if (temPercentual && duracao === "meses") {
      const n = Number(meses);
      if (!Number.isInteger(n) || n < 1) {
        toast.error("Duração do desconto: número inteiro de meses maior ou igual a 1.");
        return;
      }
    }

    if (teto.trim() !== "") {
      const n = Number(teto);
      if (!Number.isInteger(n) || n < 1) {
        toast.error("Limite de resgates: número inteiro maior ou igual a 1.");
        return;
      }
    }

    // O banco exige valid_until > valid_from, e valid_from e o instante da criacao.
    if (validoAte !== "" && new Date(validoAte).getTime() <= Date.now()) {
      toast.error("A validade precisa ser uma data futura.");
      return;
    }

    mutation.mutate();
  };

  const temPercentual = percentual.trim() !== "";

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && fechar()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo cupom</DialogTitle>
          <DialogDescription>
            Vale a partir de agora. Depois de criado não dá para editar — só desativar e criar
            outro.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submeter} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cupom-codigo">Código</Label>
            <Input
              id="cupom-codigo"
              value={codigo}
              autoComplete="off"
              placeholder="ACESSOFAST15DIAS"
              className="font-mono uppercase"
              onChange={(ev) => setCodigo(ev.target.value.toUpperCase())}
            />
            <p className="text-xs text-muted-foreground">
              3 a 32 caracteres: A–Z, 0–9, ponto, hífen e sublinhado. O símbolo % não é aceito.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cupom-descricao">Descrição (opcional)</Label>
            <Input
              id="cupom-descricao"
              value={descricao}
              placeholder="Campanha parceiro X"
              onChange={(ev) => setDescricao(ev.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cupom-dias">Dias extras de teste</Label>
            <Input
              id="cupom-dias"
              type="number"
              min={0}
              max={MAX_DIAS_TESTE}
              step={1}
              value={diasTeste}
              placeholder="0"
              onChange={(ev) => setDiasTeste(ev.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Somam aos 7 dias padrão e só valem em quem entra pelo teste grátis.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cupom-percentual">Desconto (%)</Label>
            <Input
              id="cupom-percentual"
              type="number"
              min={1}
              max={100}
              step={1}
              value={percentual}
              placeholder="sem desconto"
              onChange={(ev) => setPercentual(ev.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Só vale em quem assina direto. Deixe vazio para um cupom só de teste.
            </p>
          </div>

          {temPercentual && (
            <div className="space-y-2 rounded-md border border-border/60 p-3">
              <Label>Duração do desconto</Label>
              <RadioGroup
                value={duracao}
                onValueChange={(v) => setDuracao(v as "permanente" | "meses")}
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="permanente" id="duracao-permanente" />
                  <Label htmlFor="duracao-permanente" className="font-normal">
                    Permanente — vale em todas as cobranças
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="meses" id="duracao-meses" />
                  <Label htmlFor="duracao-meses" className="font-normal">
                    Primeiros meses
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={meses}
                    disabled={duracao !== "meses"}
                    className="h-8 w-20"
                    aria-label="Quantidade de meses com desconto"
                    onChange={(ev) => setMeses(ev.target.value)}
                  />
                </div>
              </RadioGroup>
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 shrink-0 mt-px" />O prazo só tem efeito na cobrança
                mensal. No anual é cobrança única, então o desconto entra uma vez e o número de
                meses é ignorado.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label>Planos elegíveis</Label>
            <div className="grid grid-cols-2 gap-2">
              {planos.map((p) => (
                <div key={p.code} className="flex items-center gap-2">
                  <Checkbox
                    id={`plano-${p.code}`}
                    checked={planosEscolhidos.includes(p.code)}
                    onCheckedChange={(v) =>
                      setPlanosEscolhidos((atual) =>
                        v === true ? [...atual, p.code] : atual.filter((c) => c !== p.code),
                      )
                    }
                  />
                  <Label htmlFor={`plano-${p.code}`} className="font-normal text-sm">
                    {p.name}
                  </Label>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Nenhum marcado = vale para qualquer plano.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="cupom-teto">Limite de resgates</Label>
              <Input
                id="cupom-teto"
                type="number"
                min={1}
                step={1}
                value={teto}
                placeholder="ilimitado"
                onChange={(ev) => setTeto(ev.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cupom-validade">Válido até</Label>
              <Input
                id="cupom-validade"
                type="datetime-local"
                value={validoAte}
                onChange={(ev) => setValidoAte(ev.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            O limite é o teto da campanha inteira. A mesma empresa nunca resgata o mesmo cupom duas
            vezes, mas pode usar outro cupom.
          </p>

          <div className="space-y-2 rounded-md border border-border/60 p-3">
            <Label htmlFor="cupom-empresa-alvo">Aplicar já a uma empresa (opcional)</Label>
            <Select
              value={empresaAlvo}
              // O Radix não aceita item de valor vazio, então "nenhuma" vira um
              // sentinela. Sem ele não daria para desfazer a escolha.
              onValueChange={(v) => setEmpresaAlvo(v === NENHUMA_EMPRESA ? "" : v)}
            >
              <SelectTrigger id="cupom-empresa-alvo">
                <SelectValue placeholder="Nenhuma — só criar o cupom" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NENHUMA_EMPRESA}>Nenhuma — só criar o cupom</SelectItem>
                {(empresas ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t.plan_code ?? "sem plano"}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              O cupom nasce já aplicado nessa conta e consome um resgate. Dias extras entram na
              hora; desconto fica reservado para a próxima cobrança dela. Depois, a mesma conta não
              usa este cupom de novo.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={fechar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Criando…" : "Criar cupom"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResgatesDialog({ cupom, onClose }: { cupom: Cupom | null; onClose: () => void }) {
  const { data: resgates, isLoading } = useQuery({
    queryKey: ["cupom-resgates", cupom?.id],
    enabled: !!cupom,
    queryFn: async () => {
      // doc_hash fica fora do select de proposito: e HMAC do CPF/CNPJ, nao e
      // documento e nao vai para a tela. Quem identifica a empresa e o tenant/e-mail.
      const { data, error } = await supabase
        .from("promo_code_redemptions")
        .select(
          "id, code, admin_email, tenant_id, redeemed_at, applied_extra_trial_days, applied_discount_percent, applied_discount_months, source, consumed_at, tenants(name)",
        )
        .eq("promo_code_id", cupom!.id)
        .order("redeemed_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Resgate[];
    },
  });

  return (
    <Dialog open={cupom !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Resgates — <span className="font-mono">{cupom?.code}</span>
          </DialogTitle>
          <DialogDescription>
            Os benefícios abaixo são os que ficaram congelados no resgate. Se o cupom mudou depois,
            eles não acompanham.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border/60 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Dias extras</TableHead>
                <TableHead>Desconto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading &&
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 4 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              {!isLoading && (resgates?.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-10">
                    Nenhum resgate ainda.
                  </TableCell>
                </TableRow>
              )}
              {!isLoading &&
                resgates?.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">{r.tenants?.name ?? r.admin_email ?? "—"}</div>
                      {r.tenants?.name && r.admin_email && (
                        <div className="text-xs text-muted-foreground">{r.admin_email}</div>
                      )}
                      {!r.tenant_id && (
                        <Badge variant="outline" className="mt-1 font-normal">
                          sem empresa provisionada
                        </Badge>
                      )}
                      {r.source === "app" && (
                        <Badge variant="secondary" className="mt-1 font-normal">
                          aplicado no painel
                        </Badge>
                      )}
                      {/* Desconto que ainda não entrou em cobrança nenhuma: o uso
                          já conta no teto da campanha, mas o dinheiro não mudou. */}
                      {r.consumed_at === null && r.applied_discount_percent !== null && (
                        <Badge variant="outline" className="mt-1 font-normal">
                          desconto reservado
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatarData(r.redeemed_at)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {r.applied_extra_trial_days > 0 ? `+${r.applied_extra_trial_days}` : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {r.applied_discount_percent === null
                        ? "—"
                        : `${r.applied_discount_percent}% · ${
                            r.applied_discount_months === null
                              ? "todas as cobranças"
                              : `${r.applied_discount_months} ${
                                  r.applied_discount_months === 1 ? "mês" : "meses"
                                }`
                          }`}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
