/**
 * Leitura e conferência da planilha de clientes (xlsx/xls/csv).
 * Só interessam três colunas: Nome, CNPJ/CPF e Telefone. O resto é ignorado.
 */
import {
  normalizarDocumento,
  normalizarTelefone,
  normalizarTexto,
  type DocumentoTipo,
} from "@/lib/clientes";

export type ClienteExistente = {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
};

export type StatusLinha = "novo" | "duplicado" | "repetido" | "erro";

export type LinhaPlanilha = {
  linha: number;
  nome: string;
  document: string | null;
  document_type: DocumentoTipo | null;
  phone: string | null;
  status: StatusLinha;
  motivo?: string;
  aviso?: string;
  existenteId?: string;
  existenteNome?: string;
};

const ALIAS_NOME = [
  "nome",
  "nomecliente",
  "nomedocliente",
  "cliente",
  "clientes",
  "razaosocial",
  "razao",
  "empresa",
  "nomefantasia",
  "fantasia",
];
const ALIAS_DOCUMENTO = ["cnpj", "cpf", "cnpjcpf", "cpfcnpj", "cnpjoucpf", "documento", "doc"];
const ALIAS_TELEFONE = [
  "telefone",
  "telefone1",
  "telefonecontato",
  "fone",
  "celular",
  "whatsapp",
  "whats",
  "tel",
  "contato",
  "numero",
  "numerodetelefone",
];

function celulaParaTexto(celula: unknown): string {
  if (celula == null) return "";
  // Valor cru, não o texto formatado: um CNPJ digitado como número aparece
  // formatado como "7,50746E+12" e perderia os dígitos no meio do caminho.
  if (typeof celula === "number") {
    return Number.isInteger(celula) ? celula.toFixed(0) : String(celula);
  }
  if (celula instanceof Date) return celula.toISOString();
  return String(celula).trim();
}

/** Lê xlsx/xls/csv e devolve a primeira aba como matriz de texto já aparado. */
export async function lerMatriz(arquivo: File): Promise<string[][]> {
  const XLSX = await import("xlsx");
  let wb;

  if (/\.(csv|txt)$/i.test(arquivo.name)) {
    const buf = await arquivo.arrayBuffer();
    let texto = new TextDecoder("utf-8").decode(buf);
    // CSV exportado pelo Excel em português costuma vir em windows-1252: lido
    // como UTF-8 os acentos viram U+FFFD. Nesse caso relê com a tabela certa.
    if (texto.includes("�")) texto = new TextDecoder("windows-1252").decode(buf);
    wb = XLSX.read(texto, { type: "string", raw: false });
  } else {
    wb = XLSX.read(await arquivo.arrayBuffer(), { type: "array" });
  }

  const nomeAba = wb.SheetNames[0];
  const ws = nomeAba ? wb.Sheets[nomeAba] : undefined;
  if (!ws) throw new Error("A planilha não tem nenhuma aba com dados.");

  const matriz = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });
  return matriz.map((linha) => (linha ?? []).map(celulaParaTexto));
}

function acharColuna(cabecalho: string[], aliases: string[]): number {
  return cabecalho.findIndex((celula) => aliases.includes(normalizarTexto(celula)));
}

/** Acha o cabeçalho (nem sempre é a primeira linha — planilhas têm título antes). */
function acharCabecalho(matriz: string[][]) {
  const limite = Math.min(matriz.length, 20);
  for (let i = 0; i < limite; i++) {
    const linha = matriz[i] ?? [];
    const iNome = acharColuna(linha, ALIAS_NOME);
    if (iNome === -1) continue;
    return {
      indice: i,
      iNome,
      iDocumento: acharColuna(linha, ALIAS_DOCUMENTO),
      iTelefone: acharColuna(linha, ALIAS_TELEFONE),
    };
  }
  return null;
}

/**
 * Classifica cada linha da planilha contra os clientes já cadastrados na empresa.
 * O casamento é pelo documento quando existe; sem documento, pelo nome
 * (ignorando acento e caixa).
 */
export function analisar(matriz: string[][], existentes: ClienteExistente[]): LinhaPlanilha[] {
  const cab = acharCabecalho(matriz);
  if (!cab) {
    throw new Error(
      "Não encontrei a coluna de nome. A primeira linha precisa ter os títulos: Nome, CNPJ e Telefone.",
    );
  }

  const porDocumento = new Map<string, ClienteExistente>();
  const porNome = new Map<string, ClienteExistente>();
  for (const c of existentes) {
    const d = (c.document ?? "").replace(/\D/g, "");
    if (d) porDocumento.set(d, c);
    const n = normalizarTexto(c.name);
    if (n && !porNome.has(n)) porNome.set(n, c);
  }

  const docsNoArquivo = new Set<string>();
  const nomesNoArquivo = new Set<string>();
  const linhas: LinhaPlanilha[] = [];

  for (let i = cab.indice + 1; i < matriz.length; i++) {
    const bruta = matriz[i] ?? [];
    const nome = (bruta[cab.iNome] ?? "").trim();
    const docBruto = cab.iDocumento === -1 ? "" : (bruta[cab.iDocumento] ?? "");
    const telBruto = cab.iTelefone === -1 ? "" : (bruta[cab.iTelefone] ?? "");

    // Linha totalmente vazia é sobra da planilha, não erro do usuário.
    if (!nome && !docBruto.trim() && !telBruto.trim()) continue;

    const numeroLinha = i + 1;
    if (!nome) {
      linhas.push({
        linha: numeroLinha,
        nome: "—",
        document: null,
        document_type: null,
        phone: null,
        status: "erro",
        motivo: "Nome vazio",
      });
      continue;
    }

    const doc = normalizarDocumento(docBruto, { recuperarZeros: true });
    if (doc.erro) {
      linhas.push({
        linha: numeroLinha,
        nome,
        document: null,
        document_type: null,
        phone: null,
        status: "erro",
        motivo: doc.erro,
      });
      continue;
    }

    // Telefone ruim não derruba o cliente: entra sem telefone e o aviso aparece
    // na pré-visualização para o usuário corrigir depois se quiser.
    const tel = normalizarTelefone(telBruto);

    const chaveDoc = doc.document ?? "";
    const chaveNome = normalizarTexto(nome);

    if ((chaveDoc && docsNoArquivo.has(chaveDoc)) || (!chaveDoc && nomesNoArquivo.has(chaveNome))) {
      linhas.push({
        linha: numeroLinha,
        nome,
        document: doc.document,
        document_type: doc.document_type,
        phone: tel.phone,
        status: "repetido",
        motivo: "Repetido na própria planilha",
      });
      continue;
    }
    if (chaveDoc) docsNoArquivo.add(chaveDoc);
    nomesNoArquivo.add(chaveNome);

    const existente = (chaveDoc ? porDocumento.get(chaveDoc) : undefined) ?? porNome.get(chaveNome);

    linhas.push({
      linha: numeroLinha,
      nome,
      document: doc.document,
      document_type: doc.document_type,
      phone: tel.phone,
      status: existente ? "duplicado" : "novo",
      aviso: tel.erro ? "Telefone inválido — será importado sem telefone" : undefined,
      existenteId: existente?.id,
      existenteNome: existente?.name,
    });
  }

  if (linhas.length === 0) throw new Error("A planilha não tem nenhuma linha de cliente.");
  return linhas;
}
