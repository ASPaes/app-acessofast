/**
 * Dados simulados do preview.
 * ---------------------------------------------------------------------------
 * NÃO há conexão com Supabase, API, banco ou relay. Tudo aqui é estático e
 * local, só para dar volume realista às telas.
 *
 * Os campos espelham exatamente os que o painel real já exibe hoje
 * (address_book, clients, tenants, profiles, connection_logs, credit_ledger,
 * plans, vps_metrics, v_agent_health, v_sessions_summary, v_external_access).
 * Nenhum campo, métrica ou recurso novo foi inventado.
 */

export type Papel = "super_admin" | "admin" | "head" | "tech";

export const ROTULO_PAPEL: Record<Papel, string> = {
  super_admin: "Super Admin",
  admin: "Administrador",
  head: "Supervisor",
  tech: "Técnico",
};

export type StatusDispositivo = "online" | "atendimento" | "offline" | "inativo";

export type Marcador = { id: string; label: string; cor: MarcadorCor };
export type MarcadorCor = "azul" | "verde" | "ambar" | "vermelho" | "violeta" | "cinza";

export type Consumo = {
  fonte: "free" | "credit" | "plan";
  /** milissegundos restantes na janela do atendimento */
  restanteMs: number;
};

export type Dispositivo = {
  id: string;
  rustdesk_id: string;
  alias: string | null;
  cliente: { nome: string; documento: string | null; tipo: "cnpj" | "cpf" | null } | null;
  device_group: string | null;
  os: string | null;
  empresa: string;
  status: StatusDispositivo;
  last_online: string | null;
  favorito: boolean;
  marcadores: string[];
  ativo: boolean;
  consumo: Consumo | null;
};

export const MARCADORES: Marcador[] = [
  { id: "m1", label: "Servidor", cor: "vermelho" },
  { id: "m2", label: "Caixa/PDV", cor: "ambar" },
  { id: "m3", label: "Financeiro", cor: "verde" },
  { id: "m4", label: "Notebook", cor: "azul" },
  { id: "m5", label: "Fora de garantia", cor: "cinza" },
  { id: "m6", label: "Crítico", cor: "violeta" },
];

const agora = Date.now();
const min = (n: number) => new Date(agora - n * 60_000).toISOString();
const hrs = (n: number) => new Date(agora - n * 3_600_000).toISOString();
const dias = (n: number) => new Date(agora - n * 86_400_000).toISOString();
const emDias = (n: number) => new Date(agora + n * 86_400_000).toISOString();

