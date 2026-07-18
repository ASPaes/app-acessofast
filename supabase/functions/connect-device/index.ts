// supabase/functions/connect-device/index.ts
// AcessoFast - Fase 2 - Rota B - fluxo "Conectar" (Modelo 1)
// CONTRATO DE CRIPTO (a funcao de escrita DEVE bater): AES-256-GCM, IV 12 bytes,
// ciphertext+iv em base64, AAD = device_id (UTF-8), chave = env DEVICE_SECRET_ENC_KEY (32 bytes b64).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Cliente branded AcessoFast registra o scheme "acessofast://".
const DEEP_LINK_SCHEME = "acessofast";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    // Contexto do USUARIO -> a RLS do address_book e o controle de acesso.
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    const user = userData?.user;
    if (userErr || !user) return json({ error: "unauthenticated" }, 401);

    // AUTHZ DELEGADA A RLS: ve o dispositivo => autorizado.
    const { data: device, error: devErr } = await userClient
      .from("address_book")
      .select("id, tenant_id, rustdesk_id")
      .eq("id", deviceId)
      .maybeSingle();
    if (devErr) return json({ error: "lookup_failed" }, 500);
    if (!device) return json({ error: "forbidden_or_not_found" }, 403);

    // service_role para o que a RLS nao deve mediar.
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // is_active nao e coberto pela RLS do address_book -> checa explicito.
    const { data: profile } = await admin
      .from("profiles").select("is_active").eq("id", user.id).maybeSingle();
    if (!profile || profile.is_active === false) return json({ error: "user_inactive" }, 403);

    // Ciphertext via RPC mecanica (so service_role executa).
    const { data: secretRows, error: secErr } = await admin
      .rpc("get_device_secret", { p_device_id: deviceId });
    if (secErr) return json({ error: "secret_fetch_failed" }, 500);
    const row = Array.isArray(secretRows) ? secretRows[0] : secretRows;
    if (!row) return json({ error: "sem_senha_provisionada" }, 409);
    if (row.key_version !== 1) return json({ error: "key_version_desconhecida" }, 500);

    // Decifra AES-256-GCM. AAD = device_id.
    const key = await crypto.subtle.importKey(
      "raw", b64ToBytes(encKeyB64), { name: "AES-GCM" }, false, ["decrypt"],
    );
    let password: string;
    try {
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: b64ToBytes(row.iv), additionalData: new TextEncoder().encode(deviceId) },
        key, b64ToBytes(row.ciphertext),
      );
      password = new TextDecoder().decode(plain);
    } catch {
      return json({ error: "decrypt_failed" }, 500);
    }

    // Registra a sessao (service_role passa pela policy de insert que exige is_super_admin).
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    await admin.from("connection_logs").insert({
      tenant_id: device.tenant_id,
      address_book_id: device.id,
      rustdesk_id: device.rustdesk_id,
      technician_id: user.id,
      technician_email: user.email ?? null,
      technician_ip: clientIp,
    });

    // Normaliza o ID pra digitos antes do deep link (RustDesk exibe com espacos; a URI nao pode ter).
    const rid = String(device.rustdesk_id).replace(/\D/g, "");

    return json({
      rustdesk_id: rid,
      password,
      deep_link: `${DEEP_LINK_SCHEME}://connection/new/${rid}`,
    });
  } catch (_e) {
    return json({ error: "internal_error" }, 500);
  }
});
