// supabase/functions/register-device/index.ts
// AcessoFast — A-slim / P2 — auto-registro de dispositivo NOVO pelo técnico.
// Cria a linha em address_book E provisiona a senha cifrada, num passo só.
// Authz: usuário ATIVO com tenant (tech/head/admin/super). SOMENTE dispositivo novo:
//   rustdesk_id já existente no tenant -> 409 (rotação = admin/head via provision-device-secret).
// Cripto IDÊNTICA a provision-device-secret (AES-256-GCM, IV 12B, AAD=device_id cru, key_version=1).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const RUSTID_RE = /^[0-9]{6,12}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Alfabeto sem ambiguos (0 O 1 l I), separado por classe para garantir a politica.
const PW_LOWER  = "abcdefghijkmnpqrstuvwxyz"; // sem l o
const PW_UPPER  = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // sem I O
const PW_DIGITS = "23456789";                 // sem 0 1
const PW_ALPHABET = PW_LOWER + PW_UPPER + PW_DIGITS;
const PW_LEN = 20;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes: Uint8Array): string {
  let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
// indice uniforme em [0,n) via rejection sampling de 1 byte (n <= 256) -> sem vies de modulo
function randIndex(n: number): number {
  const max = 256 - (256 % n);
  const buf = new Uint8Array(1);
  do { crypto.getRandomValues(buf); } while (buf[0] >= max);
  return buf[0] % n;
}
function pick(pool: string): string { return pool[randIndex(pool.length)]; }
function genPassword(len: number): string {
  // garante 1 de cada classe exigida (digito, maiuscula, minuscula) + preenche + embaralha (Fisher-Yates)
  const chars: string[] = [pick(PW_LOWER), pick(PW_UPPER), pick(PW_DIGITS)];
  while (chars.length < len) chars.push(pick(PW_ALPHABET));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing_authorization" }, 401);

    const body = await req.json().catch(() => ({}));
    const rustdeskId = String(body?.rustdesk_id ?? "").trim();
    if (!RUSTID_RE.test(rustdeskId)) return json({ error: "rustdesk_id_invalido" }, 400);
    const alias = body?.alias ? String(body.alias).slice(0, 120) : null;
    const deviceGroup = body?.device_group ? String(body.device_group).slice(0, 120) : null;
    const os = body?.os ? String(body.os).slice(0, 60) : null;

    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const encKeyB64 = Deno.env.get("DEVICE_SECRET_ENC_KEY");
    if (!encKeyB64) return json({ error: "server_misconfig" }, 500);

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    const user = userData?.user;
    if (userErr || !user) return json({ error: "unauthenticated" }, 401);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const { data: profile } = await admin
      .from("profiles").select("role, tenant_id, is_active").eq("id", user.id).maybeSingle();
    if (!profile || profile.is_active === false) return json({ error: "user_inactive_or_missing" }, 403);

    // Tenant alvo: super_admin precisa informar; demais usam o proprio.
    let targetTenant: string;
    if (profile.role === "super_admin") {
      const t = String(body?.tenant_id ?? "");
      if (!UUID_RE.test(t)) return json({ error: "tenant_id_obrigatorio_para_super" }, 400);
      targetTenant = t;
    } else {
      if (!profile.tenant_id) return json({ error: "sem_tenant" }, 403);
      targetTenant = profile.tenant_id;
    }

    // SOMENTE NOVO: recusa se o rustdesk_id ja existe no tenant.
    const { data: existing } = await admin
      .from("address_book").select("id")
      .eq("tenant_id", targetTenant).eq("rustdesk_id", rustdeskId).maybeSingle();
    if (existing) return json({ error: "device_already_registered", device_id: existing.id }, 409);

    // Cria a linha do dispositivo.
    const { data: device, error: insErr } = await admin
      .from("address_book")
      .insert({ tenant_id: targetTenant, rustdesk_id: rustdeskId, alias, device_group: deviceGroup, os, created_by: user.id })
      .select("id, rustdesk_id").single();
    if (insErr || !device) return json({ error: "create_failed" }, 500);

    // Provisiona a senha (mesmo contrato de cripto do provision-device-secret).
    const password = genPassword(PW_LEN);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey(
      "raw", b64ToBytes(encKeyB64), { name: "AES-GCM" }, false, ["encrypt"],
    );
    const ctBuf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(device.id) },
      key, new TextEncoder().encode(password),
    );

    const { error: rpcErr } = await admin.rpc("set_device_secret", {
      p_device_id: device.id,
      p_ciphertext: bytesToB64(new Uint8Array(ctBuf)),
      p_iv: bytesToB64(iv),
      p_key_version: 1,
      p_actor: user.id,
    });
    if (rpcErr) {
      await admin.from("address_book").delete().eq("id", device.id); // rollback: sem orfao
      return json({ error: "store_failed" }, 500);
    }

    return json({
      device_id: device.id,
      rustdesk_id: device.rustdesk_id,
      password,
      note: "Aplique esta senha como senha permanente no client desta maquina na primeira conexao.",
    });
  } catch (_e) {
    return json({ error: "internal_error" }, 500);
  }
});
