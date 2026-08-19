import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/stat-card";
import type { KpiInfo } from "@/components/kpi-info";
import { Megaphone, MousePointerClick, Eye, Users } from "lucide-react";

// ---------------------------------------------------------------------------
// Anuncios — a medicao do inventario do plano gratuito.
//
// Esta tela existe para responder UMA pergunta: "anunciante paga por esse
// inventario?". Foi o argumento que justificou a Fase 1 inteira — e ate aqui
// ad_impressions era escrita e nunca lida, o que deixava a pergunta sem
// resposta a nao ser rodando SQL a mao.
//
// Tudo vem de RPC agregada (ad_stats_*), nunca da tabela crua: ad_impressions
// nomeia QUEM viu QUAL peca e QUANDO, e isso e comportamento do tecnico. A
// propria migration da Fase 1 ja tinha fixado que o relatorio sairia de
// agregado. As RPCs sao security definer e devolvem ZERO LINHAS para quem nao e
// super_admin — a guarda esta no banco, nao neste componente.
// ---------------------------------------------------------------------------

// As RPCs nascem junto com esta tela; types.ts so as conhece depois de
// regenerado. Destipado AQUI, num ponto so, como ja se faz em /conectar.
const db = supabase as unknown as SupabaseClient;

export const Route = createFileRoute("/_authenticated/anuncios")({
  head: () => ({
    meta: [{ title: "Anúncios — Acessofast" }, { name: "robots", content: "noindex" }],
  }),
  component: AnunciosPage,
});

type LinhaDia = {
  dia: string;
  exibicoes: number;
  cliques: number;
  espectadores: number;
  exibicoes_painel: number;
  exibicoes_embed: number;
  acessos_gratuitos: number;
};

type LinhaCampanha = {
  campanha: string;
  kind: "house" | "third_party";
  status: string;
  exibicoes: number;
  cliques: number;
  ctr: number | null;
  espectadores: number;
  ultima: string | null;
};

type LinhaSuperficie = {
  placement: "free_start" | "exhausted";
  surface: "painel" | "embed";
  exibicoes: number;
  cliques: number;
  ctr: number | null;
};

const rotuloPlacement: Record<string, string> = {
  free_start: "Início do uso gratuito",
  exhausted: "Acessos esgotados",
};

const rotuloSurface: Record<string, string> = {
  painel: "Painel",
  embed: "Janela do DoctorSaaS",
};

const JANELAS = [7, 30, 90] as const;

function pct(v: number | null) {
  return v === null ? "—" : `${v.toString().replace(".", ",")}%`;
}

function dataCurta(iso: string) {
  const [, mes, dia] = iso.split("-");
  return `${dia}/${mes}`;
}

