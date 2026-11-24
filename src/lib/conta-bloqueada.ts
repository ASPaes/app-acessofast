// Texto de quem tenta adicionar computador com a conta bloqueada. Recebe o código de erro
// do servidor (ou uma mensagem que o contenha) e devolve null se não for esse o caso.
export function mensagemContaBloqueada(erro: string): string | null {
  if (erro.includes("billing_blocked")) {
    return "A empresa está sem plano ativo, então não é possível adicionar computadores novos. O administrador regulariza na aba Financeiro do painel.";
  }
  if (erro.includes("conta_inativa")) {
    return "Empresa inativa. Fale com o suporte para reativar a conta.";
  }
  return null;
}
