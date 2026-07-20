// AcessoFast — adopt-device (v1). Tecnico ADOTA um claim pendente POR rustdesk_id.
// Cria/atualiza o device no tenant do tecnico, VINCULA o agent_token do claim
// (redeem_claim) e provisiona a senha (so em device novo, AAD=device_id).
// Authz e cripto IDENTICAS ao register-device.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const RUSTID = /^[0-9]{6,12}$/, UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Alfabeto sem ambiguos (0 O 1 l I), separado por classe para garantir a politica.
const PW_LOWER = "abcdefghijkmnpqrstuvwxyz", PW_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ", PW_DIGITS = "23456789";
const PW_ALPHABET = PW_LOWER + PW_UPPER + PW_DIGITS, PW_LEN = 20;
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
function b64ToBytes(x: string) { const s = atob(x); const o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; }
function bytesToB64(x: Uint8Array) { let s = ""; for (let i = 0; i < x.length; i++) s += String.fromCharCode(x[i]); return btoa(s); }
// indice uniforme em [0,n) via rejection sampling de 1 byte (n <= 256) -> sem vies de modulo
function randIndex(n: number): number { const max = 256 - (256 % n); const b = new Uint8Array(1); do { crypto.getRandomValues(b); } while (b[0] >= max); return b[0] % n; }
const pick = (pool: string) => pool[randIndex(pool.length)];
function genPassword(n: number) {
  // garante 1 de cada classe (digito, maiuscula, minuscula) + preenche + embaralha (Fisher-Yates)
  const chars: string[] = [pick(PW_LOWER), pick(PW_UPPER), pick(PW_DIGITS)];
  while (chars.length < n) chars.push(pick(PW_ALPHABET));
  for (let i = chars.length - 1; i > 0; i--) { const k = randIndex(i + 1); [chars[i], chars[k]] = [chars[k], chars[i]]; }
  return chars.join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return j({ error: "method_not_allowed" }, 405);
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return j({ error: "missing_authorization" }, 401);
    const body = await req.json().catch(() => ({}));
    const rustdeskId = String(body?.rustdesk_id ?? "").replace(/\s+/g, "");
    if (!RUSTID.test(rustdeskId)) return j({ error: "rustdesk_id_invalido" }, 400);
    const alias = body?.alias ? String(body.alias).slice(0, 120) : null;

    const url = Deno.env.get("SUPABASE_URL")!, anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const encKeyB64 = Deno.env.get("DEVICE_SECRET_ENC_KEY");
    if (!encKeyB64) return j({ error: "server_misconfig" }, 500);

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: ud } = await userClient.auth.getUser();
    const user = ud?.user;
    if (!user) return j({ error: "unauthenticated" }, 401);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: profile } = await admin.from("profiles").select("role, tenant_id, is_active").eq("id", user.id).maybeSingle();
    if (!profile || profile.is_active === false) return j({ error: "user_inactive_or_missing" }, 403);

    let tenant: string;
    if (profile.role === "super_admin") {
      const t = String(body?.tenant_id ?? "");
      if (!UUID.test(t)) return j({ error: "tenant_id_obrigatorio_para_super" }, 400);
      tenant = t;
    } else {
      if (!profile.tenant_id) return j({ error: "sem_tenant" }, 403);
      tenant = profile.tenant_id;
    }

    // 1) adota (atomico no RPC): device + vinculo do token + marca claim
    const { data: rows, error: rErr } = await admin.rpc("redeem_claim", {
      p_rustdesk_id: rustdeskId, p_tenant_id: tenant, p_actor: user.id, p_alias: alias });
    if (rErr) {
      if (rErr.code === "P0002" || (rErr.message ?? "").includes("no_pending_claim"))
        return j({ error: "no_pending_claim", detail: "Nenhum computador aguardando adocao com esse ID. Confirme que o cliente instalou e leia o ID de novo." }, 404);
      return j({ error: "adopt_failed", detail: rErr.message }, 500);
    }
    const r = Array.isArray(rows) ? rows[0] : rows;
    const deviceId = r.r_device_id, wasInserted = r.r_was_inserted;

    // 2) senha so em device novo (existente mantem). AAD = device_id. Best-effort.
    let password: string | null = null, provisioned = true;
    if (wasInserted) {
      try {
        password = genPassword(PW_LEN);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await crypto.subtle.importKey("raw", b64ToBytes(encKeyB64), { name: "AES-GCM" }, false, ["encrypt"]);
        const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(deviceId) },
          key, new TextEncoder().encode(password));
        const { error: sErr } = await admin.rpc("set_device_secret", {
          p_device_id: deviceId, p_ciphertext: bytesToB64(new Uint8Array(ct)), p_iv: bytesToB64(iv), p_key_version: 1, p_actor: user.id });
        if (sErr) { provisioned = false; password = null; }
      } catch { provisioned = false; password = null; }
    }

    return j({ device_id: deviceId, rustdesk_id: rustdeskId, hostname: r.r_hostname, os: r.r_os,
      was_inserted: wasInserted, password, password_provisioned: provisioned,
      note: wasInserted
        ? (provisioned ? "Adotado. Aplique esta senha como permanente no client na 1a conexao."
                       : "Adotado, mas a senha nao provisionou — gere pelo painel.")
        : "Device ja existia neste tenant; token do agente rotacionado, senha mantida." });
  } catch (_e) { return j({ error: "internal_error" }, 500); }
});
