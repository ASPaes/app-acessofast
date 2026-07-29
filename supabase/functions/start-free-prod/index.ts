// AcessoFast — start-free-prod (v2) [PRODUCAO]
// Cria conta no plano INDIVIDUAL GRATIS PERMANENTE. SEM pagamento, SEM cartao,
// SEM Asaas, SEM expiracao. verify_jwt = FALSE (site comercial, visitante anonimo).
//
// Diferenca vs start-trial:
//   - aceita SO plan_code='individual' (blindagem)
//   - chama provision_from_intent (plan_expires_at=null, is_trial default=false)
//   - conta nasce gratis para sempre.
// Trava de 1 conta por documento (CPF/CNPJ): IDENTICA ao trial.
// PRIVACIDADE (LGPD): CPF/CNPJ NUNCA e gravado. So o HMAC vai ao banco.
//
// v2 (29/07/2026) — corrige documento travado para sempre:
//   Na v1 o claim_trial_document vinha ANTES do createUser. Como o claim e
//   irreversivel, um e-mail ja cadastrado (a falha mais comum) deixava o
//   CPF/CNPJ reservado sem nenhuma conta atras — e a pessoa nunca mais
//   conseguia abrir conta com aquele documento. Dois CPFs ficaram presos assim.
//   Agora o usuario e criado primeiro, e qualquer falha depois do claim devolve
//   a reserva com release_trial_document(). Mesma correcao da signup-publico.
import { createClient } from "npm:@supabase/supabase-js@2";

const ENV = "production";
const FREE_PLAN = "individual";
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const HMAC_KEY = Deno.env.get("TRIAL_DOC_HMAC_KEY")!;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "access-control-allow-methods": "POST, OPTIONS",
};
const j = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", ...CORS } });

function cpfValido(c) {
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  for (const peso of [10, 11]) {
    let s = 0;
    for (let i = 0; i < peso - 1; i++) s += Number(c[i]) * (peso - i);
    let d = (s * 10) % 11;
    if (d === 10) d = 0;
    if (d !== Number(c[peso - 1])) return false;
  }
  return true;
}
function cnpjValido(c) {
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (base, pesos) => {
    const s = base.split("").reduce((a, d, i) => a + Number(d) * pesos[i], 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(c.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(c.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(c[12]) && d2 === Number(c[13]);
}

async function hmacDoc(doc) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(HMAC_KEY),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(doc));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function rlAllows(db, key, limit, win) {
  try {
    const { data, error } = await db.rpc("rl_hit", { p_key: key, p_limit: limit, p_window_seconds: win });
    if (error) { console.error("rl_hit error (fail-open):", error.message); return true; }
    return data !== false;
  } catch (e) { console.error("rl_hit threw (fail-open):", String(e)); return true; }
}
function clientIp(req) {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) { const f = xff.split(/\s*,\s*/)[0]; if (f) return f.trim(); }
  return (req.headers.get("x-real-ip") ?? "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return j({ error: "method_not_allowed" }, 405);
  if (!HMAC_KEY) { console.error("TRIAL_DOC_HMAC_KEY ausente"); return j({ error: "server_misconfig" }, 500); }

  let b; try { b = await req.json(); } catch { return j({ error: "invalid_json" }, 400); }

  const company_name = String(b.company_name ?? "").trim().slice(0, 120);
  const admin_email = String(b.admin_email ?? "").trim().toLowerCase().slice(0, 160);
  const phone = String(b.phone ?? "").replace(/\D/g, "").slice(0, 15);
  const plan_code = String(b.plan_code ?? "").trim().toLowerCase();
  const consent = b.consent === true;
  const doc = String(b.document ?? "").replace(/\D/g, "");

  if (!company_name) return j({ error: "company_name_required" }, 400);
  if (!EMAIL_RE.test(admin_email)) return j({ error: "invalid_email" }, 400);
  if (!consent) return j({ error: "consent_required" }, 400);
  if (plan_code !== FREE_PLAN)
    return j({ error: "plan_not_free", detail: "A conta gratuita e exclusiva do plano Individual." }, 400);

  const doc_type = doc.length === 11 ? "cpf" : doc.length === 14 ? "cnpj" : null;
  if (!doc_type) return j({ error: "invalid_document" }, 400);
  if (doc_type === "cpf" && !cpfValido(doc)) return j({ error: "invalid_document" }, 400);
  if (doc_type === "cnpj" && !cnpjValido(doc)) return j({ error: "invalid_document" }, 400);

  const db = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const pub = createClient(SB_URL, ANON_KEY, { auth: { persistSession: false } });

  const ip = clientIp(req);
  if (ip && !(await rlAllows(db, "fr:ip:" + ip, 5, 3600))) return j({ error: "rate_limited" }, 429);
  if (!(await rlAllows(db, "fr:em:" + admin_email, 3, 3600))) return j({ error: "rate_limited" }, 429);

  const doc_hash = await hmacDoc(doc);

  // (v2) Usuario ANTES da reserva do documento: e-mail repetido e a falha mais
  // comum, e nesse ponto ainda nao ha nada para desfazer.
  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email: admin_email, email_confirm: true, user_metadata: {},
  });
  if (createErr || !created?.user) {
    return j({ error: "email_already_registered", detail: "Ja existe uma conta com este e-mail." }, 409);
  }
  const userId = created.user.id;

  const desfazer = async () => {
    await db.auth.admin.deleteUser(userId);
    const { error } = await db.rpc("release_trial_document", { p_doc_hash: doc_hash });
    if (error) console.error("release_trial_document failed:", error.message);
  };

  const { data: disponivel, error: claimErr } = await db.rpc("claim_trial_document", {
    p_doc_hash: doc_hash, p_doc_type: doc_type, p_tenant_id: null,
  });
  if (claimErr || disponivel === false) {
    await db.auth.admin.deleteUser(userId); // ainda nao reservou nada: so o usuario sai
    if (claimErr) return j({ error: "db_error", detail: claimErr.message }, 500);
    return j({ error: "document_already_used", detail: "Este documento ja possui uma conta." }, 409);
  }

  const { data: intent, error: intentErr } = await db.from("signup_intents").insert({
    company_name, admin_email, phone: phone || null, consent,
    plan_code: FREE_PLAN, billing_cycle: "monthly", amount_cents: 0,
    cnpj: doc_type === "cnpj" ? doc : null,
    status: "pending", environment: ENV,
  }).select("id").single();
  if (intentErr) {
    await desfazer();
    return j({ error: "db_error", detail: intentErr.message }, 500);
  }

  const { data: tenantId, error: provErr } = await db.rpc("provision_from_intent", {
    p_intent_id: intent.id, p_admin_user_id: userId,
  });
  if (provErr) {
    await desfazer();
    await db.from("signup_intents")
      .update({ status: "failed", failure_reason: `provision_failed: ${provErr.message}` })
      .eq("id", intent.id);
    return j({ error: "provision_failed", detail: provErr.message }, 500);
  }

  const { error: attachErr } = await db.rpc("attach_trial_tenant", {
    p_doc_hash: doc_hash, p_tenant_id: tenantId,
  });
  if (attachErr) console.error("attach_trial_tenant failed:", attachErr.message);

  try {
    await db.auth.admin.updateUserById(userId, { app_metadata: { tenant_id: tenantId, role: "admin" } });
  } catch (_) { /* nao-fatal */ }

  const { error: mailErr } = await pub.auth.resetPasswordForEmail(admin_email);
  if (mailErr) console.error("set-password email failed:", mailErr.message);

  return j({ ok: true, tenant_id: tenantId, free: true, email_sent: !mailErr });
});
