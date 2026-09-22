// Presença — o que sobrou no painel depois que a decisão foi para o banco.
//
// ONDE A REGRA MORA: `public.v_dispositivo_status.status_presenca`, criada pela
// migration `20260918120000_status_presenca_no_banco.sql`. As telas leem essa
// coluna e desenham. Nenhuma delas calcula presença a partir de `last_online`,
// e é de propósito — este arquivo já teve a regra, e ela vazou em cópias.
//
// POR QUE MUDOU DE LUGAR. O status quebrou três vezes seguidas, sempre igual:
//
//   28/08  a janela foi de 2 para 7 min no painel porque o agente ia afrouxar o
//          `presence` de 60s para 180s. Duas mudanças, dois repositórios, e a
//          ordem entre elas importava.
//   06/09  o servidor passou a DESCARTAR o `presence` de parte da frota para
//          poupar escrita. `last_online` mudou de significado para essas
//          máquinas — e nenhuma tela ficou sabendo.
//   16/09  a lista dizia "Offline · há 10 min" com o técnico conectado dentro.
//          No mesmo dia: lista com janela de 7 min, dashboard com 5, e a visão
//          em cartões sem o selo "Sem status".
//
// Não era descuido: enquanto mais de um lugar respondesse "esta máquina está
// online?", a próxima otimização de banco desencontrava as respostas de novo.
//
// SE VOCÊ VEIO AQUI PARA MEXER NA JANELA: ela está em
// `private.presenca_config`. Trocar lá vale para o painel inteiro de uma vez,
// sem deploy. E existe uma sonda (`private.presenca_saude`) medindo a cadência
// real do agente contra a janela configurada, justamente para avisar quando uma
// ficar apertada para a outra.

/** Os valores de `v_dispositivo_status.status_presenca`. */
export type StatusDispositivo =
  | "inativo"
  | "atendimento"
  | "online"
  | "sem_status"
  | "offline";

/**
 * Texto do `title` do selo "Sem status", por motivo do descarte.
 *
 * Isto é redação, não regra — por isso continua no painel. O servidor descarta
 * o `presence` por dois caminhos, e o operador precisa saber qual é o dele: um
 * se resolve reinstalando o agente, o outro é decisão de cadastro.
 */
export function tituloSemStatus(d: { agent_version: string | null }): string {
  if (!d.agent_version) {
    return "Esta máquina roda uma versão que não reporta status. Ela pode estar ligada — o AcessoFast continua acessando normalmente.";
  }
  return "O servidor está descartando o sinal de presença desta máquina (marcada no cadastro). Ela pode estar ligada — o AcessoFast continua acessando normalmente.";
}