export const DISPOSITIVOS: Dispositivo[] = [
  {
    id: "d1",
    rustdesk_id: "418 902 337",
    alias: "PDV-CAIXA-01",
    cliente: { nome: "Padaria São Jorge", documento: "18452399000174", tipo: "cnpj" },
    device_group: "Padaria São Jorge",
    os: "Windows 11 Pro",
    empresa: "NorteTI Suporte",
    status: "atendimento",
    last_online: min(0),
    favorito: true,
    marcadores: ["m2", "m6"],
    ativo: true,
    consumo: { fonte: "credit", restanteMs: 74 * 60_000 },
  },
  {
    id: "d2",
    rustdesk_id: "902 114 780",
    alias: "SRV-FISCAL",
    cliente: { nome: "Padaria São Jorge", documento: "18452399000174", tipo: "cnpj" },
    device_group: "Padaria São Jorge",
    os: "Windows Server 2019",
    empresa: "NorteTI Suporte",
    status: "online",
    last_online: min(1),
    favorito: true,
    marcadores: ["m1", "m6"],
    ativo: true,
    consumo: null,
  },
  {
    id: "d3",
    rustdesk_id: "233 761 004",
    alias: "RECEPCAO-01",
    cliente: { nome: "Clínica Vitalis", documento: "27110844000109", tipo: "cnpj" },
    device_group: "Clínica Vitalis",
    os: "Windows 10 Pro",
    empresa: "NorteTI Suporte",
    status: "online",
    last_online: min(2),
    favorito: false,
    marcadores: ["m4"],
    ativo: true,
    consumo: null,
  },
  {
    id: "d4",
    rustdesk_id: "551 038 926",
    alias: "CONSULTORIO-3",
    cliente: { nome: "Clínica Vitalis", documento: "27110844000109", tipo: "cnpj" },
    device_group: "Clínica Vitalis",
    os: "Windows 11 Home",
    empresa: "NorteTI Suporte",
    status: "atendimento",
    last_online: min(0),
    favorito: false,
    marcadores: [],
    ativo: true,
    consumo: { fonte: "free", restanteMs: 21 * 60_000 + 40_000 },
  },
  {
    id: "d5",
    rustdesk_id: "776 420 118",
    alias: "ESCRITORIO-CONTAB",
    cliente: { nome: "Contabilidade Mendes", documento: "09338217000155", tipo: "cnpj" },
    device_group: "Contabilidade Mendes",
    os: "Windows 11 Pro",
    empresa: "NorteTI Suporte",
    status: "offline",
    last_online: hrs(6),
    favorito: false,
    marcadores: ["m3"],
    ativo: true,
    consumo: null,
  },
  {
    id: "d6",
    rustdesk_id: "144 907 553",
    alias: "NOTE-DIRETORIA",
    cliente: { nome: "Contabilidade Mendes", documento: "09338217000155", tipo: "cnpj" },
    device_group: "Contabilidade Mendes",
    os: "Windows 11 Pro",
    empresa: "NorteTI Suporte",
    status: "offline",
    last_online: dias(2),
    favorito: false,
    marcadores: ["m4", "m5"],
    ativo: true,
    consumo: null,
  },
  {
    id: "d7",
    rustdesk_id: "620 355 291",
    alias: "SRV-BACKUP",
    cliente: { nome: "Transportes Aurora", documento: "41902663000188", tipo: "cnpj" },
    device_group: "Transportes Aurora",
    os: "Ubuntu 22.04 LTS",
    empresa: "Meridian Sistemas",
    status: "online",
    last_online: min(1),
    favorito: true,
    marcadores: ["m1"],
    ativo: true,
    consumo: null,
  },
  {
    id: "d8",
    rustdesk_id: "308 774 165",
    alias: "BALANCA-EXPEDICAO",
    cliente: { nome: "Transportes Aurora", documento: "41902663000188", tipo: "cnpj" },
    device_group: "Transportes Aurora",
    os: "Windows 10 IoT",
    empresa: "Meridian Sistemas",
    status: "offline",
    last_online: hrs(29),
    favorito: false,
    marcadores: ["m5"],
    ativo: true,
    consumo: null,
  },
  {
    id: "d9",
    rustdesk_id: "957 201 640",
    alias: "PDV-CAIXA-02",
    cliente: { nome: "Mercado Bom Preço", documento: "33875110000162", tipo: "cnpj" },
    device_group: "Mercado Bom Preço",
    os: "Windows 10 Pro",
    empresa: "Meridian Sistemas",
    status: "online",
    last_online: min(3),
    favorito: false,
    marcadores: ["m2"],
    ativo: true,
    consumo: null,
  },
  {
    id: "d10",
    rustdesk_id: "482 663 907",
    alias: "PDV-CAIXA-03",
    cliente: { nome: "Mercado Bom Preço", documento: "33875110000162", tipo: "cnpj" },
    device_group: "Mercado Bom Preço",
    os: "Windows 10 Pro",
    empresa: "Meridian Sistemas",
    status: "inativo",
    last_online: dias(41),
    favorito: false,
    marcadores: ["m2", "m5"],
    ativo: false,
    consumo: null,
  },
  {
    id: "d11",
    rustdesk_id: "716 049 332",
    alias: "TOTEM-ATENDIMENTO",
    cliente: null,
    device_group: null,
    os: "Windows 11 Pro",
    empresa: "Meridian Sistemas",
    status: "offline",
    last_online: hrs(11),
    favorito: false,
    marcadores: [],
    ativo: true,
    consumo: null,
  },
  {
    id: "d12",
    rustdesk_id: "205 918 447",
    alias: "MAC-DESIGN",
    cliente: { nome: "Estúdio Cadenza", documento: "51204778000130", tipo: "cnpj" },
    device_group: "Estúdio Cadenza",
    os: "macOS 15",
    empresa: "Vega Tecnologia",
    status: "online",
    last_online: min(4),
    favorito: false,
    marcadores: ["m4"],
    ativo: true,
    consumo: null,
  },
  {
    id: "d13",
    rustdesk_id: "884 130 205",
    alias: "SRV-ERP",
    cliente: { nome: "Estúdio Cadenza", documento: "51204778000130", tipo: "cnpj" },
    device_group: "Estúdio Cadenza",
    os: "Windows Server 2022",
    empresa: "Vega Tecnologia",
    status: "offline",
    last_online: hrs(2),
    favorito: false,
    marcadores: ["m1", "m6"],
    ativo: true,
    consumo: null,
  },
  {
    id: "d14",
    rustdesk_id: "367 552 810",
    alias: null,
    cliente: { nome: "Oficina Duarte", documento: "84012399000191", tipo: "cnpj" },
    device_group: "Oficina Duarte",
    os: null,
    empresa: "Vega Tecnologia",
    status: "offline",
    last_online: null,
    favorito: false,
    marcadores: [],
    ativo: true,
    consumo: null,
  },
];

