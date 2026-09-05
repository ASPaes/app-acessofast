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
