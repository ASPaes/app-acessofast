import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

// ---------------------------------------------------------------------------
// Pagamento de plano feito por fora do checkout: Pix direto na chave da ASP (o
// cliente foge dos juros do parcelamento no Asaas), transferência, dinheiro.
//
// Registrar aqui faz o que o pagamento pelo checkout faria: contratação paga, plano
// aplicado e conta liberada por 12 meses. Só plano anual — o mensal não teria quem
// cobrasse o mês seguinte. Regras no banco: 20261106150000_pagamentos_manuais.
//
// Pix na chave vira cobrança no Asaas sozinho, com um cliente criado na hora e sem
// conta nenhuma ligada. Esses aparecem em "Pix recebidos sem conta" e são ligados
// com um clique: valor e data saem do Asaas, não de digitação.
// ---------------------------------------------------------------------------

type Registro = Database["public"]["Functions"]["pagamentos_manuais_lista"]["Returns"][number];
type PixSolto = Database["public"]["Functions"]["pix_sem_vinculo"]["Returns"][number];
type Plano = {
  code: string;
  name: string;
  max_users: number | null;
  is_custom: boolean;
  is_active: boolean;
  price_year_cents: number | null;
};

const FORMAS = [
  { value: "pix", label: "Pix" },
  { value: "transferencia", label: "Transferência" },
  { value: "boleto", label: "Boleto" },
  { value: "cartao", label: "Cartão" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "outro", label: "Outro" },
];
const ROTULO_FORMA: Record<string, string> = Object.fromEntries(
  FORMAS.map((f) => [f.value, f.label]),
);

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const emReais = (centavos: number) => brl.format(centavos / 100);

/** AAAA-MM-DD (data sem hora) em DD/MM/AAAA, sem passar por Date e fuso. */
function diaBr(dia: string): string {
  return dia.split("-").reverse().join("/");
}