export const EMPRESAS_SELECT = ["NorteTI Suporte", "Meridian Sistemas", "Vega Tecnologia"];

/* -------------------------------------------------------------------------- */

export type Cliente = {
  id: string;
  nome: string;
  documento: string | null;
  tipo: "cnpj" | "cpf" | null;
  dispositivos: number;
  ativo: boolean;
};

export const CLIENTES: Cliente[] = [
  {
    id: "c1",
    nome: "Clínica Vitalis",
    documento: "27110844000109",
    tipo: "cnpj",
    dispositivos: 2,
    ativo: true,
  },
  {
    id: "c2",
    nome: "Contabilidade Mendes",
    documento: "09338217000155",
    tipo: "cnpj",
    dispositivos: 2,
    ativo: true,
  },
  {
    id: "c3",
    nome: "Estúdio Cadenza",
    documento: "51204778000130",
    tipo: "cnpj",
    dispositivos: 2,
    ativo: true,
  },
  {
    id: "c4",
    nome: "Mercado Bom Preço",
    documento: "33875110000162",
    tipo: "cnpj",
    dispositivos: 2,
    ativo: true,
  },
  {
    id: "c5",
    nome: "Oficina Duarte",
    documento: "84012399000191",
    tipo: "cnpj",
    dispositivos: 1,
    ativo: true,
  },
  {
    id: "c6",
    nome: "Padaria São Jorge",
    documento: "18452399000174",
    tipo: "cnpj",
    dispositivos: 2,
    ativo: true,
  },
  {
    id: "c7",
    nome: "Ricardo Salles ME",
    documento: "34877190201",
    tipo: "cpf",
    dispositivos: 0,
    ativo: true,
  },
  {
    id: "c8",
    nome: "Transportes Aurora",
    documento: "41902663000188",
    tipo: "cnpj",
    dispositivos: 2,
    ativo: true,
  },
];

/* -------------------------------------------------------------------------- */

export type Sessao = {
  id: string;
  rustdesk_id: string;
  tecnico: string | null;
  status: "active" | "ended" | "failed";
  inicio: string;
  duracao: number | null;
  ip: string | null;
};

