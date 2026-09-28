import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useMe } from "@/hooks/use-me";
import { useHorarioAcesso } from "@/hooks/use-horario-acesso";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DIAS,
  FUSOS,
  FUSO_PADRAO,
  HORARIO_PADRAO,
  fimParaBanco,
  fimParaCampo,
  problemaNoHorario,
  quandoNoFuso,
  type HorarioSemana,
  type SituacaoHorario,
} from "@/lib/horario-acesso";

// ---------------------------------------------------------------------------
// Configuracoes da empresa. A tela tinha saido do menu em 31/07 por nao ter conteudo;
// volta com a primeira regra de verdade, o horario de acesso.
//
// Quem edita: admin da propria empresa e super_admin (qualquer empresa) — e o que a
// politica tenant_settings_update ja permite. Tecnico nao ve o item no menu; a regra
// aparece para ele onde importa, no Conectar travado.
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [{ title: "Configurações — Acessofast" }, { name: "robots", content: "noindex" }],
  }),
  component: ConfiguracoesPage,
});

type ConfigHorario = {
  horario_acesso_ativo: boolean;
  horario_acesso: Json;
  horario_acesso_encerra_sessoes: boolean;
  timezone: string;
};

function ConfiguracoesPage() {
  const { data: me, isPending } = useMe();
  const isSuper = me?.role === "super_admin";
  const podeEditar = isSuper || me?.role === "admin";
  // super_admin nao tem empresa propria: escolhe qual esta configurando.
  const [empresaEscolhida, setEmpresaEscolhida] = useState("");
  const tenantId = isSuper ? empresaEscolhida || null : (me?.tenant_id ?? null);

  const empresas = useQuery({
    queryKey: ["tenants_lista"],
    enabled: isSuper,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenants").select("id, name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const config = useQuery({
    queryKey: ["tenant_settings_horario", tenantId],
    enabled: podeEditar && !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_settings")
        .select("horario_acesso_ativo, horario_acesso, horario_acesso_encerra_sessoes, timezone")
        .eq("tenant_id", tenantId as string)
        .maybeSingle();
      if (error) throw error;
      return data as ConfigHorario | null;
    },
  });

  if (!isPending && !podeEditar) {
    return (
      <div className="space-y-6 p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            As configurações da empresa são decididas pela administração da conta. Fale com o
            administrador do AcessoFast da sua empresa.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
          <p className="text-sm text-muted-foreground">Regras que valem para a empresa inteira.</p>
        </div>
        {isSuper && (
          <Select value={empresaEscolhida} onValueChange={setEmpresaEscolhida}>
            <SelectTrigger className="w-64" aria-label="Empresa">
              <SelectValue placeholder="Escolha a empresa" />
            </SelectTrigger>
            <SelectContent>
              {(empresas.data ?? []).map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {isSuper && !tenantId ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Escolha a empresa para ver e mudar as configurações dela.
          </CardContent>
        </Card>
      ) : config.isPending ? (
        <Skeleton className="h-[32rem] w-full" />
      ) : config.isError || !config.data || !tenantId ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Não foi possível carregar as configurações desta empresa. Tente de novo em instantes.
          </CardContent>
        </Card>
      ) : (
        // key: trocar de empresa recomeca o formulario, em vez de levar o rascunho junto.
        <HorarioAcessoCard key={tenantId} tenantId={tenantId} salvo={config.data} />
      )}
    </div>
  );
}

// Na tela o dia fechado guarda o horario que tinha: desligar e religar um dia nao
// deveria obrigar a digitar tudo de novo.
type DiaForm = { aberto: boolean; inicio: string; fim: string };

function lerSemana(valor: Json): DiaForm[] {
  const semana = (Array.isArray(valor) && valor.length === 7 ? valor : HORARIO_PADRAO) as unknown[];
  return semana.map((dia) => {
    const d = dia as { inicio?: unknown; fim?: unknown } | null;
    if (d && typeof d.inicio === "string" && typeof d.fim === "string") {
      return { aberto: true, inicio: d.inicio, fim: fimParaCampo(d.fim) };
    }
    return { aberto: false, inicio: "08:00", fim: "18:00" };
  });
}

function paraBanco(dias: DiaForm[]): HorarioSemana {
  return dias.map((d) => (d.aberto ? { inicio: d.inicio, fim: fimParaBanco(d.fim) } : null));
}

function HorarioAcessoCard({ tenantId, salvo }: { tenantId: string; salvo: ConfigHorario }) {
  const queryClient = useQueryClient();
  const [ativo, setAtivo] = useState(salvo.horario_acesso_ativo);
  const [dias, setDias] = useState<DiaForm[]>(() => lerSemana(salvo.horario_acesso));
  const [encerra, setEncerra] = useState(salvo.horario_acesso_encerra_sessoes);
  const [fuso, setFuso] = useState(salvo.timezone || FUSO_PADRAO);

  const semana = useMemo(() => paraBanco(dias), [dias]);
  const problema =
    problemaNoHorario(semana) ??
    (ativo && semana.every((d) => d === null)
      ? "Marque pelo menos um dia, ou desligue a limitação."
      : null);

  const alterado =
    JSON.stringify([ativo, semana, encerra, fuso]) !==
    JSON.stringify([
      salvo.horario_acesso_ativo,
      paraBanco(lerSemana(salvo.horario_acesso)),
      salvo.horario_acesso_encerra_sessoes,
      salvo.timezone || FUSO_PADRAO,
    ]);

  // Situacao do que esta SALVO — e o que vale agora, rascunho nao conta.
  const { data: situacoes } = useHorarioAcesso();
  const agora = situacoes?.get(tenantId);

  const salvar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("tenant_settings")
        .update({
          horario_acesso_ativo: ativo,
          horario_acesso: semana as unknown as Json,
          horario_acesso_encerra_sessoes: encerra,
          timezone: fuso,
        })
        .eq("tenant_id", tenantId)
        .select("tenant_id");
      if (error) throw error;
      // RLS que nao deixa atualizar nao da erro: devolve zero linhas.
      if (!data?.length)
        throw new Error("Sem permissão para mudar as configurações desta empresa.");
    },
    onSuccess: async () => {
      toast.success(
        ativo
          ? "Horário de acesso salvo. Já está valendo."
          : "Salvo. As máquinas aceitam acesso a qualquer hora.",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tenant_settings_horario", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["v_horario_acesso"] }),
      ]);
    },
    onError: (e: unknown) => {
      toast.error((e as { message?: string })?.message ?? "Falha ao salvar");
    },
  });

  const mudarDia = (indice: number, parcial: Partial<DiaForm>) =>
    setDias((prev) => prev.map((d, i) => (i === indice ? { ...d, ...parcial } : d)));

  // Mudar o expediente de todo mundo e o caso comum: arruma a segunda e replica.
  const repetirSegunda = () =>
    setDias((prev) =>
      prev.map((d, i) =>
        i !== 1 && d.aberto ? { ...d, inicio: prev[1].inicio, fim: prev[1].fim } : d,
      ),
    );

  const descartar = () => {
    setAtivo(salvo.horario_acesso_ativo);
    setDias(lerSemana(salvo.horario_acesso));
    setEncerra(salvo.horario_acesso_encerra_sessoes);
    setFuso(salvo.timezone || FUSO_PADRAO);
  };

  // Fuso gravado fora da lista (so pela API) continua aparecendo, em vez de sumir do campo.
  const fusos = FUSOS.some((f) => f.valor === fuso)
    ? FUSOS
    : [...FUSOS, { valor: fuso, rotulo: fuso }];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4" aria-hidden />
          Horário de acesso
        </CardTitle>
        <CardDescription>
          Fora do horário, o técnico não conecta nas máquinas da empresa — nem pelo painel, nem pelo
          programa AcessoFast direto na máquina.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-start justify-between gap-4 rounded-md border border-border/60 p-3">
          <div className="space-y-1">
            <Label htmlFor="horario-ativo" className="text-sm font-medium">
              Limitar os acessos ao horário da empresa
            </Label>
            <p className="text-xs text-muted-foreground">
              <SituacaoAgora ativoSalvo={salvo.horario_acesso_ativo} agora={agora} />
            </p>
          </div>
          <Switch id="horario-ativo" checked={ativo} onCheckedChange={setAtivo} />
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>Dias e horários liberados</Label>
            <Button type="button" variant="ghost" size="sm" onClick={repetirSegunda}>
              Repetir o horário de segunda nos outros dias
            </Button>
          </div>
          <div className="divide-y divide-border/60 rounded-md border border-border/60">
            {DIAS.map(({ indice, nome }) => {
              const d = dias[indice];
              return (
                <div key={indice} className="flex min-h-12 flex-wrap items-center gap-3 px-3 py-2">
                  <Switch
                    id={`dia-${indice}`}
                    checked={d.aberto}
                    onCheckedChange={(v) => mudarDia(indice, { aberto: v })}
                  />
                  <Label htmlFor={`dia-${indice}`} className="w-20 font-normal">
                    {nome}
                  </Label>
                  {d.aberto ? (
                    <div className="flex items-center gap-2 text-sm">
                      <Input
                        type="time"
                        step={60}
                        value={d.inicio}
                        onChange={(e) => mudarDia(indice, { inicio: e.target.value })}
                        className="h-8 w-28"
                        aria-label={`${nome}: início`}
                      />
                      <span className="text-muted-foreground">às</span>
                      <Input
                        type="time"
                        step={60}
                        value={d.fim}
                        onChange={(e) => mudarDia(indice, { fim: e.target.value })}
                        className="h-8 w-28"
                        aria-label={`${nome}: fim`}
                      />
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">Fechado, nenhum acesso</span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Fim às 00:00 quer dizer até a meia-noite. O fim precisa ser depois do início: horário
            que passa da meia-noite ainda não é aceito.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="horario-fuso">Fuso horário</Label>
          <Select value={fuso} onValueChange={setFuso}>
            <SelectTrigger id="horario-fuso" className="w-full sm:w-[26rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fusos.map((f) => (
                <SelectItem key={f.valor} value={f.valor}>
                  {f.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Quando o horário acabar</Label>
          <RadioGroup
            value={encerra ? "encerrar" : "terminar"}
            onValueChange={(v) => setEncerra(v === "encerrar")}
            className="gap-3"
          >
            <div className="flex items-start gap-2">
              <RadioGroupItem value="terminar" id="horario-terminar" className="mt-0.5" />
              <Label htmlFor="horario-terminar" className="font-normal leading-snug">
                <span className="font-medium">Deixar terminar</span>
                <span className="block text-xs text-muted-foreground">
                  Quem já estava conectado continua até sair. Conexão nova é barrada.
                </span>
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="encerrar" id="horario-encerrar" className="mt-0.5" />
              <Label htmlFor="horario-encerrar" className="font-normal leading-snug">
                <span className="font-medium">Encerrar na hora</span>
                <span className="block text-xs text-muted-foreground">
                  As sessões abertas caem quando o horário acaba, em até 20 segundos.
                </span>
              </Label>
            </div>
          </RadioGroup>
        </div>

        <div className="space-y-1 rounded-md border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Fora do horário</p>
          <ul className="list-disc space-y-1 pl-4">
            <li>O técnico vê o botão Conectar travado no painel.</li>
            <li>
              Acesso direto pelo programa AcessoFast, com ID e senha ou com alguém clicando em
              Aceitar na máquina, cai em poucos segundos. Nesse caminho não há exceção para ninguém.
            </li>
            <li>Administradores da empresa continuam conectando pelo painel, para emergências.</li>
            <li>Cada tentativa barrada fica registrada na Auditoria.</li>
          </ul>
        </div>

        {problema && <p className="text-sm text-destructive">{problema}</p>}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {alterado && (
            <span className="mr-auto text-xs text-muted-foreground">Alterações não salvas.</span>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={!alterado || salvar.isPending}
            onClick={descartar}
          >
            Descartar
          </Button>
          <Button
            type="button"
            disabled={!alterado || !!problema || salvar.isPending}
            onClick={() => salvar.mutate()}
          >
            {salvar.isPending ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SituacaoAgora({
  ativoSalvo,
  agora,
}: {
  ativoSalvo: boolean;
  agora: SituacaoHorario | undefined;
}) {
  if (!ativoSalvo) return <>Desligado: as máquinas aceitam acesso a qualquer hora.</>;
  if (!agora) return <>Ligado.</>;
  if (agora.fora) {
    return (
      <>
        <span className="font-medium text-warning">Agora está fora do horário.</span>{" "}
        {agora.abre_em
          ? `Libera ${quandoNoFuso(agora.abre_em, agora.timezone)}.`
          : "Nenhum dia está liberado."}
      </>
    );
  }
  return (
    <>
      <span className="font-medium text-foreground">Agora está dentro do horário</span>
      {agora.fecha_em ? `, até ${quandoNoFuso(agora.fecha_em, agora.timezone)}.` : "."}
    </>
  );
}
