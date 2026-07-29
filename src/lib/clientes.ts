/**
 * Normalização e formatação dos campos de cliente (nome, CNPJ/CPF, telefone).
 * Compartilhado entre o cadastro manual e a importação de planilha para que os
 * dois gravem exatamente no mesmo formato: no banco fica sempre só dígito.
 */

export type DocumentoTipo = "cnpj" | "cpf";

export function normalizarTexto(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function normalizarDocumento(
  bruto: string,
  opcoes?: { recuperarZeros?: boolean },
): { document: string | null; document_type: DocumentoTipo | null; erro?: string } {
  let d = (bruto ?? "").replace(/\D/g, "");
  if (!d) return { document: null, document_type: null };

  // Planilha que guarda o documento como número perde os zeros à esquerda
  // (07.507.463/0001-93 volta como 7507463000193). Só a importação faz esse
  // resgate; na digitação manual um tamanho errado continua sendo erro.
  if (opcoes?.recuperarZeros) {
    if (d.length >= 12 && d.length <= 13) d = d.padStart(14, "0");
    else if (d.length >= 9 && d.length <= 10) d = d.padStart(11, "0");
  }

  if (d.length === 14) return { document: d, document_type: "cnpj" };
  if (d.length === 11) return { document: d, document_type: "cpf" };
  return {
    document: null,
    document_type: null,
    erro: "Informe CNPJ (14) ou CPF (11) dígitos",
  };
}

export function normalizarTelefone(bruto: string): { phone: string | null; erro?: string } {
  const texto = (bruto ?? "").trim();
  let d = texto.replace(/\D/g, "");
  // Célula preenchida mas sem nenhum dígito ("não tem", "-") é dado inválido,
  // não ausência de telefone: avisa em vez de descartar em silêncio.
  if (!d) return texto ? { phone: null, erro: "Telefone inválido" } : { phone: null };
  // "+55 47 99999-9999" chega como 5547999999999; tira o código do país.
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length < 8 || d.length > 13) return { phone: null, erro: "Telefone inválido" };
  return { phone: d };
}

export function formatarDocumento(
  document: string | null,
  document_type: string | null,
): string | null {
  if (!document) return null;
  const d = document.replace(/\D/g, "");
  if (document_type === "cnpj" && d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  if (document_type === "cpf" && d.length === 11) {
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  return document;
}

export function formatarTelefone(phone: string | null): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 9) return `${d.slice(0, 5)}-${d.slice(5)}`;
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return phone;
}