export const SESSOES: Sessao[] = [
  {
    id: "s1",
    rustdesk_id: "418 902 337",
    tecnico: "marina.reis@norteti.com.br",
    status: "active",
    inicio: min(46),
    duracao: null,
    ip: "189.44.207.12",
  },
  {
    id: "s2",
    rustdesk_id: "551 038 926",
    tecnico: "joao.pires@norteti.com.br",
    status: "active",
    inicio: min(19),
    duracao: null,
    ip: "189.44.207.31",
  },
  {
    id: "s3",
    rustdesk_id: "418 902 337",
    tecnico: "marina.reis@norteti.com.br",
    status: "ended",
    inicio: hrs(4),
    duracao: 1_842,
    ip: "189.44.207.12",
  },
  {
    id: "s4",
    rustdesk_id: "902 114 780",
    tecnico: "joao.pires@norteti.com.br",
    status: "ended",
    inicio: hrs(5),
    duracao: 620,
    ip: "189.44.207.31",
  },
  {
    id: "s5",
    rustdesk_id: "233 761 004",
    tecnico: "marina.reis@norteti.com.br",
    status: "ended",
    inicio: hrs(7),
    duracao: 3_310,
    ip: "189.44.207.12",
  },
  {
    id: "s6",
    rustdesk_id: "776 420 118",
    tecnico: "carla.nunes@norteti.com.br",
    status: "failed",
    inicio: hrs(9),
    duracao: null,
    ip: "177.90.13.204",
  },
  {
    id: "s7",
    rustdesk_id: "957 201 640",
    tecnico: "carla.nunes@norteti.com.br",
    status: "ended",
    inicio: hrs(22),
    duracao: 985,
    ip: "177.90.13.204",
  },
  {
    id: "s8",
    rustdesk_id: "620 355 291",
    tecnico: "joao.pires@norteti.com.br",
    status: "ended",
    inicio: dias(1),
    duracao: 2_450,
    ip: "189.44.207.31",
  },
  {
    id: "s9",
    rustdesk_id: "902 114 780",
    tecnico: "marina.reis@norteti.com.br",
    status: "ended",
    inicio: dias(1),
    duracao: 410,
    ip: "189.44.207.12",
  },
  {
    id: "s10",
    rustdesk_id: "884 130 205",
    tecnico: "carla.nunes@norteti.com.br",
    status: "ended",
    inicio: dias(2),
    duracao: 5_120,
    ip: "177.90.13.204",
  },
  {
    id: "s11",
    rustdesk_id: "233 761 004",
    tecnico: "joao.pires@norteti.com.br",
    status: "ended",
    inicio: dias(2),
    duracao: 760,
    ip: "189.44.207.31",
  },
  {
    id: "s12",
    rustdesk_id: "308 774 165",
    tecnico: "carla.nunes@norteti.com.br",
    status: "failed",
    inicio: dias(3),
    duracao: null,
    ip: "177.90.13.204",
  },
];

/* -------------------------------------------------------------------------- */

export type Usuario = {
  id: string;
  nome: string | null;
  email: string;
  empresa: string | null;
  papel: Papel;
  ativo: boolean;
  criadoEm: string;
};

export const USUARIOS: Usuario[] = [
  {
    id: "u1",
    nome: "Marina Reis",
    email: "marina.reis@norteti.com.br",
    empresa: "NorteTI Suporte",
    papel: "admin",
    ativo: true,
    criadoEm: dias(240),
  },
  {
    id: "u2",
    nome: "João Pires",
    email: "joao.pires@norteti.com.br",
    empresa: "NorteTI Suporte",
    papel: "tech",
    ativo: true,
    criadoEm: dias(180),
  },
  {
    id: "u3",
    nome: "Carla Nunes",
    email: "carla.nunes@norteti.com.br",
    empresa: "NorteTI Suporte",
    papel: "tech",
    ativo: true,
    criadoEm: dias(96),
  },
  {
    id: "u4",
    nome: "Eduardo Lisboa",
    email: "eduardo.lisboa@norteti.com.br",
    empresa: "NorteTI Suporte",
    papel: "head",
    ativo: true,
    criadoEm: dias(88),
  },
  {
    id: "u5",
    nome: "Patrícia Moura",
    email: "patricia.moura@norteti.com.br",
    empresa: "NorteTI Suporte",
    papel: "tech",
    ativo: false,
    criadoEm: dias(62),
  },
  {
    id: "u6",
    nome: "Rafael Kern",
    email: "rafael@meridiansistemas.com.br",
    empresa: "Meridian Sistemas",
    papel: "admin",
    ativo: true,
    criadoEm: dias(150),
  },
  {
    id: "u7",
    nome: "Bianca Souto",
    email: "bianca@vegatec.com.br",
    empresa: "Vega Tecnologia",
    papel: "admin",
    ativo: true,
    criadoEm: dias(45),
  },
  {
    id: "u8",
    nome: "Suporte ASP",
    email: "suporte@aspsoftwares.com.br",
    empresa: null,
    papel: "super_admin",
    ativo: true,
    criadoEm: dias(400),
  },
];

