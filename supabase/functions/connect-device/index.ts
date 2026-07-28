// supabase/functions/connect-device/index.ts
// AcessoFast - Fase 2 - Rota B - fluxo "Conectar" (Modelo 1)
// Billing B1: contrato de 2 etapas. Antes de emitir a senha, billing_eligibility
// diz se a conta precisa ESCOLHER free x credito. Se precisa e o painel ainda nao
// mandou `source`, respondemos { needs_choice } SEM emitir. A 2a chamada traz
// `source` e ai create_access_grant debita/grava atendimento e emite.
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
    // Fonte escolhida pelo painel (2a etapa). Opcional; validada no servidor.
    const rawSource = body?.source;
    const chosenSource =
      rawSource === "free" || rawSource === "credit" ? rawSource : null;

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

    // ETAPA 1 — ELEGIBILIDADE (read-only). Decide se precisa escolher.
    const { data: eligRows, error: eligErr } = await admin.rpc("billing_eligibility", {
      p_device_id: deviceId,
      p_actor: user.id,
    });
    if (eligErr) return json({ error: "eligibility_failed" }, 500);
    const elig = Array.isArray(eligRows) ? eligRows[0] : eligRows;
    if (!elig) return json({ error: "eligibility_failed" }, 500);

    if (elig.blocked_reason) {
      if (elig.blocked_reason === "device_not_found") return json({ error: "forbidden_or_not_found" }, 403);
      if (elig.blocked_reason === "billing_blocked") return json({ error: "billing_blocked" }, 403);
      if (elig.blocked_reason === "quota_exceeded") return json({ error: "quota_exceeded" }, 429);
      if (elig.blocked_reason === "no_credits") return json({ error: "no_credits" }, 402);
      return json({ error: "blocked" }, 402);
    }

    // Precisa escolher e o painel ainda nao mandou -> devolve a oferta, SEM emitir.
    if (elig.needs_choice && !chosenSource) {
      return json({
        needs_choice: true,
        free_remaining: elig.free_remaining ?? 0,
        credit_balance: elig.credit_balance ?? 0,
      });
    }

    // Fonte a passar pra RPC: escolha do painel (se houve) ou nulo (auto/plano/reconexao).
    const pSource = chosenSource ?? null;

    // ETAPA 2 — GATE + EMISSAO, ATOMICO. Se o tecnico ja esta no limite (plano) ou
    // sem saldo (metrado), a senha NAO e emitida. O grant + atendimento + debito
    // sao criados aqui, na emissao.
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const { data: grantRows, error: grantErr } = await admin.rpc("create_access_grant", {
      p_device_id: deviceId,
      p_actor: user.id,
      p_technician_email: user.email ?? null,
      p_technician_ip: clientIp,
      p_source: pSource,
    });
    if (grantErr) {
      const msg = grantErr.message ?? "";
      // Corrida: virou ambiguo entre eligibility e o lock -> peca a escolha.
      if (msg.includes("choice_required")) {
        return json({
          needs_choice: true,
          free_remaining: elig.free_remaining ?? 0,
          credit_balance: elig.credit_balance ?? 0,
        });
      }
      if (msg.includes("quota_exceeded")) return json({ error: "quota_exceeded" }, 429);
      if (msg.includes("billing_blocked")) return json({ error: "billing_blocked" }, 403);
      if (msg.includes("free_exhausted") || msg.includes("no_credits")) return json({ error: "no_credits" }, 402);
      if (msg.includes("free_requires_individual")) return json({ error: "free_requires_individual" }, 409);
      if (msg.includes("device_inativo")) return json({ error: "device_inativo" }, 403);
      if (msg.includes("device_not_found")) return json({ error: "forbidden_or_not_found" }, 403);
      return json({ error: "grant_failed" }, 500);
    }
    const grant = Array.isArray(grantRows) ? grantRows[0] : grantRows;
    if (!grant?.grant_id) return json({ error: "grant_failed" }, 500);
    const grantId = grant.grant_id as string;

    // A partir daqui, qualquer falha deve DESFAZER o grant (e estornar o debito)
    // pra nao consumir quota/credito/free. revoke_access_grant faz tudo atomico.
    const rollbackGrant = async () => {
      await admin.rpc("revoke_access_grant", { p_grant_id: grantId });
    };

    // Ciphertext via RPC mecanica (so service_role executa).
    const { data: secretRows, error: secErr } = await admin
      .rpc("get_device_secret", { p_device_id: deviceId });
    if (secErr) { await rollbackGrant(); return json({ error: "secret_fetch_failed" }, 500); }
    const row = Array.isArray(secretRows) ? secretRows[0] : secretRows;
    if (!row) { await rollbackGrant(); return json({ error: "sem_senha_provisionada" }, 409); }
    if (row.key_version !== 1) { await rollbackGrant(); return json({ error: "key_version_desconhecida" }, 500); }

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
      await rollbackGrant();
      return json({ error: "decrypt_failed" }, 500);
    }

    // Normaliza o ID pra digitos antes do deep link (RustDesk exibe com espacos; a URI nao pode ter).
    const rid = String(device.rustdesk_id).replace(/\D/g, "");

    return json({
      rustdesk_id: rid,
      password,
      deep_link: `${DEEP_LINK_SCHEME}://connection/new/${rid}`,
      source: grant.source ?? null,     // 'free' | 'credit' | 'plan' — pro painel exibir/telemetria
      charged: grant.charged ?? false,
    });
  } catch (_e) {
    return json({ error: "internal_error" }, 500);
  }
});
