// AcessoFast — Edge Function: rotate-device-secret (Fase 2 — senha efemera)
// O AGENTE do endpoint reporta a senha permanente NOVA depois de rotaciona-la no
// RustDesk ao fim de uma sessao. A funcao cifra em repouso e grava. A senha que o
// tecnico viu na sessao anterior morre aqui.
//
// Deploy com verify_jwt = FALSE (auth propria via token de dispositivo, igual session-ingest).
// AUTH: mesma do session-ingest — rustdesk_id + agent_token, sha256(agent_token) == agent_token_hash.
// CONTRATO DE CRIPTO (DEVE bater com connect-device / provision-device-secret):
//   AES-256-GCM, IV 12 bytes, ciphertext+iv em base64, AAD = device_id (UTF-8 cru),
//   key_version = 1, chave = env DEVICE_SECRET_ENC_KEY (32 bytes b64).
//
// Modelo (decidido): o AGENTE gera a senha, aplica no RustDesk e SO ENTAO reporta a
// que aplicou com sucesso. O painel apenas cifra e guarda o que recebe -> o painel
// nunca conhece uma senha que ainda nao esta no endpoint (minimiza lockout).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Limites defensivos da senha reportada. O agente gera 20 chars ASCII imprimiveis;
// aceitamos uma faixa folgada e rejeitamos controle/espaco (nunca confiar cego no cliente).
const PW_MIN = 8;
const PW_MAX = 128;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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

// Senha valida: comprimento na faixa e apenas ASCII imprimivel sem espaco (0x21..0x7e).
function isValidPassword(pw: string): boolean {
  if (pw.length < PW_MIN || pw.length > PW_MAX) return false;
  for (let i = 0; i < pw.length; i++) {
    const c = pw.charCodeAt(i);
    if (c < 0x21 || c > 0x7e) return false;
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { rustdesk_id?: string; agent_token?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const rustdesk_id = (body.rustdesk_id ?? "").trim();
  const agent_token = body.agent_token ?? "";
  const password = body.password ?? "";

  if (!rustdesk_id || !agent_token || !password) {
    return json({ error: "missing_or_invalid_fields" }, 400);
  }
  if (!isValidPassword(password)) {
    return json({ error: "invalid_password" }, 400);
  }

  const encKeyB64 = Deno.env.get("DEVICE_SECRET_ENC_KEY");
  if (!encKeyB64) return json({ error: "server_misconfig" }, 500);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 1) Resolver o dispositivo pelo rustdesk_id (unico) -> device_id + hash do token.
  const { data: device, error: devErr } = await db
    .from("address_book")
    .select("id, agent_token_hash")
    .eq("rustdesk_id", rustdesk_id)
    .maybeSingle();

  if (devErr) return json({ error: "db_error", detail: devErr.message }, 500);
  if (!device) return json({ error: "device_not_registered" }, 404);
  if (!device.agent_token_hash) return json({ error: "device_not_provisioned" }, 401);

  // 2) Autenticar o agente (mesmo esquema do session-ingest).
  const presentedHash = await sha256Hex(agent_token);
  if (presentedHash !== device.agent_token_hash) {
    return json({ error: "unauthorized" }, 401);
  }

  // 3) Cifrar AES-256-GCM. AAD = device_id (a MESMA string usada por connect-device).
  const deviceId = device.id as string;
  let ciphertextB64: string;
  let ivB64: string;
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey(
      "raw", b64ToBytes(encKeyB64), { name: "AES-GCM" }, false, ["encrypt"],
    );
    const ctBuf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(deviceId) },
      key, new TextEncoder().encode(password),
    );
    ciphertextB64 = bytesToB64(new Uint8Array(ctBuf));
    ivB64 = bytesToB64(iv);
  } catch {
    return json({ error: "encrypt_failed" }, 500);
  }

  // 4) Gravar via RPC mecanica (so service_role). p_actor = null: quem gira e o agente,
  //    nao um usuario de auth.users. Plaintext NUNCA vai no SQL.
  const { error: rpcErr } = await db.rpc("set_device_secret", {
    p_device_id: deviceId,
    p_ciphertext: ciphertextB64,
    p_iv: ivB64,
    p_key_version: 1,
    p_actor: null,
  });
  if (rpcErr) return json({ error: "store_failed", detail: rpcErr.message }, 500);

  return json({ ok: true });
});
