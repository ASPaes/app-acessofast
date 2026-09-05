// Presenca de dispositivo: quanto tempo sem sinal ate considerar uma maquina
// offline no painel.
//
// A regra tem UMA amarra que nao pode ser quebrada: esta janela precisa ser
// MAIOR que o intervalo com que o agente manda "presence". Ate 05/09/2026 nao
// era — a janela valia 120s e o agente mandava de 180 em 180s (presenceInterval,
// em main.go do agente). Toda maquina ligada, inclusive as saudaveis, aparecia
// offline por ~1 minuto a cada 3. Nao era atraso de atualizacao: era status
// errado o tempo todo, na frota inteira, e foi disso que um parceiro reclamou.
//
// 7 minutos = dois ciclos de presence (360s) mais folga para uma rede ruim
// engolir um sinal. Uma maquina so e dada como offline depois de PERDER dois
// sinais seguidos, o que e evidencia de verdade — nao o vao normal entre dois
// batimentos.
//
// Se o intervalo do agente mudar, este numero muda junto. Manter a relacao
// "janela > 2x intervalo" e o que impede o status de voltar a piscar.
export const JANELA_ONLINE_MS = 7 * 60 * 1000;

/** Uma maquina esta online se deu sinal dentro da janela. */
export function estaOnline(lastOnline: string | null | undefined): boolean {
  if (!lastOnline) return false;
  return Date.now() - new Date(lastOnline).getTime() < JANELA_ONLINE_MS;
}

/** Corte ISO para consultar o banco: `.gt("last_online", limiteOnlineISO())`. */
export function limiteOnlineISO(): string {
  return new Date(Date.now() - JANELA_ONLINE_MS).toISOString();
}
