import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { StatCard } from "@/components/stat-card";
import { KpiRotulo, type KpiInfo } from "@/components/kpi-info";
import {
  History,
  Timer,
  MonitorSmartphone,
  Building2,
  Layers,
  MoonStar,
  RotateCcw,
  Users,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Operação — o que a EMPRESA vê do próprio atendimento.
//
// O Dashboard respondia "quantas sessões" e "quem conectou". Não respondia
// quanto tempo, em quantas máquinas distintas, quanto do plano se usa no pico,
// nem se o mesmo computador volta sempre. São perguntas de gestão, e todas já
// tinham resposta nos dados — faltava perguntar.
//
// TODO o recorte por empresa é resolvido NO BANCO (RPCs ops_*, security
// definer). O seletor abaixo é conveniência de tela: se alguém trocar o id no
// navegador, quem não é super admin recebe o próprio escopo de volta, não o da
// outra empresa. Segurança que depende de <Select> não é segurança.
// ---------------------------------------------------------------------------

// As RPCs nascem com esta tela; types.ts só as conhece depois de regenerado.
const db = supabase as unknown as SupabaseClient;

const JANELAS = [7, 30, 90] as const;
const TODAS = "__todas__";

type Resumo = {
  acessos: number;
  em_andamento: number;
  horas: number;
  duracao_media_s: number | null;
  duracao_mediana_s: number | null;
  duracao_p90_s: number | null;
  tecnicos: number;
  dispositivos_acessados: number;
  dispositivos_novos: number;
  dispositivos_ativos: number;
  clientes_atendidos: number;
  fora_horario: number;
  pico_simultaneo: number;
  limite_plano: number | null;
  reacessos_24h: number;
  acessos_anterior: number;
};

type PorTecnico = {
  tecnico: string;
  acessos: number;
  horas: number;
  duracao_media_s: number | null;
  dispositivos: number;
  clientes: number;
  fora_horario: number;
  ultimo: string | null;
};

type PorDispositivo = {
  dispositivo: string;
  rustdesk_id: string;
  cliente: string | null;
  acessos: number;
  horas: number;
  tecnicos: number;
  reacessos: number;
  ultimo: string | null;
};

type Empresa = { id: string; nome: string; acessos_30d: number };

const INFO: Record<string, KpiInfo> = {
  acessos: {
    oQue: "Sessões remotas iniciadas no período, pelo painel ou pelo executável.",
    porQue:
      "É o volume bruto da operação. Sozinho diz pouco — ganha sentido ao lado de horas e da duração mediana, porque 100 sessões de 2 minutos e 100 de 2 horas são operações diferentes.",
    comoCalculamos: "sessões com início dentro do período, no escopo selecionado",
  },
  horas: {
    oQue: "Soma do tempo conectado de todas as sessões do período.",
    porQue:
      "É a medida de carga que o volume esconde. Serve para dimensionar equipe e para comparar clientes que dão o mesmo número de chamados com esforço muito diferente.",
    comoCalculamos: "soma da duração das sessões do período ÷ 3600",
  },
  duracao: {
    oQue: "Duração mediana de um atendimento: metade dura menos que isso, metade mais.",
    porQue:
      "A MÉDIA engana aqui, e muito. Nos dados atuais a média é ~43 min e a mediana ~2 min: um punhado de sessões longuíssimas puxa a média para longe do atendimento típico. A mediana descreve o dia a dia; o P90, o pior caso.",
    comoCalculamos: "percentil 50 da duração das sessões do período",
    referencia: "O P90 aparece na dica abaixo do número — é onde moram os casos difíceis.",
  },
  computadores: {
    oQue: "Computadores distintos que receberam pelo menos um acesso no período.",
    porQue:
      "É o alcance real do suporte, diferente do parque cadastrado. Máquina cadastrada que nunca é acessada não gera trabalho — e pode indicar cadastro velho.",
    comoCalculamos: "contagem de dispositivos distintos nas sessões do período",
  },
  clientes: {
    oQue: "Clientes finais distintos cujas máquinas receberam algum acesso no período.",
    porQue:
      "É a base realmente atendida, não a cadastrada. Comparado com o total de clientes, mostra quanto da carteira consome suporte — e é o primeiro passo para saber quem dá trabalho desproporcional.",
    comoCalculamos: "clientes distintos ligados aos computadores acessados no período",
    referencia:
      "Computador sem cliente vinculado no cadastro não entra nesta conta, mas continua contado em acessos.",
  },
  pico: {
    oQue: "Maior número de sessões acontecendo ao mesmo tempo no período.",
    porQue:
      "É o número que decide o tamanho do plano. O limite de simultaneidade não recusa pela média — recusa no pico, e é sempre no pior momento do dia.",
    comoCalculamos: "varredura das sessões: +1 ao abrir, −1 ao fechar; o pico é o maior acumulado",
    referencia: "Quando há uma empresa em foco, a dica compara com o limite contratado dela.",
  },
  foraHorario: {
    oQue: "Sessões iniciadas antes das 8h, das 18h em diante, ou em fim de semana.",
    porQue:
      "Sustenta duas conversas diferentes: plantão e hora extra de um lado; acesso em horário improvável do outro. O número não decide qual — mostra onde olhar.",
    comoCalculamos:
      "sessões cujo início cai fora de 8h–18h de segunda a sexta (horário de Brasília)",
  },
  reacessos: {
    oQue: "Sessões que começaram até 24h depois de outra na MESMA máquina.",
    porQue:
      "É o sinal mais próximo de “não resolveu da primeira vez” que os dados sustentam. Máquina que aparece muito aqui merece olhar de causa raiz, não mais um acesso.",
    comoCalculamos: "sessões cuja anterior no mesmo computador ocorreu há ≤ 24h",
    referencia:
      "NÃO é taxa de resolução. O modelo não tem noção de “problema” nem de “resolvido”: um retorno pode ser continuação combinada do mesmo trabalho.",
  },
  tecnicos: {
    oQue: "Pessoas distintas que abriram alguma sessão no período.",
    porQue:
      "Divide o volume por gente. Também mostra assento contratado parado — quem não aparece aqui não usou o produto no período.",
    comoCalculamos: "técnicos distintos nas sessões do período",
    referencia:
      "Sessão iniciada fora do painel não tem usuário a quem atribuir e não entra nesta contagem; ela aparece na tabela por técnico como “Fora do painel”.",
  },
};

function dur(s: number | null | undefined) {
  if (s === null || s === undefined) return "—";
  const n = Number(s);
  if (n < 60) return `${Math.round(n)}s`;
  if (n < 3600) return `${Math.round(n / 60)} min`;
  const h = Math.floor(n / 3600);
  const m = Math.round((n % 3600) / 60);
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

function quando(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function PainelOperacao({ isSuper }: { isSuper: boolean }) {
  const [dias, setDias] = useState<number>(30);
  const [empresa, setEmpresa] = useState<string>(TODAS);

  // O seletor só existe para quem enxerga mais de uma conta. Para os demais o
  // escopo já é a própria empresa, e um combo de um item só é ruído.
  const empresas = useQuery({
    queryKey: ["ops_empresas"],
    enabled: isSuper,
    queryFn: async () => {
      const { data, error } = await db.rpc("ops_empresas");
      if (error) throw error;
      return (data ?? []) as Empresa[];
    },
  });

  const alvo = empresa === TODAS ? null : empresa;

  const resumo = useQuery({
    queryKey: ["ops_resumo", alvo, dias],
    queryFn: async () => {
      const { data, error } = await db.rpc("ops_resumo", { p_tenant: alvo, p_dias: dias });
      if (error) throw error;
      const linhas = (data ?? []) as Resumo[];
      return linhas[0] ?? null;
    },
  });

  const tecnicos = useQuery({
    queryKey: ["ops_por_tecnico", alvo, dias],
    queryFn: async () => {
      const { data, error } = await db.rpc("ops_por_tecnico", { p_tenant: alvo, p_dias: dias });
      if (error) throw error;
      return (data ?? []) as PorTecnico[];
    },
  });

  const dispositivos = useQuery({
    queryKey: ["ops_por_dispositivo", alvo, dias],
    queryFn: async () => {
      const { data, error } = await db.rpc("ops_por_dispositivo", { p_tenant: alvo, p_dias: dias });
      if (error) throw error;
      return (data ?? []) as PorDispositivo[];
    },
  });

  const r = resumo.data;
  const carregando = resumo.isLoading;

  // Crescimento contra a janela imediatamente anterior, do mesmo tamanho. Sem
  // período anterior com dado, não se afirma nada: "+∞%" é ruído, não notícia.
  const variacao =
    r && r.acessos_anterior > 0
      ? Math.round(((r.acessos - r.acessos_anterior) / r.acessos_anterior) * 100)
      : null;

  const usoPlano =
    r && r.limite_plano && r.limite_plano > 0
      ? Math.round((r.pico_simultaneo / r.limite_plano) * 100)
      : null;

  const nomeEmpresa =
    empresa === TODAS ? null : ((empresas.data ?? []).find((e) => e.id === empresa)?.nome ?? null);

  return (
    <div className="space-y-4">
      {/* Sem titulo proprio: a aba ja diz "Operação", e repetir a palavra logo
          abaixo dela so empurra o conteudo para baixo. Fica a frase de escopo,
          que e o que muda conforme os controles ao lado. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {nomeEmpresa
            ? `Atendimento de ${nomeEmpresa} nos últimos ${dias} dias.`
            : isSuper
              ? `Atendimento de todas as empresas nos últimos ${dias} dias.`
              : `Seu atendimento nos últimos ${dias} dias.`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {isSuper && (
            <Select value={empresa} onValueChange={setEmpresa}>
              <SelectTrigger className="w-[240px]">
                <SelectValue placeholder="Empresa" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS}>Todas as empresas</SelectItem>
                {(empresas.data ?? []).map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.nome}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {e.acessos_30d} acessos
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex gap-1">
            {JANELAS.map((j) => (
              <Button
                key={j}
                size="sm"
                variant={dias === j ? "default" : "outline"}
                onClick={() => setDias(j)}
              >
                {j}d
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Acessos"
          info={INFO.acessos}
          value={r?.acessos ?? 0}
          icon={History}
          hint={
            variacao === null
              ? `${r?.em_andamento ?? 0} em andamento`
              : `${variacao >= 0 ? "+" : ""}${variacao}% vs período anterior`
          }
          loading={carregando}
          color="blue"
        />
        <StatCard
          title="Horas conectadas"
          info={INFO.horas}
          value={r ? Number(r.horas).toLocaleString("pt-BR") : 0}
          icon={Timer}
          hint={`${r?.tecnicos ?? 0} técnico(s) no período`}
          loading={carregando}
          color="emerald"
        />
        <StatCard
          title="Duração mediana"
          info={INFO.duracao}
          value={dur(r?.duracao_mediana_s)}
          icon={Layers}
          hint={`média ${dur(r?.duracao_media_s)} · P90 ${dur(r?.duracao_p90_s)}`}
          loading={carregando}
          color="violet"
        />
        <StatCard
          title="Pico simultâneo"
          info={INFO.pico}
          value={r?.pico_simultaneo ?? 0}
          icon={Users}
          hint={
            usoPlano === null
              ? "escolha uma empresa para comparar com o plano"
              : `${usoPlano}% do limite de ${r?.limite_plano}`
          }
          loading={carregando}
          color={usoPlano !== null && usoPlano >= 90 ? "amber" : "cyan"}
        />
        <StatCard
          title="Computadores acessados"
          info={INFO.computadores}
          value={r?.dispositivos_acessados ?? 0}
          icon={MonitorSmartphone}
          hint={`${r?.dispositivos_novos ?? 0} acessado(s) pela 1ª vez`}
          loading={carregando}
          color="cyan"
        />
        <StatCard
          title="Clientes atendidos"
          info={INFO.clientes}
          value={r?.clientes_atendidos ?? 0}
          icon={Building2}
          hint="com ao menos um acesso no período"
          loading={carregando}
          color="emerald"
        />
        <StatCard
          title="Fora do horário"
          info={INFO.foraHorario}
          value={r?.fora_horario ?? 0}
          icon={MoonStar}
          hint="antes das 8h, após as 18h ou fim de semana"
          loading={carregando}
          color="amber"
        />
        <StatCard
          title="Reacessos em 24h"
          info={INFO.reacessos}
          value={r?.reacessos_24h ?? 0}
          icon={RotateCcw}
          hint="mesma máquina, menos de um dia depois"
          loading={carregando}
          color="lime"
        />
      </div>

      {/* items-start: sem isso o cartao mais curto estica para acompanhar o
          vizinho e abre um vazio grande dentro dele, que se le como defeito. */}
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <KpiRotulo titulo="Por técnico" info={INFO.tecnicos} />
            </CardTitle>
            <CardDescription>
              Volume, horas e alcance de cada pessoa. Sem ranking de eficiência: os dados medem
              tempo conectado, não trabalho feito.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {tecnicos.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : (tecnicos.data ?? []).length === 0 ? (
              <Vazio texto="Nenhum acesso no período." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Técnico</TableHead>
                    <TableHead className="text-right">Acessos</TableHead>
                    <TableHead className="text-right">Horas</TableHead>
                    <TableHead className="text-right">Média</TableHead>
                    <TableHead className="text-right">PCs</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(tecnicos.data ?? []).map((t) => (
                    <TableRow key={t.tecnico}>
                      <TableCell className="font-medium">
                        {t.tecnico}
                        {t.tecnico === "Fora do painel" && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            sem usuário
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{t.acessos}</TableCell>
                      <TableCell className="text-right tabular-nums">{t.horas}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {dur(t.duracao_media_s)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{t.dispositivos}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Computadores mais atendidos</CardTitle>
            <CardDescription>
              Ordenado por número de acessos. A coluna “volta” conta os retornos em menos de 24h — é
              por onde se acha máquina que precisa de causa raiz, não de mais um acesso.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {dispositivos.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : (dispositivos.data ?? []).length === 0 ? (
              <Vazio texto="Nenhum acesso no período." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Computador</TableHead>
                    <TableHead className="text-right">Acessos</TableHead>
                    <TableHead className="text-right">Horas</TableHead>
                    <TableHead className="text-right">Volta</TableHead>
                    <TableHead className="text-right">Último</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(dispositivos.data ?? []).slice(0, 10).map((d) => (
                    <TableRow key={d.rustdesk_id}>
                      <TableCell className="font-medium">
                        {d.dispositivo}
                        {d.cliente && (
                          <span className="block text-xs text-muted-foreground">{d.cliente}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{d.acessos}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.horas}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.reacessos}</TableCell>
                      <TableCell className="text-right tabular-nums">{quando(d.ultimo)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{texto}</p>;
}
