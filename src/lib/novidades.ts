// ---------------------------------------------------------------------------
// Notas de atualizacao do AcessoFast ("Novidades", no topo do painel).
//
// POR QUE AQUI, E NAO NUMA TABELA: a nota entra no MESMO commit da funcionalidade.
// O cliente ve a nota exatamente quando o Lovable publica o que ela anuncia — nem
// antes (nota de algo que ainda nao existe), nem depois (recurso sem aviso).
//
// REGRA: toda mudanca que o usuario percebe, ao entrar na main, ganha uma entrada
// aqui, no topo da lista. Texto para o cliente: o que mudou e onde encontrar, sem
// nome de tabela, funcao ou servidor. Correcao interna que ninguem ve nao entra.
//
// `para` limita quem ve a nota:
//   todos       qualquer usuario de empresa (e a plataforma)
//   admin       administrador da empresa (e a plataforma) — telas que o tecnico nao tem
//   plataforma  so a equipe AcessoFast (super_admin)
// ---------------------------------------------------------------------------

export type TipoNovidade = "novo" | "melhoria" | "correcao";
export type PublicoNovidade = "todos" | "admin" | "plataforma";

export type Novidade = {
  /** Dia em que foi publicado, AAAA-MM-DD. */
  data: string;
  tipo: TipoNovidade;
  titulo: string;
  descricao: string;
  para: PublicoNovidade;
};

export const NOVIDADES: Novidade[] = [
  {
    data: "2026-09-29",
    tipo: "novo",
    titulo: "Novidades do AcessoFast",
    descricao:
      "Esta tela. Tudo o que for lançado no AcessoFast aparece aqui, no dia em que entrar no ar. Quando houver algo que você ainda não viu, o botão Novidades ganha um ponto azul.",
    para: "todos",
  },
  {
    data: "2026-09-29",
    tipo: "novo",
    titulo: "Caixa de sugestões",
    descricao:
      "Mande ideias para a equipe do AcessoFast pelo botão Sugestão, no topo do painel. Na aba Enviadas você acompanha o andamento de cada uma e lê a resposta da equipe.",
    para: "todos",
  },
  {
    data: "2026-09-29",
    tipo: "novo",
    titulo: "Triagem das sugestões",
    descricao:
      "Em Plataforma › Sugestões, a equipe lê o que todas as empresas mandaram, muda o status e responde. O menu mostra quantas sugestões novas estão esperando.",
    para: "plataforma",
  },
  {
    data: "2026-09-29",
    tipo: "novo",
    titulo: "Marcadores na janela de atendimento do DoctorSaaS",
    descricao:
      "Na janela aberta pelo DoctorSaaS, cada máquina mostra os marcadores que já tem, e dá para marcar, desmarcar ou criar um marcador ali mesmo. A busca em Ver todas as máquinas também encontra pelo marcador.",
    para: "todos",
  },
  {
    data: "2026-09-28",
    tipo: "novo",
    titulo: "Horário de acesso da empresa",
    descricao:
      "Em Configurações, defina os dias e horários em que os técnicos podem conectar nas máquinas da empresa. Fora do horário, o acesso é barrado, inclusive direto pelo programa AcessoFast. Você escolhe se quem já estava conectado termina o atendimento ou cai na hora. Toda tentativa barrada fica registrada na Auditoria.",
    para: "admin",
  },
  {
    data: "2026-09-18",
    tipo: "correcao",
    titulo: "Status das máquinas mais confiável",
    descricao:
      "O status online ou offline de cada máquina passou a ser decidido num lugar só, e todas as telas mostram a mesma coisa. Acabou o caso de máquina ligada, com técnico conectado, aparecendo como offline.",
    para: "todos",
  },
  {
    data: "2026-08-25",
    tipo: "novo",
    titulo: "Baixar agente no topo do painel",
    descricao:
      "O botão Baixar agente, no canto superior direito, abre a página de download em outra aba. Você manda o link para o cliente sem sair do atendimento.",
    para: "todos",
  },
  {
    data: "2026-08-24",
    tipo: "novo",
    titulo: "Troca de papel dos usuários",
    descricao:
      "Em Usuários, passe o mouse na coluna Papel e clique no lápis para promover ou rebaixar alguém da equipe, sem precisar pedir ao suporte.",
    para: "admin",
  },
  {
    data: "2026-08-21",
    tipo: "melhoria",
    titulo: "Janela do DoctorSaaS: contato sem empresa e cadastro de computador",
    descricao:
      "Quem atende número avulso agora tem duas saídas: Não é empresa, que cadastra o contato só com o nome, ou Ver todas as máquinas, que não grava nada. E dá para cadastrar um computador pelo ID sem sair da janela.",
    para: "todos",
  },
  {
    data: "2026-08-20",
    tipo: "novo",
    titulo: "Integração com o DoctorSaaS",
    descricao:
      "Em Integrações, gere a chave da sua empresa para ligar o AcessoFast ao DoctorSaaS. Com ela, o técnico abre o acesso remoto direto da conversa com o cliente.",
    para: "admin",
  },
  {
    data: "2026-08-19",
    tipo: "melhoria",
    titulo: "Duração dos atendimentos mais fácil de ler",
    descricao:
      "Na Visão geral, a duração mediana deu lugar à duração média, ao lado do P90, que mostra onde estão os atendimentos mais demorados.",
    para: "todos",
  },
];

export function podeVer(para: PublicoNovidade, role: string | null | undefined) {
  if (role === "super_admin") return true;
  if (para === "todos") return true;
  if (para === "admin") return role === "admin";
  return false;
}

// Ultima nota que a pessoa ja viu, por usuario e por navegador. E conveniencia (o
// ponto azul), nao registro: se o navegador perder, o pior caso e o ponto voltar.
const CHAVE_VISTO = (uid: string) => `acessofast:novidades-visto:${uid}`;

export function lerVisto(uid: string): string | null {
  try {
    return localStorage.getItem(CHAVE_VISTO(uid));
  } catch {
    return null;
  }
}

export function marcarVisto(uid: string, chave: string) {
  try {
    localStorage.setItem(CHAVE_VISTO(uid), chave);
  } catch {
    // navegador sem armazenamento: o ponto so volta a aparecer
  }
}
