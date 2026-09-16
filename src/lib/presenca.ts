// Janela de presença — quanto tempo sem sinal até um dispositivo virar "Offline".
//
// O agente carimba `address_book.last_online` em TODO evento autenticado, e quando
// está ocioso o único evento é o `presence`. Ou seja: esta janela precisa ser maior
// que a cadência do `presence`, senão a máquina pisca offline entre dois batimentos
// e a frota inteira aparece morta no painel.
//
// ORDEM DE IMPLANTAÇÃO (importa): esta constante sobe ANTES de o agente afrouxar o
// `presence`. Alargar a janela é compatível com agente antigo — ele só bate mais
// vezes do que o necessário. Encurtar depois não é. Durante a rodada de bootstrap a
// frota fica misturada (agente a 60s e a 180s ao mesmo tempo), e a janela larga
// atende os dois.
//
// Dimensionamento: `presence` a 180s, com folga para dois batimentos perdidos mais
// atraso de rede. O preço é honesto e conhecido: uma máquina que morre continua
// aparecendo online por até 7 minutos, em vez de 2. Para uma ferramenta de suporte
// isso é aceitável — quem descobre a máquina morta é quem tenta conectar nela.
export const JANELA_ONLINE_MS = 7 * 60 * 1000;

/** Instante a partir do qual `last_online` ainda conta como "online agora". */
export function limiteOnlineISO(): string {
  return new Date(Date.now() - JANELA_ONLINE_MS).toISOString();
}

// ---------------------------------------------------------------------------
// Status de presença — UMA decisão, um lugar.
//
// Esta regra já quebrou várias vezes porque vivia copiada dentro do JSX, em
// telas diferentes, e cada correção pegava só uma das cópias. Em 16/09/2026 a
// lista dizia "Offline · há 10 min" para máquina ligada, com o técnico
// conectado nela. Quem mexer daqui pra frente mexe AQUI.
//
// O ponto que sempre escapa: `last_online` NÃO é um sinal universal. O
// `session-ingest` descarta o `presence` de parte da frota (sem gravar nada,
// para poupar escrita no banco), e nessas máquinas o carimbo só anda durante
// uma sessão — congela no mesmo segundo em que a sessão fecha. Ler esse
// carimbo velho como "offline" é afirmar o que não se sabe: a máquina continua
// ligada e acessível, só não fala mais com o servidor quando está ociosa.
//
// São DOIS motivos de descarte, e é preciso olhar os dois:
//   1. `ignorar_presenca = true` na linha — marca no cadastro, decidida no
//      banco (guarda do session-ingest depois da autenticação).
//   2. `agent_version` nula — binário anterior a 10/08/2026, barrado antes de
//      qualquer consulta pela guarda de descarte antecipado.
// Usar só (2) como proxy de (1) é exatamente o bug de 16/09: as máquinas
// marcadas no cadastro QUE REPORTAM VERSÃO caíam no ramo de "offline".

/** O que o painel precisa saber de um dispositivo para decidir presença. */
export type SinaisDePresenca = {
  last_online: string | null;
  agent_version: string | null;
  ignorar_presenca?: boolean | null;
};

export type StatusDispositivo =
  | "inativo"
  | "atendimento"
  | "online"
  | "sem_status"
  | "offline";

/**
 * true quando o servidor descarta o `presence` desta máquina — ou seja, quando
 * `last_online` não serve para dizer se ela está ligada agora.
 */
export function presencaSilenciada(d: SinaisDePresenca): boolean {
  return d.ignorar_presenca === true || !d.agent_version;
}

/**
 * Status de um dispositivo na lista. `emAtendimento` e `online` vêm de fora
 * porque são fatos de outras consultas (sessão aberta; `last_online` dentro da
 * janela) — aqui fica só a ordem de precedência, que é o que costuma quebrar.
 *
 * Por que "sem_status" vem ANTES de "online": numa máquina silenciada o
 * carimbo fresco é resto da sessão que acabou de fechar, não prova de máquina
 * ociosa e viva. Deixar "online" na frente faria ela piscar Online por alguns
 * minutos depois de cada atendimento e só então sumir.
 *
 * Por que "atendimento" vem antes de tudo: sessão é prova direta, e os eventos
 * de sessão (`start`/`heartbeat`/`end`) nunca são descartados.
 */
export function statusDispositivo(
  d: SinaisDePresenca & { is_active?: boolean | null },
  ctx: { emAtendimento: boolean; online: boolean },
): StatusDispositivo {
  if (d.is_active === false) return "inativo";
  if (ctx.emAtendimento) return "atendimento";
  if (presencaSilenciada(d)) return "sem_status";
  return ctx.online ? "online" : "offline";
}

/** Texto do `title` do selo "Sem status", por motivo do descarte. */
export function tituloSemStatus(d: SinaisDePresenca): string {
  if (!d.agent_version) {
    return "Esta máquina roda uma versão que não reporta status. Ela pode estar ligada — o AcessoFast continua acessando normalmente.";
  }
  return "O servidor está descartando o sinal de presença desta máquina (marcada no cadastro). Ela pode estar ligada — o AcessoFast continua acessando normalmente.";
}
