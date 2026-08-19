import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Megaphone } from "lucide-react";

// ---------------------------------------------------------------------------
// Aviso do plano gratuito — uma vez por versão, com ciência registrada.
//
// O card no Financeiro continua existindo e não é redundância: o modal garante
// que a pessoa VIU; o card garante que ela pode VOLTAR. Um aviso que só existe
// numa janela que fecha para sempre é pior que não ter aviso, porque depois de
// clicar ninguém consegue reler o que foi comunicado.
//
// AlertDialog e não Dialog: o AlertDialog do Radix não fecha por clique fora nem
// por Esc, e não desenha o "X". Aqui isso é a intenção — não é uma janela que se
// descarta sem querer enquanto se procura o botão Conectar.
//
// Este componente não sabe o que é "plano gratuito" nem qual é a versão vigente.
// Quem decide é ad_notice_status(): conta free, versão ainda não vista. Deixar a
// regra na tela significaria mudar deploy para mudar política — e significaria
// que uma tela adulterada poderia pular o aviso.
// ---------------------------------------------------------------------------

// RPCs novas; types.ts só as conhece depois de regenerado. Destipado num ponto só.
const db = supabase as unknown as SupabaseClient;

type Status = { version: string; deve_exibir: boolean };

export function AvisoPlanoGratuito() {
  const queryClient = useQueryClient();

  const status = useQuery({
    queryKey: ["ad_notice_status"],
    queryFn: async () => {
      const { data, error } = await db.rpc("ad_notice_status");
      // Falha aqui não vira erro na tela: a pessoa está entrando no painel para
      // trabalhar. Sem resposta, o aviso simplesmente não aparece agora e
      // reaparece na próxima carga — a ciência continua pendente no banco.
      if (error) return null;
      const linhas = (data ?? []) as Status[];
      return linhas[0] ?? null;
    },
  });

  const darCiencia = useMutation({
    mutationFn: async () => {
      const { error } = await db.rpc("ad_notice_ack");
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ad_notice_status"] });
    },
  });

  const aberto = status.data?.deve_exibir === true && !darCiencia.isSuccess;

  return (
    <AlertDialog open={aberto}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-primary" />
            Como funciona o plano gratuito
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-left">
              <p>
                Você está no plano gratuito: 5 acessos por dia, cada um com limite de 2 horas. Ele{" "}
                <strong className="text-foreground">exibe anúncio</strong> — é isso que o mantém
                gratuito.
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  Todo anúncio é identificado. Publicidade de terceiro nunca se passa por
                  recomendação nossa.
                </li>
                <li>Nunca durante um atendimento em andamento.</li>
                <li>Nunca em tela cheia e nunca bloqueando o que você está fazendo.</li>
                <li>Há um teto diário de quantos você vê.</li>
                <li>Nada é baixado ou executado: é imagem e texto dentro do painel.</li>
              </ul>
              <p>
                O anunciante não recebe seu nome, o da sua empresa, nem a lista das suas máquinas —
                só a contagem de exibições e cliques. Se alguma dessas condições mudar, avisamos
                antes de valer.
              </p>
              <p className="text-xs">
                Este texto fica disponível a qualquer momento em Financeiro.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {/* Botão único, e o rótulo diz a verdade: o anúncio é condição do plano
              gratuito, então não existe recusar e seguir no gratuito. "Aceito"
              com uma saída só seria teatro de escolha. */}
          <AlertDialogAction
            onClick={(e) => {
              // Impede o fechamento antes de o registro sair: se a gravação
              // falhar, a janela continua e a pessoa tenta de novo.
              e.preventDefault();
              darCiencia.mutate();
            }}
            disabled={darCiencia.isPending}
          >
            {darCiencia.isPending ? "Registrando…" : "Entendi"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
