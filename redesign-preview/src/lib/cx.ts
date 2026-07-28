/**
 * Concatenador de classes — sem dependência externa.
 * Aceita qualquer valor: só o que for string não vazia entra no resultado,
 * então `cond && "classe"` funciona mesmo quando `cond` é número ou bigint.
 */
export function cx(...parts: unknown[]): string {
  let out = "";
  for (const p of parts) {
    if (typeof p === "string" && p.length > 0) out += out ? ` ${p}` : p;
  }
  return out;
}
