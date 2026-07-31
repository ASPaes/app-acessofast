/**
 * Os motivos de recusa que as RPCs de cupom devolvem, na língua de quem lê a
 * tela. Ficam fora dos componentes porque duas telas usam a mesma lista — o
 * diálogo de aplicar e o formulário de criar cupom já aplicando numa conta.
 */
const MOTIVO: Record<string, string> = {
  not_found: "Cupom não encontrado. Confira o código.",
  inactive: "Este cupom está desativado.",
  not_started: "Este cupom ainda não começou a valer.",
  expired: "Este cupom está vencido.",
  exhausted: "Este cupom já atingiu o limite de resgates.",
  plan_not_eligible: "Este cupom não vale para o plano desta conta.",
  already_used: "Esta conta já usou este cupom.",
  discount_pending:
    "Já existe um desconto de cupom reservado nesta conta. Use na próxima cobrança ou remova antes de aplicar outro.",
  no_effect:
    "Este cupom só dá dias extras, e esta conta não tem data de vencimento para estender. Dias só valem em teste ou plano anual.",
};

export function mensagemDoMotivo(reason: string | null | undefined) {
  if (!reason) return "Não foi possível usar este cupom.";
  return MOTIVO[reason] ?? "Não foi possível usar este cupom.";
}
