// supabase/functions/provision-device-secret/index.ts
// AcessoFast - Fase 2 - Rota B - provisiona/rotaciona a senha do dispositivo.
// Authz EXPLICITA: super_admin, ou admin/head do MESMO tenant. Nunca tech.
// CONTRATO DE CRIPTO deve bater com connect-device (AAD = device_id cru, mesma string).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PW_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0 O 1 l I
const PW_LEN = 20;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function genPassword(len: number): string {
  const N = PW_ALPHABET.length;
  const max = 256 - (256 % N); // rejection sampling -> sem vies de modulo
  const out: string[] = [];
  const buf = new Uint8Array(1);
  while (out.length < len) {
    crypto.getRandomValues(buf);
    if (buf[0] < max) out.push(PW_ALPHABET[buf[0] % N]);
  }
  return out.join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing_authorization" }, 401);

    const body = await req.json().catch(() => ({}));
    const deviceId = body?.device_id;
    if (typeof deviceId !== "string" || !UUID_RE.test(deviceId)) {
      return json({ error: "device_id_invalido" }, 400);
    }

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

    // AUTHZ EXPLICITA (setar senha = super_admin ou admin/head do mesmo tenant; nunca tech).
    const { data: profile } = await admin
      .from("profiles").select("role, tenant_id, is_active").eq("id", user.id).maybeSingle();
    if (!profile || profile.is_active === false) return json({ error: "user_inactive_or_missing" }, 403);

    const { data: device } = await admin
      .from("address_book").select("id, tenant_id, rustdesk_id").eq("id", deviceId).maybeSingle();
    if (!device) return json({ error: "device_nao_encontrado" }, 404);

    const isSuper = profile.role === "super_admin";
    const isTenantManager =
      (profile.role === "admin" || profile.role === "head") &&
      profile.tenant_id === device.tenant_id;
    if (!isSuper && !isTenantManager) return json({ error: "forbidden" }, 403);

    // Gera senha forte e cifra (contrato: AES-256-GCM, IV 12 bytes, AAD=device_id, key_version=1).
    const password = genPassword(PW_LEN);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey(
      "raw", b64ToBytes(encKeyB64), { name: "AES-GCM" }, false, ["encrypt"],
    );
    const ctBuf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(deviceId) },
      key, new TextEncoder().encode(password),
    );

    // Grava via RPC mecanica (so service_role). Plaintext NUNCA vai no SQL.
    const { error: rpcErr } = await admin.rpc("set_device_secret", {
      p_device_id: deviceId,
      p_ciphertext: bytesToB64(new Uint8Array(ctBuf)),
      p_iv: bytesToB64(iv),
      p_key_version: 1,
      p_actor: user.id,
    });
    if (rpcErr) return json({ error: "store_failed" }, 500);

    return json({
      device_id: device.id,
      rustdesk_id: device.rustdesk_id,
      password,
      note: "Configure esta senha como senha permanente no client deste dispositivo.",
    });
  } catch (_e) {
    return json({ error: "internal_error" }, 500);
  }
});
