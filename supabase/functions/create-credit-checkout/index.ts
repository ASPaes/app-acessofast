// AcessoFast — create-credit-checkout (v1)
// PRODUCAO. Compra avulsa de pacote de creditos pelo Asaas.
// verify_jwt = TRUE: quem chama e o admin logado. Tenant vem do JWT, nunca do body.
//
// Fluxo:
//   1. grava credit_purchases (pending) com creditos e valor CONGELADOS do catalogo;
//   2. abre checkout DETACHED no Asaas com externalReference = credit_purchases.id;
//   3. a asaas-webhook-prod acha a compra pelo checkout (ou pela externalReference)
//      e chama grant_credit_purchase, que lanca o 'purchase' no credit_ledger.
//
// Nao usa signup_intents de proposito: la, intencao com tenant_id vira troca de
// plano no webhook (apply_paid_plan).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const ENV = "production";
const ASAAS_API = "https://api.asaas.com/v3";
const ASAAS_CHECKOUT_BASE = "https://asaas.com/checkoutSession/show?id=";
const ASAAS_KEY = Deno.env.get("ASAAS_API_KEY_PROD")!;
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const PANEL = "https://app.acessofast.com.br";
const URL_SUCCESS = `${PANEL}/financeiro?compra=ok`;
const URL_CANCEL = `${PANEL}/financeiro`;
const URL_EXPIRED = `${PANEL}/financeiro`;

// Pix primeiro: e compra avulsa, pequena, e o cliente costuma preferir. Se a conta
// do Asaas recusar Pix no checkout (sem chave cadastrada), cai para so cartao em
// vez de deixar o botao quebrado.
const BILLING_TYPES_TENTATIVAS = [["PIX", "CREDIT_CARD"], ["CREDIT_CARD"]];

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "access-control-allow-methods": "POST, OPTIONS",
};
const j = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", ...CORS } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return j({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return j({ error: "missing_authorization" }, 401);

  let b; try { b = await req.json(); } catch { return j({ error: "invalid_json" }, 400); }
  const package_code = String(b.package_code ?? "").trim().toLowerCase();
  if (!package_code) return j({ error: "missing_package_code" }, 400);

  // 1) Identidade: o tenant vem do JWT do admin.
  const userClient = createClient(SB_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: udata, error: uerr } = await userClient.auth.getUser();
  const user = udata?.user;
  if (uerr || !user) return j({ error: "unauthenticated" }, 401);

  const db = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

  const { data: prof } = await db.from("profiles")
    .select("tenant_id, role, is_active").eq("id", user.id).maybeSingle();
  if (!prof || prof.is_active === false) return j({ error: "user_inactive" }, 403);
  if (prof.role !== "admin")
    return j({ error: "forbidden_role", detail: "Só o administrador da conta pode comprar créditos." }, 403);
  if (!prof.tenant_id) return j({ error: "no_tenant" }, 400);

  // 2) Conta: credito so existe para conta individual (free/credits). Plano nao consome.
  const { data: tenant } = await db.from("tenants")
    .select("id, name, billing_mode, asaas_customer_id, is_active").eq("id", prof.tenant_id).maybeSingle();
  if (!tenant) return j({ error: "tenant_not_found" }, 404);
  if (tenant.is_active === false) return j({ error: "tenant_inactive", detail: "Conta inativa." }, 409);
  if (tenant.billing_mode === "plan")
    return j({ error: "plan_has_no_credits", detail: "Sua conta tem plano: o atendimento não consome crédito." }, 409);

  // 3) Pacote do catalogo. Valor e quantidade saem daqui, nunca do request.
  const { data: pkg } = await db.from("credit_packages")
    .select("code, credits, price_cents, is_active").eq("code", package_code).maybeSingle();
  if (!pkg || !pkg.is_active) return j({ error: "unknown_package", detail: "Pacote indisponível." }, 400);
  if (!pkg.price_cents || pkg.price_cents < 500)
    return j({ error: "package_has_no_price", detail: "Pacote sem preço definido." }, 400);

  const { data: compra, error: insErr } = await db.from("credit_purchases").insert({
    tenant_id: tenant.id, package_code: pkg.code, credits: pkg.credits,
    amount_cents: pkg.price_cents, environment: ENV, created_by: user.id,
  }).select("id").single();
  if (insErr) return j({ error: "db_error", detail: insErr.message }, 500);

  const falhar = async (motivo) => {
    await db.from("credit_purchases")
      .update({ status: "failed", failure_reason: motivo }).eq("id", compra.id);
  };

  // 4) Checkout avulso no Asaas.
  const base = {
    chargeTypes: ["DETACHED"],
    minutesToExpire: 60,
    externalReference: compra.id,
    callback: { successUrl: URL_SUCCESS, cancelUrl: URL_CANCEL, expiredUrl: URL_EXPIRED },
    items: [{
      name: `${pkg.credits} créditos AcessoFast`,
      description: `Pacote de ${pkg.credits} créditos — 1 crédito por atendimento`,
      quantity: 1, value: pkg.price_cents / 100,
    }],
    ...(tenant.asaas_customer_id ? { customer: tenant.asaas_customer_id } : {}),
  };

  let res, body;
  for (const billingTypes of BILLING_TYPES_TENTATIVAS) {
    try {
      res = await fetch(`${ASAAS_API}/checkouts`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json",
                   access_token: ASAAS_KEY, "User-Agent": "AcessoFast/1.0" },
        body: JSON.stringify({ ...base, billingTypes }),
      });
      body = await res.json();
    } catch (e) {
      await falhar("asaas_unreachable");
      return j({ error: "asaas_unreachable", detail: "Não foi possível falar com o meio de pagamento. Tente de novo." }, 502);
    }
    if (res.ok && body?.id) break;
    // So 400 justifica tentar sem Pix; 401/5xx nao mudam trocando a forma de pagamento.
    if (res.status !== 400) break;
    console.error(`checkout recusado com ${billingTypes.join("+")}:`, JSON.stringify(body?.errors ?? body).slice(0, 400));
  }
  if (!res.ok || !body?.id) {
    await falhar(`asaas_${res.status}: ${JSON.stringify(body?.errors ?? body).slice(0, 400)}`);
    return j({ error: "asaas_error", status: res.status, detail: body?.errors?.[0]?.description ?? null }, 502);
  }

  await db.from("credit_purchases").update({ asaas_checkout_id: body.id }).eq("id", compra.id);
  return j({
    ok: true,
    purchase_id: compra.id,
    checkout_url: ASAAS_CHECKOUT_BASE + body.id,
    credits: pkg.credits,
    amount_cents: pkg.price_cents,
  });
});
