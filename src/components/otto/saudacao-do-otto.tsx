import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Otto, type OttoEstado } from "@/components/otto/otto";
import { supabase } from "@/integrations/supabase/client";

// O topo do Dashboard: o Otto cumprimenta pelo horário do Brasil (não o do
// computador de quem abre) e conta, numa frase, como está o momento. A cara dele
// acompanha a frase: atendendo quando há sessão aberta, em dúvida quando nenhum
// computador está online, acenando quando está tudo tranquilo.
//
// "Nenhum computador online" é o único sinal de preocupação de propósito:
// computador de cliente desligado à noite é normal, então só a lista inteira
// fora do ar merece a cara de dúvida.

export type ResumoDoMomento = {
  dispositivos: number;
  online: number;
  sessoesAtivas: number;
};

function horaNoBrasil() {
  const partes = new Intl.DateTimeFormat("pt-BR", {
    hour: "numeric",
    hourCycle: "h23",
    timeZone: "America/Sao_Paulo",
  }).formatToParts(new Date());
  return Number(partes.find((p) => p.type === "hour")?.value ?? 12);
}

function saudacao(hora: number) {
  if (hora >= 5 && hora < 12) return "Bom dia";
  if (hora >= 12 && hora < 18) return "Boa tarde";
  return "Boa noite";
}

function plural(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`;
}

function momento(
  r: ResumoDoMomento | undefined,
  isSuper: boolean,
): { cara: OttoEstado; frase: string | null } {
  if (!r) return { cara: "parado", frase: null };
  if (r.sessoesAtivas > 0) {
    const onde = isSuper ? " na plataforma" : "";
    return {
      cara: "atendendo",
      frase: `${plural(r.sessoesAtivas, "atendimento", "atendimentos")} em andamento agora${onde}.`,
    };
  }
  if (r.dispositivos === 0) {
    return {
      cara: "ola",
      frase: "Vamos cadastrar o primeiro computador? É por Dispositivos, no menu ao lado.",
    };
  }
  if (r.online === 0) {
    return { cara: "aguardando", frase: "Nenhum computador online neste momento." };
  }
  return {
    cara: "ola",
    frase: `Tudo tranquilo: ${r.online} de ${plural(r.dispositivos, "computador", "computadores")} online e nenhum atendimento em andamento.`,
  };
}

export function SaudacaoDoOtto({
  resumo,
  isSuper,
  subtitulo,
}: {
  resumo: ResumoDoMomento | undefined;
  isSuper: boolean;
  subtitulo: string;
}) {
  // A hora sai do navegador só depois de montar: no servidor ela seria outra, e o
  // texto não bateria com o que o React encontra ao assumir a página.
  const [hora, setHora] = useState<number | null>(null);
  useEffect(() => {
    setHora(horaNoBrasil());
  }, []);

  const { data: nome } = useQuery({
    queryKey: ["meu-primeiro-nome"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", u.user.id)
        .maybeSingle();
      return data?.full_name?.trim().split(/\s+/)[0] || null;
    },
  });

  const { cara, frase } = momento(resumo, isSuper);
  const titulo = hora === null ? "Olá" : saudacao(hora);

  return (
    <div className="flex items-center gap-4">
      <Otto estado={cara} className="w-16 shrink-0" />
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">
          {titulo}
          {nome ? `, ${nome}` : ""}!
        </h1>
        {frase && <p className="text-sm text-foreground/90">{frase}</p>}
        <p className="text-sm text-muted-foreground">{subtitulo}</p>
      </div>
    </div>
  );
}
