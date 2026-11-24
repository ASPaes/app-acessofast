// ---------------------------------------------------------------------------
// Quem é conta pagante.
//
// Regra única do Financeiro da Plataforma (Receita contratada, Sem cobrança) e do
// filtro Pagantes de Empresas. Se cada tela contasse do seu jeito, o número de
// pagantes de uma não bateria com a lista da outra — e a primeira pergunta seria
// qual das duas está errada.
// ---------------------------------------------------------------------------

export type ContaCobranca = {
  is_active: boolean;
  billing_mode: string;
  is_trial: boolean;
  billing_exempt: boolean;
  billing_exempt_until: string | null;
  asaas_subscription_id: string | null;
  plan_expires_at: string | null;
};

/** Por que a conta paga, ou por que não paga. */
export type SituacaoCobranca =
  | "pagante"
  | "sem_cobranca"
  | "teste"
  | "isenta"
  | "creditos"
  | "gratis"
  | "inativa";

/**
 * Isenção só vale até billing_exempt_until — mesma regra do cron de suspensão.
 * Isenção vencida volta a ser conta que deveria pagar.
 */
export function isentaAgora(t: ContaCobranca, agora = Date.now()): boolean {
  return (
    t.billing_exempt &&
    (!t.billing_exempt_until || new Date(t.billing_exempt_until).getTime() > agora)
  );
}

/**
 * Plano pago: em plano, fora do teste e sem isenção vigente. Teste e isenção
 * ficam de fora porque nenhuma das duas gera cobrança — incluí-las inflaria a
 * receita com dinheiro que ninguém vai receber.
 */
export function devePagar(t: ContaCobranca, agora = Date.now()): boolean {
  return t.billing_mode === "plan" && !t.is_trial && !isentaAgora(t, agora);
}

/**
 * Pagante de verdade: plano pago E alguém cobrando. Mensal = assinatura no
 * Asaas. Anual = o ano pago ainda vale, porque o anual é cobrança única e não
 * cria assinatura. `ciclo` é o da última contratação paga (valores_contratados).
 */
export function ehPagante(
  t: ContaCobranca,
  ciclo: string | null | undefined,
  agora = Date.now(),
): boolean {
  if (!devePagar(t, agora)) return false;
  if (ciclo === "annual") {
    return !!t.plan_expires_at && new Date(t.plan_expires_at).getTime() > agora;
  }
  return !!t.asaas_subscription_id;
}

/**
 * Conta inativa vem primeiro: mesmo com o ano pago, ela não usa o sistema e
 * não entra na receita do Financeiro, que só olha contas ativas.
 */
export function situacaoCobranca(
  t: ContaCobranca,
  ciclo: string | null | undefined,
  agora = Date.now(),
): SituacaoCobranca {
  if (!t.is_active) return "inativa";
  if (ehPagante(t, ciclo, agora)) return "pagante";
  if (devePagar(t, agora)) return "sem_cobranca";
  if (t.is_trial) return "teste";
  if (isentaAgora(t, agora)) return "isenta";
  if (t.billing_mode === "credits") return "creditos";
  return "gratis";
}
