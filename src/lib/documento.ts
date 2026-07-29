/**
 * CPF/CNPJ com dígito verificador e máscara de digitação.
 *
 * Separado de `clientes.ts` de propósito: lá o documento identifica o cliente
 * atendido e um dígito errado é problema do usuário; aqui ele decide se o
 * cadastro cria uma empresa nova ou entra numa existente, então precisa bater
 * de verdade. A mesma validação roda de novo na edge function — esta aqui só
 * evita a viagem até o servidor.
 */

export type TipoDocumento = "cpf" | "cnpj";

export function apenasDigitos(valor: string): string {
  return (valor ?? "").replace(/\D/g, "");
}

export function cpfValido(c: string): boolean {
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  for (const peso of [10, 11]) {
    let soma = 0;
    for (let i = 0; i < peso - 1; i++) soma += Number(c[i]) * (peso - i);
    let d = (soma * 10) % 11;
    if (d === 10) d = 0;
    if (d !== Number(c[peso - 1])) return false;
  }
  return true;
}

export function cnpjValido(c: string): boolean {
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (base: string, pesos: number[]) => {
    const soma = base.split("").reduce((a, d, i) => a + Number(d) * pesos[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(c.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(c.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(c[12]) && d2 === Number(c[13]);
}

/**
 * Devolve o tipo só quando o documento está completo E o dígito confere.
 * `null` cobre tanto "ainda digitando" quanto "inválido" — quem chama decide
 * pela quantidade de dígitos qual das duas mensagens mostrar.
 */
export function tipoDocumentoValido(bruto: string): TipoDocumento | null {
  const d = apenasDigitos(bruto);
  if (d.length === 11) return cpfValido(d) ? "cpf" : null;
  if (d.length === 14) return cnpjValido(d) ? "cnpj" : null;
  return null;
}

/**
 * Máscara progressiva: até 11 dígitos veste de CPF, acima disso de CNPJ. Sem
 * escolher o tipo antes — o comprimento resolve, e é assim que a pessoa digita.
 */
export function mascararDocumento(bruto: string): string {
  const d = apenasDigitos(bruto).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
  }
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3/$4")
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, "$1.$2.$3/$4-$5");
}