/* -------------------------------------------------------------------------- */

export type Empresa = {
  id: string;
  nome: string;
  membros: number;
  dispositivos: number;
  assentos: number;
  ativa: boolean;
  criadaEm: string;
  plano: string | null;
  simultaneas: number | null;
  simultaneasOverride: boolean;
  billing_mode: "free" | "credits" | "plan";
  billing_status: "active" | "past_due" | "suspended" | "trialing";
};

export const EMPRESAS: Empresa[] = [
  {
    id: "t1",
    nome: "NorteTI Suporte",
    membros: 5,
    dispositivos: 6,
    assentos: 8,
    ativa: true,
    criadaEm: dias(240),
    plano: "Business",
    simultaneas: 3,
    simultaneasOverride: false,
    billing_mode: "plan",
    billing_status: "active",
  },
  {
    id: "t2",
    nome: "Meridian Sistemas",
    membros: 3,
    dispositivos: 5,
    assentos: 3,
    ativa: true,
    criadaEm: dias(150),
    plano: "Team",
    simultaneas: 2,
    simultaneasOverride: true,
    billing_mode: "plan",
    billing_status: "past_due",
  },
  {
    id: "t3",
    nome: "Vega Tecnologia",
    membros: 2,
    dispositivos: 3,
    assentos: 2,
    ativa: true,
    criadaEm: dias(45),
    plano: null,
    simultaneas: null,
    simultaneasOverride: false,
    billing_mode: "credits",
    billing_status: "active",
  },
  {
    id: "t4",
    nome: "Orion Field Services",
    membros: 1,
    dispositivos: 0,
    assentos: 1,
    ativa: false,
    criadaEm: dias(320),
    plano: "Team",
    simultaneas: 2,
    simultaneasOverride: false,
    billing_mode: "plan",
    billing_status: "suspended",
  },
];

/* -------------------------------------------------------------------------- */

export type Plano = {
  code: string;
  nome: string;
  max_users: number | null;
  max_concurrent: number | null;
  ativo: boolean;
  sob_medida: boolean;
  preco_mes: number | null;
  preco_ano: number | null;
};

export const PLANOS: Plano[] = [
  {
    code: "team",
    nome: "Team",
    max_users: 3,
    max_concurrent: 2,
    ativo: true,
    sob_medida: false,
    preco_mes: 14_900,
    preco_ano: 149_000,
  },
  {
    code: "business",
    nome: "Business",
    max_users: 8,
    max_concurrent: 3,
    ativo: true,
    sob_medida: false,
    preco_mes: 29_900,
    preco_ano: 299_000,
  },
  {
    code: "scale",
    nome: "Scale",
    max_users: 20,
    max_concurrent: 6,
    ativo: true,
    sob_medida: false,
    preco_mes: 59_900,
    preco_ano: 599_000,
  },
  {
    code: "enterprise",
    nome: "Enterprise",
    max_users: null,
    max_concurrent: null,
    ativo: true,
    sob_medida: true,
    preco_mes: null,
    preco_ano: null,
  },
];

export const PACOTES_CREDITO = [
  { code: "cr10", creditos: 10, preco_cents: 4_900 },
  { code: "cr25", creditos: 25, preco_cents: 10_900 },
  { code: "cr60", creditos: 60, preco_cents: 23_900 },
  { code: "cr150", creditos: 150, preco_cents: 54_900 },
];

