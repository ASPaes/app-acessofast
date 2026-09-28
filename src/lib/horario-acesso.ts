// Horario de acesso por empresa (migration 20260928120000).
//
// Quem decide se esta fora do horario e o banco (view v_horario_acesso), nao este
// arquivo: a connect-device le a mesma view, e duas contas de fuso — uma no navegador,
// outra no servidor — acabariam discordando justo na virada do horario. Aqui ficam so
// o formato, a validacao do formulario (espelho do CHECK da coluna) e os textos.

/** Um dia: fechado (null) ou janela [inicio, fim) em "HH:MM"; fim "24:00" = meia-noite. */
export type JanelaDia = { inicio: string; fim: string } | null;

/** 7 posicoes, indice = dia da semana do JS e do Postgres (0 = domingo). */
export type HorarioSemana = JanelaDia[];

const EXPEDIENTE = { inicio: "08:00", fim: "18:00" };

/** O mesmo padrao da coluna: segunda a sexta, 08:00 as 18:00. */
export const HORARIO_PADRAO: HorarioSemana = [
  null,
  EXPEDIENTE,
  EXPEDIENTE,
  EXPEDIENTE,
  EXPEDIENTE,
  EXPEDIENTE,
  null,
];

/** Ordem de exibicao: a semana de trabalho comeca na segunda. */
export const DIAS: { indice: number; nome: string }[] = [
  { indice: 1, nome: "Segunda" },
  { indice: 2, nome: "Terça" },
  { indice: 3, nome: "Quarta" },
  { indice: 4, nome: "Quinta" },
  { indice: 5, nome: "Sexta" },
  { indice: 6, nome: "Sábado" },
  { indice: 0, nome: "Domingo" },
];

export const FUSO_PADRAO = "America/Sao_Paulo";

export const FUSOS: { valor: string; rotulo: string }[] = [
  { valor: "America/Sao_Paulo", rotulo: "Brasília (UTC−3)" },
  { valor: "America/Manaus", rotulo: "Amazonas, Mato Grosso, Rondônia e Roraima (UTC−4)" },
  { valor: "America/Rio_Branco", rotulo: "Acre (UTC−5)" },
  { valor: "America/Noronha", rotulo: "Fernando de Noronha (UTC−2)" },
];

/**
 * Quem conecta pelo painel mesmo fora do horario. Mesma lista da connect-device e da
 * horario_acesso_corte no banco — a regra e para o tecnico. No acesso direto pelo
 * programa ninguem escapa: la o servidor nao sabe quem esta do outro lado.
 */
export const PAPEIS_ISENTOS_DO_HORARIO: readonly string[] = ["super_admin", "admin"];

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** "HH:MM" -> minutos desde a meia-noite; "24:00" -> 1440; resto -> null. */
export function minutos(hhmm: string): number | null {
  if (HHMM.test(hhmm)) return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  if (hhmm === "24:00") return 1440;
  return null;
}

/**
 * O campo de hora do navegador nao aceita "24:00". No FIM da janela, "00:00" so pode
 * querer dizer a meia-noite do fim do dia — e e assim que ele vai para o banco.
 */
export function fimParaBanco(fim: string): string {
  return fim === "00:00" ? "24:00" : fim;
}

export function fimParaCampo(fim: string): string {
  return fim === "24:00" ? "00:00" : fim;
}

/**
 * Mesma regra do CHECK tenant_settings_horario_acesso_valido, com a mensagem do
 * primeiro problema (ou null). Conferir aqui evita mandar ao banco algo que ele vai
 * recusar com um erro de constraint que nao diz qual dia esta errado.
 */
export function problemaNoHorario(semana: HorarioSemana): string | null {
  if (semana.length !== 7) return "Horário incompleto.";
  for (const { indice, nome } of DIAS) {
    const dia = semana[indice];
    if (!dia) continue;
    const ini = minutos(dia.inicio);
    const fim = minutos(dia.fim);
    if (ini === null || fim === null) return `${nome}: preencha o início e o fim.`;
    if (ini >= fim) {
      return `${nome}: o fim precisa ser depois do início. Janela que passa da meia-noite ainda não é aceita.`;
    }
  }
  return null;
}

function comFuso<T>(fuso: string, formatar: (tz: string) => T): T {
  try {
    return formatar(fuso || FUSO_PADRAO);
  } catch {
    // Fuso que o navegador nao conhece: o banco cai no de Sao Paulo, a tela tambem.
    return formatar(FUSO_PADRAO);
  }
}

/** Instante no fuso da empresa: "hoje às 08:00", "amanhã às 08:00" ou "seg., 05/10 às 08:00". */
export function quandoNoFuso(iso: string, fuso: string, agora: Date = new Date()): string {
  return comFuso(fuso, (tz) => {
    const alvo = new Date(iso);
    const dia = (d: Date) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d);
    const hora = new Intl.DateTimeFormat("pt-BR", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
    }).format(alvo);
    if (dia(alvo) === dia(agora)) return `hoje às ${hora}`;
    if (dia(alvo) === dia(new Date(agora.getTime() + 86_400_000))) return `amanhã às ${hora}`;
    const data = new Intl.DateTimeFormat("pt-BR", {
      timeZone: tz,
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
    }).format(alvo);
    return `${data} às ${hora}`;
  });
}

/** Linha da view v_horario_acesso: a situacao de AGORA de uma empresa. */
export type SituacaoHorario = {
  tenant_id: string;
  ativo: boolean;
  fora: boolean;
  fecha_em: string | null;
  abre_em: string | null;
  timezone: string;
};

/** Frase curta para quem foi barrado: diz quando volta, que e o que a pessoa quer saber. */
export function textoForaDoHorario(
  s: Pick<SituacaoHorario, "abre_em" | "timezone"> | null | undefined,
): string {
  if (!s?.abre_em) return "Fora do horário de acesso da empresa.";
  return `Fora do horário de acesso da empresa. Libera ${quandoNoFuso(s.abre_em, s.timezone)}.`;
}
