// Roteiro do tour de primeiro acesso. Cada passo aponta para um elemento real da
// interface (atributo data-tour) e, quando tem rota, o tour navega até a tela
// antes de destacar — o usuário vê o painel de verdade por trás do balão.

export type TourRole = "super_admin" | "admin" | "head" | "tech";

export type TourRoute =
  | "/dashboard"
  | "/dispositivos"
  | "/clientes"
  | "/auditoria"
  | "/usuarios"
  | "/monitoramento"
  | "/financeiro"
  | "/configuracoes"
  | "/empresas"
  | "/planos";

export type TourStep = {
  id: string;
  /** valor do atributo data-tour do alvo; null = passo central, sem spotlight */
  target: string | null;
  /** rota aberta antes do passo; null = mantém a tela atual */
  route: TourRoute | null;
  title: string;
  body: string;
  /** ausente = passo vale para todos os papéis */
  roles?: TourRole[];
  /**
   * Passo de mão na massa: o overlay deixa de capturar cliques e o usuário opera
   * o painel de verdade. O tour espera a ação acontecer antes de liberar o
   * "Próximo" — ver `feito` em onboarding-tour.tsx.
   */
  interativo?: boolean;
};

const PASSOS: TourStep[] = [
  {
    id: "dashboard",
    target: "nav:/dashboard",
    route: "/dashboard",
    title: "Visão geral",
    body: "É a tela que abre quando você entra. Mostra quantos dispositivos e usuários existem, o que está conectado agora e o movimento das últimas 24 horas.",
  },
  {
    id: "dispositivos",
    target: "nav:/dispositivos",
    route: "/dispositivos",
    title: "Dispositivos",
    body: "Os endpoints AcessoFast do seu address book. É daqui que sai o atendimento: procure a máquina, use favoritos e marcadores para achar rápido e clique em Conectar para abrir a sessão remota.",
  },
  {
    id: "cadastrar-dispositivo",
    target: "add-device",
    route: "/dispositivos",
    title: "Cadastre seu computador",
    body: "Vamos fazer junto, é o passo que mais importa. Abra o AcessoFast neste computador, copie o ID que aparece na tela do programa e cadastre aqui — é assim que toda máquina entra no address book. Começar pela sua deixa você testar uma conexão sem depender de cliente.",
    interativo: true,
  },
  {
    id: "clientes",
    target: "nav:/clientes",
    route: "/clientes",
    title: "Clientes",
    body: "Cadastre cada empresa que você atende e vincule os dispositivos dela. É o que transforma uma lista de máquinas soltas em “as três máquinas da padaria do João”.",
  },
  {
    id: "auditoria",
    target: "nav:/auditoria",
    route: "/auditoria",
    title: "Auditoria",
    body: "O registro de todas as sessões de suporte: quem conectou, em qual máquina e quando. É append-only — nenhum técnico apaga um log, nem você.",
  },
  {
    id: "usuarios",
    target: "nav:/usuarios",
    route: "/usuarios",
    title: "Usuários",
    body: "Os membros do painel. O administrador da conta convida os técnicos e define o papel de cada um, que é o que decide o que cada pessoa enxerga aqui dentro.",
  },
  {
    id: "financeiro",
    target: "nav:/financeiro",
    route: "/financeiro",
    title: "Financeiro",
    body: "Plano, faturas e consumo da empresa. Dá para acompanhar quanto do pacote já foi usado antes de a conta apertar.",
  },
  {
    id: "monitoramento",
    target: "nav:/monitoramento",
    route: "/monitoramento",
    title: "Monitoramento",
    body: "Sessões em andamento, agentes instalados e acessos externos. Antes de abrir um chamado achando que “o AcessoFast caiu”, é aqui que você confere.",
  },
  {
    id: "configuracoes",
    target: "nav:/configuracoes",
    route: "/configuracoes",
    title: "Configurações",
    body: "Preferências operacionais da sua empresa: fuso horário, retenção de logs e alertas.",
  },
  {
    id: "empresas",
    target: "nav:/empresas",
    route: "/empresas",
    title: "Empresas",
    body: "Todas as empresas da plataforma, com provisionamento de novos tenants e o estado de cobrança de cada uma.",
    roles: ["super_admin"],
  },
  {
    id: "planos",
    target: "nav:/planos",
    route: "/planos",
    title: "Planos",
    body: "Catálogo de planos: limites de usuários, sessões simultâneas e preços que valem para todas as empresas.",
    roles: ["super_admin"],
  },
  {
    id: "conta",
    target: "user-menu",
    route: null,
    title: "Sua conta",
    body: "Trocar a senha, mudar o tema e sair do painel ficam aqui neste canto.",
  },
  {
    id: "fim",
    target: null,
    route: "/dashboard",
    title: "Pronto, é isso",
    body: "Você já sabe onde fica cada coisa. Este passo a passo não vai mais aparecer nos próximos logins — se travar em algo, fale com o administrador da sua conta.",
  },
];

export function passosParaPapel(role: TourRole): TourStep[] {
  return PASSOS.filter((passo) => !passo.roles || passo.roles.includes(role));
}