export type LancamentoCredito = {
  id: string;
  criadoEm: string;
  tipo: "purchase" | "consume" | "refund" | "adjust" | "expire";
  creditos: number;
  nota: string | null;
};

export const HISTORICO_CREDITOS: LancamentoCredito[] = [
  { id: "l1", criadoEm: hrs(1), tipo: "consume", creditos: -1, nota: "PDV-CAIXA-01 · atendimento" },
  { id: "l2", criadoEm: hrs(20), tipo: "consume", creditos: -1, nota: "SRV-ERP · atendimento" },
  { id: "l3", criadoEm: dias(2), tipo: "purchase", creditos: 25, nota: "Pacote 25 créditos" },
  {
    id: "l4",
    criadoEm: dias(4),
    tipo: "refund",
    creditos: 1,
    nota: "Falha de conexão — estorno automático",
  },
  { id: "l5", criadoEm: dias(6), tipo: "consume", creditos: -1, nota: "RECEPCAO-01 · atendimento" },
  { id: "l6", criadoEm: dias(9), tipo: "adjust", creditos: 3, nota: "Cortesia do suporte" },
  { id: "l7", criadoEm: dias(21), tipo: "purchase", creditos: 10, nota: "Pacote 10 créditos" },
];

export const CARTEIRA = {
  billing_mode: "credits" as "free" | "credits" | "plan",
  creditos: 34,
  gratisRestante: 3,
  gratisCap: 5,
  planoAtual: "business",
  planoNome: "Business",
  planoExpiraEm: emDias(18),
  emTeste: false,
  faturaUrl: "#",
  status: "active" as "active" | "past_due" | "suspended",
};

/* -------------------------------------------------------------------------- */
/* Monitoramento                                                              */
/* -------------------------------------------------------------------------- */

export const VPS = {
  host: "relay-01.acessofast.net",
  capturado_ha_s: 12,
  ncpu: 4,
  uptime_s: 1_842_311,
  cpu_pct: 23.4,
  cpu_iowait_pct: 0.8,
  cpu_steal_pct: 1.2,
  load1: 0.74,
  load5: 0.61,
  load15: 0.55,
  mem_pct: 47.6,
  mem_total_mb: 7_936,
  mem_available_mb: 4_158,
  swap_used_mb: 128,
  disk_pct: 61,
  disk_used_gb: 47.8,
  disk_total_gb: 78.4,
  net_mbps: 18.42,
  net_rx_mbps: 11.06,
  net_tx_mbps: 7.36,
  sessoes_ativas: 2,
  hbbs_up: true,
  hbbr_up: true,
};

export type PontoSerie = {
  bucket: string;
  cpu_avg: number;
  cpu_max: number;
  steal_avg: number;
  load1_avg: number;
  load1_max: number;
  mem_pct_max: number;
  disk_pct_max: number;
  net_avg_mbps: number;
};

function serie(pontos: number, passoMin: number): PontoSerie[] {
  const out: PontoSerie[] = [];
  for (let i = pontos - 1; i >= 0; i--) {
    const t = agora - i * passoMin * 60_000;
    const onda = Math.sin(i / 4.2) * 0.5 + 0.5;
    const onda2 = Math.sin(i / 9.1 + 1.3) * 0.5 + 0.5;
    out.push({
      bucket: new Date(t).toISOString(),
      cpu_avg: Number((14 + onda * 22).toFixed(2)),
      cpu_max: Number((22 + onda * 34).toFixed(2)),
      steal_avg: Number((0.6 + onda2 * 1.9).toFixed(2)),
      load1_avg: Number((0.4 + onda * 1.1).toFixed(2)),
      load1_max: Number((0.7 + onda * 2.2).toFixed(2)),
      mem_pct_max: Number((42 + onda2 * 14).toFixed(2)),
      disk_pct_max: Number((59 + onda2 * 3).toFixed(2)),
      net_avg_mbps: Number((8 + onda * 24).toFixed(2)),
    });
  }
  return out;
}

