import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Tela que o usuário vê quando chega numa rota que o papel dele não alcança.
 *
 * Existe porque esconder o item do menu não é proteção: o link continua
 * navegável por URL, e sem esta tela a rota renderizaria a estrutura vazia — o
 * que faz o painel parecer quebrado em vez de restrito. A proteção de verdade
 * é o RLS no banco; isto é só o recado.
 *
 * `onde` aponta para onde a informação foi, quando ela existe em outro lugar.
 * Sem isso, quem perdeu um acesso que tinha ontem fica sem saber se a
 * funcionalidade sumiu ou mudou de endereço.
 */
export function AcessoRestrito({
  titulo,
  motivo = "Acesso restrito à equipe da plataforma.",
  onde,
}: {
  titulo: string;
  motivo?: string;
  onde?: React.ReactNode;
}) {
  return (
    <div className="p-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{titulo}</CardTitle>
          <CardDescription>{motivo}</CardDescription>
          {onde && <div className="pt-2 text-sm text-muted-foreground">{onde}</div>}
        </CardHeader>
      </Card>
    </div>
  );
}