// ---------------------------------------------------------------------------
// O que cada número quer dizer. Definição junto da conta que a produz — as
// fórmulas abaixo descrevem as RPCs ad_stats_*, não o que a tela faz por cima.
// ---------------------------------------------------------------------------
const INFO: Record<string, KpiInfo> = {
  exibicoes: {
    oQue: "Quantas vezes uma peça foi desenhada na tela de um técnico no período.",
    porQue:
      "É o inventário que se vende. Anunciante compra exibição, não usuário cadastrado — e este é o único número que ele aceita como base de preço.",
    comoCalculamos: "linhas de ad_impressions no período (uma por exibição servida)",
    referencia:
      "Conta exibição SERVIDA pelo servidor. Peça que o servidor entregou e a tela não chegou a desenhar entraria aqui — foi um defeito real na validação de 18/08, e é o motivo de o número ser conferido contra o clique.",
  },
  cliques: {
    oQue: "Exibições em que o técnico clicou no botão da peça, e o CTR que isso dá.",
    porQue:
      "Exibição diz que o espaço existe; clique diz que ele funciona. É o CTR que decide se o espaço vale preço de mídia ou preço de sobra.",
    comoCalculamos: "exibições com clicked_at preenchido ÷ total de exibições",
    referencia:
      "Um CTR baixo aqui não é conclusivo sozinho — veja antes a quebra por superfície, porque a janela do DoctorSaaS fecha sozinha em 2,5s.",
  },
  espectadores: {
    oQue: "No dia mais movimentado do período, quantos técnicos distintos viram anúncio.",
    porQue:
      "Separa alcance de repetição: 100 exibições para 5 pessoas e para 80 são produtos diferentes, e o anunciante paga preços diferentes por cada um.",
    comoCalculamos: "maior contagem diária de espectadores distintos no período",
    referencia:
      "É pico de um dia, não único do período. O único exigiria a RPC devolver identidade de espectador, que é justamente o que ela não devolve — a tabela nomeia quem viu o quê.",
  },
  cobertura: {
    oQue: "Quantas exibições houve para cada 100 acessos gratuitos consumidos.",
    porQue:
      "Separa dois diagnósticos que parecem o mesmo: inventário PEQUENO é limite de mercado; inventário OCIOSO é defeito nosso — teto por espectador, falta de peça elegível ou momento que não dispara.",
    comoCalculamos: "exibições ÷ acessos gratuitos consumidos no período × 100",
    referencia:
      "Pode passar de 100%: cada acesso gratuito pode render mais de uma exibição (início e esgotado são momentos distintos), e exibição de teste também conta.",
  },
};