/** Dia de Brasília (AAAA-MM-DD) de um instante. */
function diaDe(instante: string | number | Date): string {
  return new Date(instante).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/**
 * Vencimento escolhido por data vale o dia inteiro: o corte da madrugada (00:35 de
 * Brasília) só pega a conta no dia seguinte.
 */
function fimDoDia(dia: string): string {
  return `${dia}T23:59:59-03:00`;
}

function centavos(valor: string): number | null {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

/** Tudo que mostra cobrança, plano ou pagamento depende de um registro aqui. */
const CHAVES_AFETADAS = [
  ["pagamentos-manuais"],
  ["pix-sem-vinculo"],
  ["pagamentos-manuais-empresas"],
  ["financeiro-plataforma-tenants"],
  ["financeiro-plataforma-contratados"],
  ["financeiro-plataforma-pagamentos"],
  ["tenants-empresas"],
  ["oferta-lancamento"],
];

function useAtualizarTelas() {
  const queryClient = useQueryClient();
  return () => {
    for (const queryKey of CHAVES_AFETADAS) queryClient.invalidateQueries({ queryKey });
  };
}

export function PagamentosPorFora() {
  const [registrando, setRegistrando] = useState<{ pix: PixSolto | null } | null>(null);
  const [corrigindo, setCorrigindo] = useState<Registro | null>(null);
  const [cancelando, setCancelando] = useState<Registro | null>(null);

  const { data: registros, isLoading } = useQuery({
    queryKey: ["pagamentos-manuais"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("pagamentos_manuais_lista");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: pixSoltos } = useQuery({
    queryKey: ["pix-sem-vinculo"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("pix_sem_vinculo");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: planos } = useQuery({
    queryKey: ["pagamentos-manuais-planos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plans")
        .select("code, name, max_users, is_custom, is_active, price_year_cents")
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as Plano[];
    },
  });
  const nomePorPlano = new Map((planos ?? []).map((p) => [p.code, p.name]));

  return (
    <div className="space-y-4">
      {(pixSoltos?.length ?? 0) > 0 && (
        <Card className="border-warning/40">
          <CardHeader>
            <CardTitle className="text-base">Pix recebidos sem conta</CardTitle>
            <CardDescription>
              Pix feito direto na chave da ASP. O Asaas registrou o dinheiro, mas ele ainda não paga
              nenhuma conta. Abra o comprovante para ver quem pagou e ligue à conta certa.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-border/60 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Recebido em</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Cobrança no Asaas</TableHead>
                    <TableHead className="text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pixSoltos?.map((p) => (
                    <TableRow key={p.payment_id}>
                      <TableCell className="text-sm tabular-nums">
                        {new Date(p.recebido_em).toLocaleString("pt-BR", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {emReais(p.valor_cents)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {p.comprovante_url ? (
                          <a
                            href={p.comprovante_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                          >
                            {p.payment_id}
                            <ExternalLink className="h-3 w-3" aria-hidden />
                          </a>
                        ) : (
                          p.payment_id
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" onClick={() => setRegistrando({ pix: p })}>
                          Ligar a uma conta
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-4">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Pagamentos por fora do checkout</CardTitle>
            <CardDescription>
              Pix, transferência ou dinheiro recebidos sem passar pelo checkout. Registrar libera o
              plano anual da conta e entra na receita e nos pagamentos do Financeiro.
            </CardDescription>
          </div>
          <Button size="sm" className="shrink-0" onClick={() => setRegistrando({ pix: null })}>
            <Plus className="mr-2 h-4 w-4" />
            Registrar pagamento
          </Button>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border/60 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pago em</TableHead>
                  <TableHead>Conta</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Forma</TableHead>
                  <TableHead>Libera até</TableHead>
                  <TableHead>Registrado por</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={9}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && (registros?.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-10">
                      Nenhum pagamento registrado por fora.
                    </TableCell>
                  </TableRow>
                )}
                {registros?.map((r) => {
                  const ativo = r.status === "ativo";
                  return (
                    <TableRow key={r.id} className={ativo ? undefined : "opacity-60"}>
                      <TableCell className="text-sm tabular-nums">{diaBr(r.pago_em)}</TableCell>
                      <TableCell className="font-medium">{r.empresa}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {nomePorPlano.get(r.plan_code) ?? r.plan_code}
                        {r.vagas !== null && ` · ${r.vagas} vagas`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {emReais(r.valor_cents)}
                      </TableCell>
                      <TableCell
                        className="text-sm text-muted-foreground"
                        title={r.asaas_payment_id ?? r.referencia ?? undefined}
                      >
                        {ROTULO_FORMA[r.forma] ?? r.forma}
                        {r.asaas_payment_id && " · Asaas"}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {new Date(r.vencimento_novo).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <span className="block">{r.registrado_por ?? "—"}</span>
                        <span className="block text-xs">
                          {new Date(r.registrado_em).toLocaleDateString("pt-BR")}
                        </span>
                      </TableCell>
                      <TableCell>
                        {ativo ? (
                          <Badge
                            variant="outline"
                            className="border-success/30 bg-success/10 text-success"
                          >
                            Liberado
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-muted-foreground"
                            title={r.motivo_cancelamento ?? undefined}
                          >
                            Cancelado
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {ativo && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => setCorrigindo(r)}>
                              Corrigir
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              disabled={!r.pode_desfazer}
                              title={
                                r.pode_desfazer
                                  ? undefined
                                  : "A conta mudou depois deste pagamento (renovação ou outro registro): ajuste pelo mais recente."
                              }
                              onClick={() => setCancelando(r)}
                            >
                              Cancelar
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <RegistrarDialog
        aberto={registrando !== null}
        pix={registrando?.pix ?? null}
        planos={planos ?? []}
        onClose={() => setRegistrando(null)}
      />
      <CorrigirDialog registro={corrigindo} onClose={() => setCorrigindo(null)} />
      <CancelarDialog registro={cancelando} onClose={() => setCancelando(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Registrar
// ---------------------------------------------------------------------------

function RegistrarDialog({
  aberto,
  pix,
  planos,
  onClose,
}: {
  aberto: boolean;
  pix: PixSolto | null;
  planos: Plano[];
  onClose: () => void;
}) {
  const atualizar = useAtualizarTelas();
  const [tenantId, setTenantId] = useState("");
  const [planCode, setPlanCode] = useState("");
  const [valor, setValor] = useState("");
  const [pagoEm, setPagoEm] = useState("");
  const [forma, setForma] = useState("pix");
  const [cobranca, setCobranca] = useState("");
  const [vagas, setVagas] = useState("");
  const [venceEm, setVenceEm] = useState("");
  const [referencia, setReferencia] = useState("");
  const [observacao, setObservacao] = useState("");

  useEffect(() => {
    if (!aberto) return;
    setTenantId("");
    setPlanCode("");
    setValor(pix ? (pix.valor_cents / 100).toFixed(2) : "");
    setPagoEm(pix ? pix.pago_em : diaDe(Date.now()));
    setForma("pix");
    setCobranca(pix?.payment_id ?? "");
    setVagas("");
    setVenceEm("");
    setReferencia("");
    setObservacao("");
  }, [aberto, pix]);

  const { data: empresas } = useQuery({
    queryKey: ["pagamentos-manuais-empresas"],
    enabled: aberto,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, name, plan_code, is_active, billing_exempt, billing_exempt_until")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      // Isenta não paga: a RPC recusa, então nem aparece na lista.
      const agora = Date.now();
      return (data ?? []).filter(
        (t) =>
          !t.billing_exempt ||
          (!!t.billing_exempt_until && new Date(t.billing_exempt_until).getTime() <= agora),
      );
    },
  });

  const { data: ativos } = useQuery({
    queryKey: ["usuarios-ativos-da-conta", tenantId],
    enabled: aberto && !!tenantId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .neq("role", "super_admin");
      if (error) throw error;
      return count ?? 0;
    },
  });

  const planosPagos = planos.filter(
    (p) => p.is_active && (p.is_custom || (p.price_year_cents ?? 0) > 0),
  );
  const plano = planosPagos.find((p) => p.code === planCode) ?? null;
  const vagasEfetivas = vagas ? Number(vagas) : (plano?.max_users ?? null);
  const semVagas = ativos !== undefined && vagasEfetivas !== null && ativos > vagasEfetivas;
  const daCobranca = cobranca.trim() !== "";

  const escolherConta = (id: string) => {
    setTenantId(id);
    const atual = empresas?.find((t) => t.id === id)?.plan_code;
    if (atual && planosPagos.some((p) => p.code === atual)) setPlanCode(atual);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("registrar_pagamento_manual", {
        p_tenant: tenantId,
        p_plan_code: planCode,
        p_asaas_payment_id: daCobranca ? cobranca.trim() : undefined,
        p_valor_cents: daCobranca ? undefined : (centavos(valor) ?? undefined),
        p_pago_em: daCobranca ? undefined : pagoEm,
        p_forma: daCobranca ? undefined : forma,
        p_vagas: vagas ? Number(vagas) : undefined,
        p_vence_em: venceEm ? fimDoDia(venceEm) : undefined,
        p_referencia: referencia.trim() || undefined,
        p_observacao: observacao.trim() || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      atualizar();
      toast.success("Pagamento registrado. A conta já está liberada.");
      onClose();
    },
    onError: (err: Error) => toast.error(traduzirErro(err.message)),
  });

  const submeter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return toast.error("Escolha a conta que pagou.");
    if (!plano) return toast.error("Escolha o plano.");
    if (plano.max_users === null && !vagas) {
      return toast.error("Plano sob medida: informe o número de vagas.");
    }
    if (!daCobranca && centavos(valor) === null) return toast.error("Informe o valor pago.");
    if (!daCobranca && !pagoEm) return toast.error("Informe a data do pagamento.");
    mutation.mutate();
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {pix ? "Ligar Pix a uma conta" : "Registrar pagamento por fora"}
          </DialogTitle>
          <DialogDescription>
            Libera o plano anual na hora: conta ativa por 12 meses (a partir do vencimento atual, se
            ela já tem plano pago em dia).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submeter} className="space-y-4">
          <div className="space-y-2">
            <Label>Conta *</Label>
            <Select value={tenantId} onValueChange={escolherConta}>
              <SelectTrigger>
                <SelectValue placeholder="Quem pagou" />
              </SelectTrigger>
              <SelectContent>
                {empresas?.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Plano anual *</Label>
              <Select value={planCode} onValueChange={setPlanCode}>
                <SelectTrigger>
                  <SelectValue placeholder="Plano" />
                </SelectTrigger>
                <SelectContent>
                  {planosPagos.map((p) => (
                    <SelectItem key={p.code} value={p.code}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pf-vagas">Vagas</Label>
              <Input
                id="pf-vagas"
                type="number"
                min={1}
                value={vagas}
                placeholder={plano?.max_users ? `${plano.max_users} (do plano)` : "obrigatório"}
                onChange={(e) => setVagas(e.target.value)}
              />
            </div>
          </div>
          {tenantId && ativos !== undefined && (
            <p className={"text-xs " + (semVagas ? "text-destructive" : "text-muted-foreground")}>
              {semVagas
                ? `A conta tem ${ativos} usuários ativos e o plano dá ${vagasEfetivas} vagas: ninguém da empresa conecta até o admin bloquear alguém. Para manter todos, aumente as vagas.`
                : `A conta tem ${ativos} usuário(s) ativo(s).`}
            </p>
          )}

          {pix ? (
            <p className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-sm">
              {emReais(pix.valor_cents)} em {diaBr(pix.pago_em)} por Pix. Valor e data vêm do Asaas
              ({pix.payment_id}).
            </p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="pf-valor">Valor (R$) *</Label>
                  <Input
                    id="pf-valor"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0.01"
                    value={valor}
                    disabled={daCobranca}
                    onChange={(e) => setValor(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pf-pago">Pago em *</Label>
                  <Input
                    id="pf-pago"
                    type="date"
                    value={pagoEm}
                    max={diaDe(Date.now())}
                    disabled={daCobranca}
                    onChange={(e) => setPagoEm(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Forma *</Label>
                  <Select value={forma} onValueChange={setForma} disabled={daCobranca}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FORMAS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pf-cobranca">Cobrança no Asaas</Label>
                <Input
                  id="pf-cobranca"
                  value={cobranca}
                  placeholder="pay_… (opcional)"
                  onChange={(e) => setCobranca(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Se o dinheiro entrou no Asaas, informe a cobrança: valor, data e forma passam a
                  vir de lá e o pagamento não conta duas vezes.
                </p>
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="pf-vence">Libera até</Label>
            <Input
              id="pf-vence"
              type="date"
              value={venceEm}
              min={diaDe(Date.now())}
              onChange={(e) => setVenceEm(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Vazio = 12 meses. Preencha só para combinar outra data.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pf-referencia">ID da transação</Label>
            <Input
              id="pf-referencia"
              value={referencia}
              placeholder="Do comprovante, para achar no extrato"
              onChange={(e) => setReferencia(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pf-observacao">Observação</Label>
            <Textarea
              id="pf-observacao"
              value={observacao}
              rows={2}
              onChange={(e) => setObservacao(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Voltar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Liberando…" : "Registrar e liberar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Corrigir
// ---------------------------------------------------------------------------

function CorrigirDialog({ registro, onClose }: { registro: Registro | null; onClose: () => void }) {
  const atualizar = useAtualizarTelas();
  const [valor, setValor] = useState("");
  const [pagoEm, setPagoEm] = useState("");
  const [forma, setForma] = useState("pix");
  const [venceEm, setVenceEm] = useState("");
  const [referencia, setReferencia] = useState("");
  const [observacao, setObservacao] = useState("");

  useEffect(() => {
    if (!registro) return;
    setValor((registro.valor_cents / 100).toFixed(2));
    setPagoEm(registro.pago_em);
    setForma(registro.forma);
    setVenceEm(diaDe(registro.vencimento_novo));
    setReferencia(registro.referencia ?? "");
    setObservacao(registro.observacao ?? "");
  }, [registro]);

  const doAsaas = !!registro?.asaas_payment_id;
  const venceMudou = !!registro && venceEm !== diaDe(registro.vencimento_novo);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!registro) return;
      const { error } = await supabase.rpc("editar_pagamento_manual", {
        p_id: registro.id,
        p_valor_cents: doAsaas ? registro.valor_cents : (centavos(valor) ?? 0),
        p_pago_em: doAsaas ? registro.pago_em : pagoEm,
        p_forma: doAsaas ? registro.forma : forma,
        // Sem mudar o dia, manda o instante exato: o banco só mexe na conta se mudou.
        p_vence_em: venceMudou ? fimDoDia(venceEm) : registro.vencimento_novo,
        p_referencia: referencia,
        p_observacao: observacao,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      atualizar();
      toast.success("Pagamento corrigido.");
      onClose();
    },
    onError: (err: Error) => toast.error(traduzirErro(err.message)),
  });

  return (
    <Dialog open={registro !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Corrigir pagamento — {registro?.empresa}</DialogTitle>
          <DialogDescription>
            {doAsaas
              ? "Valor, data e forma vêm da cobrança do Asaas e não mudam aqui."
              : "Plano e conta não mudam aqui: para isso, cancele e registre de novo."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!doAsaas && centavos(valor) === null) {
              toast.error("Informe o valor pago.");
              return;
            }
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="pc-valor">Valor (R$)</Label>
              <Input
                id="pc-valor"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                value={valor}
                disabled={doAsaas}
                onChange={(e) => setValor(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pc-pago">Pago em</Label>
              <Input
                id="pc-pago"
                type="date"
                value={pagoEm}
                max={diaDe(Date.now())}
                disabled={doAsaas}
                onChange={(e) => setPagoEm(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Forma</Label>
              <Select value={forma} onValueChange={setForma} disabled={doAsaas}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMAS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pc-vence">Libera até</Label>
            <Input
              id="pc-vence"
              type="date"
              value={venceEm}
              min={diaDe(Date.now())}
              disabled={!registro?.pode_desfazer}
              onChange={(e) => setVenceEm(e.target.value)}
            />
            {!registro?.pode_desfazer && (
              <p className="text-xs text-muted-foreground">
                A conta mudou depois deste pagamento (renovação ou outro registro): o vencimento se
                ajusta pelo mais recente.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="pc-referencia">ID da transação</Label>
            <Input
              id="pc-referencia"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pc-observacao">Observação</Label>
            <Textarea
              id="pc-observacao"
              value={observacao}
              rows={2}
              onChange={(e) => setObservacao(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Voltar
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

// ---------------------------------------------------------------------------
// Cancelar
// ---------------------------------------------------------------------------

function CancelarDialog({ registro, onClose }: { registro: Registro | null; onClose: () => void }) {
  const atualizar = useAtualizarTelas();
  const [motivo, setMotivo] = useState("");

  useEffect(() => {
    if (registro) setMotivo("");
  }, [registro]);

  const anterior = registro?.vencimento_anterior ? new Date(registro.vencimento_anterior) : null;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!registro) return;
      const { error } = await supabase.rpc("cancelar_pagamento_manual", {
        p_id: registro.id,
        p_motivo: motivo.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      atualizar();
      toast.success("Pagamento cancelado. A conta voltou a como estava antes dele.");
      onClose();
    },
    onError: (err: Error) => toast.error(traduzirErro(err.message)),
  });

  return (
    <Dialog open={registro !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar pagamento — {registro?.empresa}</DialogTitle>
          <DialogDescription>
            A conta volta exatamente como estava antes deste registro: plano, vagas e vencimento
            {anterior ? ` (${anterior.toLocaleDateString("pt-BR")})` : ""}.
            {anterior && anterior.getTime() < Date.now()
              ? " Esse prazo já passou, então o acesso remoto da empresa é bloqueado na hora."
              : ""}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!motivo.trim()) {
              toast.error("Diga por que o pagamento está sendo cancelado.");
              return;
            }
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="pcan-motivo">Motivo *</Label>
            <Textarea
              id="pcan-motivo"
              value={motivo}
              rows={2}
              placeholder="Ex.: Pix ligado à conta errada; valor estornado"
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Voltar
            </Button>
            <Button type="submit" variant="destructive" disabled={mutation.isPending}>
              {mutation.isPending ? "Cancelando…" : "Cancelar pagamento"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** As RPCs levantam código curto; a tela é quem sabe dizer isso em português. */
function traduzirErro(mensagem: string): string {
  const erros: [string, string][] = [
    ["forbidden", "Só o super admin registra pagamento por fora."],
    ["tenant_not_found", "Conta não encontrada."],
    ["conta_inativa", "A conta está inativa. Reative em Empresas antes de registrar."],
    ["conta_isenta", "A conta é isenta de cobrança. Tire a isenção antes de registrar."],
    ["plano_invalido", "Escolha um plano pago e ativo."],
    ["cobranca_nao_encontrada", "Cobrança não encontrada no Asaas. Confira o ID (pay_…)."],
    ["cobranca_nao_paga", "Essa cobrança do Asaas ainda não está paga."],
    ["cobranca_ja_vinculada", "Essa cobrança já paga outra conta ou compra."],
    ["valor_invalido", "Informe o valor pago."],
    ["data_invalida", "A data do pagamento não pode ser futura."],
    ["forma_invalida", "Escolha a forma de pagamento."],
    ["vencimento_invalido", "A data de liberação precisa ser futura."],
    ["seat_count_required", "Plano sob medida: informe o número de vagas."],
    ["seat_count_invalid", "O número de vagas precisa ser pelo menos 1."],
    ["pagamento_cancelado", "Este pagamento já foi cancelado."],
    [
      "conta_mudou_depois",
      "A conta mudou depois deste pagamento (renovação ou outro registro). Ajuste pelo mais recente.",
    ],
    ["motivo_obrigatorio", "Diga por que o pagamento está sendo cancelado."],
    ["not_found", "Pagamento não encontrado. Recarregue a página."],
  ];
  for (const [codigo, texto] of erros) {
    if (mensagem.includes(codigo)) return texto;
  }
  return mensagem || "Não foi possível salvar.";
}
