import { useState } from "react";
import { AlertTriangle, Copy, Check, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { COMANDO_ATUALIZAR_AGENTE } from "@/lib/download-agente";

// Aviso de frota desatualizada, no topo de QUALQUER tela do painel.
//
// POR QUE NAO BASTA O AVISO NA HORA DE CONECTAR: aquele so aparece para quem
// clica em Conectar no painel. Boa parte dos acessos acontece direto pelo
// cliente AcessoFast — o tecnico abre o programa, digita o ID e conecta, sem
// passar por tela nenhuma nossa. Nesse caminho nao existe onde encaixar um
// aviso: quem mostraria algo na maquina acessada seria o agente, e sao
// justamente essas maquinas que nao recebem codigo novo.
//
// O que sobra e alcancar a PESSOA em vez do momento: quem conecta direto
// tambem entra no painel para outras coisas, e aqui ele ve o numero e o
// comando. Nao e o mesmo que interromper no ato, e nao finge ser — e o unico
// ponto de contato que existe para esse fluxo.
//
// Dispensavel de proposito (o X): banner que nao fecha vira ruido que a pessoa
// aprende a ignorar, e ai nem o aviso de conexao ela le direito. Fechado, volta
// no proximo carregamento do painel.
export function BannerAgenteDesatualizado() {
  const [fechado, setFechado] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const { data: total } = useQuery({
    queryKey: ["frota_desatualizada"],
    // Cinco minutos: o numero muda quando alguem atualiza uma maquina, o que
    // acontece em escala de dias. Reperguntar a cada foco de janela seria peso
    // sem informacao nova.
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      // head:true -> so a contagem, sem trazer linha nenhuma.
      const { count, error } = await supabase
        .from("address_book")
        .select("id", { count: "exact", head: true })
        .is("agent_version", null)
        .neq("is_active", false);
      if (error) throw error;
      return count ?? 0;
    },
  });

  if (fechado || !total) return null;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(COMANDO_ATUALIZAR_AGENTE);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      /* sem permissão de área de transferência: o botão simplesmente não confirma */
    }
  };

  return (
    <div className="mx-4 mt-4 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {total === 1
              ? "1 computador está com uma versão antiga do AcessoFast"
              : `${total} computadores estão com uma versão antiga do AcessoFast`}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {total === 1 ? "Ele não reporta" : "Eles não reportam"} status e{" "}
            {total === 1 ? "não se atualiza" : "não se atualizam"} sozinho
            {total === 1 ? "" : "s"}. Ao acessar, cole este comando no PowerShell da
            máquina — ele baixa e instala a versão nova por cima, sem reiniciar.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={copiar}>
              {copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copiado ? "Comando copiado" : "Copiar comando de atualização"}
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setFechado(true)}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-warning/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Dispensar aviso"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