function AnunciosPage() {
  const [dias, setDias] = useState<number>(30);

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

  const serie = useQuery({
    queryKey: ["ad_stats_diario", dias],
    enabled: !!isSuper,
    queryFn: async () => {
      const { data, error } = await db.rpc("ad_stats_diario", { p_dias: dias });
      if (error) throw error;
      return (data ?? []) as LinhaDia[];
    },
  });

  const campanhas = useQuery({
    queryKey: ["ad_stats_campanha", dias],
    enabled: !!isSuper,
    queryFn: async () => {
      const { data, error } = await db.rpc("ad_stats_campanha", { p_dias: dias });
      if (error) throw error;
      return (data ?? []) as LinhaCampanha[];
    },
  });

  const superficies = useQuery({
    queryKey: ["ad_stats_superficie", dias],
    enabled: !!isSuper,
    queryFn: async () => {
      const { data, error } = await db.rpc("ad_stats_superficie", { p_dias: dias });
      if (error) throw error;
      return (data ?? []) as LinhaSuperficie[];
    },
  });

  if (me && !isSuper) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Anúncios</CardTitle>
            <CardDescription>Acesso restrito à equipe da plataforma.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const linhas = serie.data ?? [];
  const exibicoes = linhas.reduce((s, l) => s + l.exibicoes, 0);
  const cliques = linhas.reduce((s, l) => s + l.cliques, 0);
  const gratuitos = linhas.reduce((s, l) => s + l.acessos_gratuitos, 0);
  const ctr = exibicoes === 0 ? null : Math.round((1000 * cliques) / exibicoes) / 10;
  // Espectadores unicos NAO se soma entre dias — o mesmo tecnico aparece em
  // varios. O maximo de um dia e o piso honesto que da pra afirmar daqui; o
  // unico no periodo exigiria distinct na janela inteira, e ai a RPC teria que
  // devolver identidade, que e justamente o que ela nao devolve.
  const picoEspectadores = linhas.reduce((m, l) => Math.max(m, l.espectadores), 0);
  // Cobertura: de cada uso gratuito consumido, quantos renderam exibicao. E o
  // numero que separa "inventario pequeno" de "inventario ocioso" — o primeiro
  // e limite de mercado, o segundo e defeito nosso.
  const cobertura = gratuitos === 0 ? null : Math.round((100 * exibicoes) / gratuitos);

  const carregando = serie.isLoading || campanhas.isLoading || superficies.isLoading;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Anúncios</h1>
          <p className="text-sm text-muted-foreground">
            O inventário do plano gratuito, medido. Exibições e CTR são o que responde se o espaço
            vale algo para um anunciante.
          </p>
        </div>
        <div className="flex gap-1">
          {JANELAS.map((j) => (
            <Button
              key={j}
              size="sm"
              variant={dias === j ? "default" : "outline"}
              onClick={() => setDias(j)}
            >
              {j} dias
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Exibições"
          info={INFO.exibicoes}
          value={exibicoes}
          icon={Eye}
          hint={`em ${dias} dias`}
          loading={carregando}
          color="blue"
        />
        <StatCard
          title="Cliques"
          info={INFO.cliques}
          value={cliques}
          icon={MousePointerClick}
          hint={`CTR ${pct(ctr)}`}
          loading={carregando}
          color="violet"
        />
        <StatCard
          title="Espectadores"
          info={INFO.espectadores}
          value={picoEspectadores}
          icon={Users}
          hint="pico de técnicos distintos num dia"
          loading={carregando}
          color="cyan"
        />
        <StatCard
          title="Cobertura"
          info={INFO.cobertura}
          value={cobertura === null ? "—" : `${cobertura}%`}
          icon={Megaphone}
          hint={`${exibicoes} exibições para ${gratuitos} acessos gratuitos`}
          loading={carregando}
          color="emerald"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Por campanha</CardTitle>
          <CardDescription>
            Campanha sem exibição aparece com zero — a lista também é o inventário do que está no
            ar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {campanhas.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (campanhas.data ?? []).length === 0 ? (
            <Vazio texto="Nenhuma campanha cadastrada." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campanha</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Exibições</TableHead>
                  <TableHead className="text-right">Cliques</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  <TableHead className="text-right">Espectadores</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(campanhas.data ?? []).map((c) => (
                  <TableRow key={c.campanha}>
                    <TableCell className="font-medium">
                      {c.campanha}
                      {c.status !== "approved" && (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          {c.status}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={c.kind === "house" ? "secondary" : "default"}>
                        {c.kind === "house" ? "Da casa" : "Terceiro"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.exibicoes}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.cliques}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(c.ctr)}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.espectadores}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Por momento e superfície</CardTitle>
          <CardDescription>
            Painel e janela do DoctorSaaS são medidos à parte de propósito: a janela fecha sozinha
            2,5s depois do clique em Abrir conexão, e um CTR somando as duas seria indiagnosticável.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {superficies.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : (superficies.data ?? []).length === 0 ? (
            <Vazio texto="Nenhuma exibição no período." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Momento</TableHead>
                  <TableHead>Superfície</TableHead>
                  <TableHead className="text-right">Exibições</TableHead>
                  <TableHead className="text-right">Cliques</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(superficies.data ?? []).map((s) => (
                  <TableRow key={`${s.placement}-${s.surface}`}>
                    <TableCell className="font-medium">
                      {rotuloPlacement[s.placement] ?? s.placement}
                    </TableCell>
                    <TableCell>{rotuloSurface[s.surface] ?? s.surface}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.exibicoes}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.cliques}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(s.ctr)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dia a dia</CardTitle>
          <CardDescription>
            Dia sem exibição aparece com zero. “Acessos gratuitos” é o teto do inventário: o espaço
            só existe enquanto resta uso gratuito, então é ele que se vende — não a base de técnicos
            free.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {serie.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dia</TableHead>
                  <TableHead className="text-right">Exibições</TableHead>
                  <TableHead className="text-right">Painel</TableHead>
                  <TableHead className="text-right">Janela</TableHead>
                  <TableHead className="text-right">Cliques</TableHead>
                  <TableHead className="text-right">Espectadores</TableHead>
                  <TableHead className="text-right">Acessos gratuitos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((l) => (
                  <TableRow
                    key={l.dia}
                    className={l.exibicoes === 0 ? "text-muted-foreground" : ""}
                  >
                    <TableCell className="font-medium">{dataCurta(l.dia)}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.exibicoes}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.exibicoes_painel}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.exibicoes_embed}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.cliques}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.espectadores}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.acessos_gratuitos}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{texto}</p>;
}