export const SERIES = {
  "24h": serie(96, 15),
  "7d": serie(168, 60),
  "30d": serie(240, 180),
};

export type SaudeAgente = {
  dispositivo: string;
  empresa: string;
  sessoes_reais: number;
  falhas: number;
  vivo: boolean;
  ultimo_heartbeat: string | null;
};

export const SAUDE_AGENTES: SaudeAgente[] = [
  {
    dispositivo: "PDV-CAIXA-01",
    empresa: "NorteTI Suporte",
    sessoes_reais: 42,
    falhas: 1,
    vivo: true,
    ultimo_heartbeat: min(0),
  },
  {
    dispositivo: "SRV-FISCAL",
    empresa: "NorteTI Suporte",
    sessoes_reais: 17,
    falhas: 0,
    vivo: true,
    ultimo_heartbeat: min(1),
  },
  {
    dispositivo: "RECEPCAO-01",
    empresa: "NorteTI Suporte",
    sessoes_reais: 28,
    falhas: 2,
    vivo: true,
    ultimo_heartbeat: min(2),
  },
  {
    dispositivo: "ESCRITORIO-CONTAB",
    empresa: "NorteTI Suporte",
    sessoes_reais: 9,
    falhas: 0,
    vivo: false,
    ultimo_heartbeat: hrs(6),
  },
  {
    dispositivo: "SRV-BACKUP",
    empresa: "Meridian Sistemas",
    sessoes_reais: 31,
    falhas: 4,
    vivo: true,
    ultimo_heartbeat: min(1),
  },
  {
    dispositivo: "BALANCA-EXPEDICAO",
    empresa: "Meridian Sistemas",
    sessoes_reais: 4,
    falhas: 1,
    vivo: false,
    ultimo_heartbeat: hrs(29),
  },
  {
    dispositivo: "SRV-ERP",
    empresa: "Vega Tecnologia",
    sessoes_reais: 22,
    falhas: 0,
    vivo: true,
    ultimo_heartbeat: hrs(2),
  },
];

export type ResumoDia = {
  dia: string;
  sessoes: number;
  quedas: number;
  externos: number;
  dur_media_s: number;
  dur_p95_s: number;
};

export const RESUMO_SESSOES: ResumoDia[] = Array.from({ length: 14 }).map((_, i) => {
  const base = 18 - i;
  return {
    dia: dias(i),
    sessoes: Math.max(3, base + ((i * 7) % 9)),
    quedas: (i * 3) % 4,
    externos: i % 5 === 0 ? 1 : 0,
    dur_media_s: 640 + ((i * 137) % 900),
    dur_p95_s: 2_100 + ((i * 311) % 2_400),
  };
});

export type AcessoExterno = {
  dispositivo: string;
  empresa: string;
  inicio: string;
  duracao: number | null;
  ip: string;
};

export const ACESSOS_EXTERNOS: AcessoExterno[] = [
  {
    dispositivo: "SRV-BACKUP",
    empresa: "Meridian Sistemas",
    inicio: hrs(8),
    duracao: 412,
    ip: "45.166.220.87",
  },
  {
    dispositivo: "BALANCA-EXPEDICAO",
    empresa: "Meridian Sistemas",
    inicio: dias(3),
    duracao: 96,
    ip: "45.166.220.87",
  },
  {
    dispositivo: "SRV-ERP",
    empresa: "Vega Tecnologia",
    inicio: dias(5),
    duracao: 1_240,
    ip: "191.7.44.19",
  },
];

/* -------------------------------------------------------------------------- */

export const DASHBOARD_STATS = {
  usuarios: 5,
  dispositivos: 14,
  sessoesAtivas: 2,
  sessoes24h: 23,
};

export const USUARIO_ATUAL = {
  nome: "Marina Reis",
  email: "marina.reis@norteti.com.br",
  empresa: "NorteTI Suporte",
};

export const SENHA_EXEMPLO = "kR7-2xVq-9Tem";
