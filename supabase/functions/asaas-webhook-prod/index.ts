// AcessoFast — asaas-webhook-prod (v3)
// PRODUCAO. verify_jwt = FALSE: quem chama e o Asaas (sem JWT); auth via header
// asaas-access-token.
// REGRA DE OURO: sempre responder 200 (exceto token invalido). 15 nao-2xx
// seguidas fazem o Asaas PAUSAR a fila inteira.
//
// v3 (30/09/2026) — compra de creditos:
//   A create-credit-checkout grava credit_purchases e abre checkout avulso com
//   externalReference = credit_purchases.id. Aqui, ANTES de qualquer logica de
//   plano, procuramos a compra pelo checkout ou pela externalReference. Achou:
//   o evento e da compra e so dela — paga, chama grant_credit_purchase (que
//   credita uma vez so, mesmo com CHECKOUT_PAID + CONFIRMED + RECEIVED) e sai.
//   Nao cai nos caminhos de renovacao/reativacao/conta nova, que tratariam o
//   pagamento avulso como plano.
//
// v2 (30/07/2026) — fecha a janela de desconto do voucher:
//   Quando um voucher da desconto por N meses num plano MENSAL, a
//   create-checkout-prod cria a assinatura ja com o valor reduzido e abre uma
//   promo_subscription_windows. O Asaas nao sabe que o desconto expira — para
//   ele aquele e o preco da assinatura. Entao contamos aqui: a cada cobranca
//   paga, promo_window_register_payment soma 1 (deduplicando por payment id,
//   porque CONFIRMED e RECEIVED chegam para a mesma cobranca) e, ao atingir N,
//   fazemos PUT /v3/subscriptions/{id} com o valor cheio e
//   updatePendingPayments=true, que corrige tambem a cobranca seguinte caso o
//   Asaas ja a tenha gerado.
//
//   Todo esse trecho e nao-fatal e vive dentro de try/catch: uma falha ali nao
//   pode derrubar a provisao nem fazer o webhook responder != 200. Se o PUT
//   falhar, a janela continua 'active' e a proxima cobranca (ou o
//   promo-restore-sweep) tenta de novo.
//
// v1 — copia fiel da asaas-webhook-sandbox v6 com environment='production'.
import { createClient } from "npm:@supabase/supabase-js@2";

const ENV = "production";
const ASAAS_API = "https://api.asaas.com/v3";
const ASAAS_KEY = Deno.env.get("ASAAS_API_KEY_PROD")!;
const WEBHOOK_TOK = Deno.env.get("ASAAS_WEBHOOK_TOKEN_PROD")!;
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const PROVISION_EVENTS = ["CHECKOUT_PAID", "PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ok = (b) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });

function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function isento(t) {
  return !!t?.billing_exempt
    && (t.billing_exempt_until === null || t.billing_exempt_until === undefined
        || new Date(t.billing_exempt_until) > new Date());
}

// (v2) Devolve o preco de tabela na assinatura. updatePendingPayments=true para
// alcancar tambem a cobranca que o Asaas ja tenha gerado com o valor antigo.
async function restaurarValorAsaas(subscriptionId, fullCents) {
  try {
    const r = await fetch(`${ASAAS_API}/subscriptions/${subscriptionId}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        access_token: ASAAS_KEY,
        "User-Agent": "AcessoFast/1.0",
      },
      body: JSON.stringify({ value: fullCents / 100, updatePendingPayments: true }),
    });
    const body = await r.json().catch(() => null);
    if (!r.ok) {
      return { ok: false, detail: `asaas_${r.status}: ${JSON.stringify(body?.errors ?? body).slice(0, 300)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: `asaas_unreachable: ${String(e).slice(0, 300)}` };
  }
}

// (v2) Nao-fatal por construcao: qualquer erro so vira log.
async function processarJanelaVoucher(db, intentId, subscriptionId, paymentId) {
  try {
    const { data, error } = await db.rpc("promo_window_register_payment", {
      p_signup_intent_id: intentId,
      p_subscription_id: subscriptionId,
      p_payment_id: paymentId,
    });
    if (error) {
      console.error("promo_window_register_payment failed:", error.message);
      return;
    }
    // Sem janela para esta assinatura: o caso normal, nao ha o que fazer.
    const w = Array.isArray(data) ? data[0] : data;
    if (!w?.window_id) return;
    if (!w.needs_restore) return;

    const r = await restaurarValorAsaas(subscriptionId, w.full_value_cents);
    if (r.ok) {
      const { error: e } = await db.rpc("promo_window_mark_restored", { p_window_id: w.window_id });
      if (e) console.error("promo_window_mark_restored failed:", e.message);
      else console.log("voucher: valor cheio restaurado", subscriptionId);
    } else {
      console.error("voucher: PUT no Asaas falhou:", r.detail);
      const { error: e } = await db.rpc("promo_window_mark_failed", {
        p_window_id: w.window_id, p_error: r.detail,
      });
      if (e) console.error("promo_window_mark_failed failed:", e.message);
    }
  } catch (e) {
    console.error("janela de voucher falhou (nao-fatal):", String(e));
  }
}

// (v3) Compra de creditos ligada a este evento, ou null. Erro de leitura vira
// null e o evento segue o caminho antigo — que, sem intencao, so registra.
async function acharCompraDeCredito(db, checkoutSession, externalReference) {
  try {
    if (checkoutSession) {
      const { data } = await db.from("credit_purchases").select("id, status")
        .eq("asaas_checkout_id", checkoutSession).maybeSingle();
      if (data) return data;
    }
    if (externalReference && UUID_RE.test(externalReference)) {
      const { data } = await db.from("credit_purchases").select("id, status")
        .eq("id", externalReference).maybeSingle();
      if (data) return data;
    }
  } catch (e) {
    console.error("busca de compra de credito falhou:", String(e));
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  const tok = req.headers.get("asaas-access-token") ?? "";
  if (!WEBHOOK_TOK || !safeEq(tok, WEBHOOK_TOK)) {
    console.error("webhook auth failed");
    return new Response("unauthorized", { status: 401 });
  }

  let ev; try { ev = await req.json(); } catch { return ok({ ignored: "invalid_json" }); }

  const event_id = String(ev?.id ?? "");
  const event_type = String(ev?.event ?? "");
  const payment = ev?.payment ?? null;
  const checkout = ev?.checkout ?? null;
  if (!event_id || !event_type) return ok({ ignored: "missing_event_fields" });

  const db = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const pub = createClient(SB_URL, ANON_KEY, { auth: { persistSession: false } });

  const checkout_session = payment?.checkoutSession ?? checkout?.id ?? null;
  const external_reference = payment?.externalReference ?? checkout?.externalReference ?? checkout_session ?? null;

  const { data: evRow, error: insErr } = await db.from("asaas_events").insert({
    event_id, event_type,
    payment_id: payment?.id ?? null,
    subscription_id: payment?.subscription ?? null,
    external_reference,
    payload: ev,
    environment: ENV,
  }).select("id").maybeSingle();
  if (insErr) {
    if (insErr.code === "23505") return ok({ ignored: "duplicate_event", event_id });
    console.error("asaas_events insert failed:", insErr.message);
    return ok({ ignored: "event_store_failed" });
  }

  const finish = async (result, extra = {}) => {
    await db.from("asaas_events")
      .update({ processed: true, processing_result: result, processed_at: new Date().toISOString() })
      .eq("event_id", event_id);
    return ok({ ok: true, result, ...extra });
  };

  // 2b) (v3) COMPRA DE CREDITOS — isolada do resto. Evento de compra nunca
  //     segue para renovacao/reativacao/conta nova.
  const compra = await acharCompraDeCredito(db, checkout_session, external_reference);
  if (compra) {
    if (!PROVISION_EVENTS.includes(event_type)) return await finish("credit_purchase_recorded");
    const { data, error } = await db.rpc("grant_credit_purchase", {
      p_purchase_id: compra.id,
      p_payment_id: payment?.id ?? null,
      p_event_id: evRow?.id ?? null,
    });
    if (error) {
      console.error("grant_credit_purchase failed:", error.message);
      await db.from("credit_purchases")
        .update({ failure_reason: `grant_failed: ${error.message}` }).eq("id", compra.id);
      return await finish("credit_grant_failed", { detail: error.message });
    }
    const g = Array.isArray(data) ? data[0] : data;
    return await finish(g?.already_granted ? "credit_already_granted" : "credit_granted",
                        { tenant_id: g?.tenant_id, credits: g?.credits });
  }

  // 3) Localiza a intencao. Traz tenant_id e billing_cycle.
  let intent = null;
  const ICOLS = "id, status, admin_email, company_name, asaas_customer_id, tenant_id, billing_cycle";
  if (checkout_session) {
    const { data } = await db.from("signup_intents").select(ICOLS)
      .eq("asaas_checkout_id", checkout_session).maybeSingle();
    intent = data ?? null;
  }
  if (!intent && payment?.externalReference) {
    const { data } = await db.from("signup_intents").select(ICOLS)
      .eq("id", payment.externalReference).maybeSingle();
    intent = data ?? null;
  }

  // 4) Vincula os IDs do Asaas a intencao assim que der.
  if (intent && payment) {
    await db.from("signup_intents").update({
      asaas_customer_id: payment?.customer ?? null,
      asaas_subscription_id: payment?.subscription ?? null,
      asaas_payment_id: payment?.id ?? null,
      updated_at: new Date().toISOString(),
    }).eq("id", intent.id);
  }

  // 5) Localiza o TENANT por subscription/customer (renovacao/inadimplencia).
  let tenant = null;
  const TCOLS = "id, billing_status, billing_exempt, billing_exempt_until, asaas_subscription_id, asaas_customer_id";
  if (payment?.subscription) {
    const { data } = await db.from("tenants").select(TCOLS)
      .eq("asaas_subscription_id", payment.subscription).maybeSingle();
    tenant = data ?? null;
  }
  if (!tenant && payment?.customer) {
    const { data } = await db.from("tenants").select(TCOLS)
      .eq("asaas_customer_id", payment.customer).maybeSingle();
    tenant = data ?? null;
  }

  // 6) Backfill dos IDs do Asaas no tenant.
  if (tenant && payment) {
    const faltando = {};
    if (!tenant.asaas_subscription_id && payment.subscription) faltando.asaas_subscription_id = payment.subscription;
    if (!tenant.asaas_customer_id && payment.customer) faltando.asaas_customer_id = payment.customer;
    if (Object.keys(faltando).length) {
      await db.from("tenants").update(faltando).eq("id", tenant.id);
    }
  }

  // 6b) (v2) VOUCHER — conta a cobranca e, no fim da janela, devolve o preco
  //     cheio. Antes do desvio de inadimplencia porque este trecho so olha
  //     cobranca paga, e nao-fatal em qualquer cenario.
  if (PROVISION_EVENTS.includes(event_type) && payment?.subscription && payment?.id) {
    await processarJanelaVoucher(db, intent?.id ?? null, payment.subscription, payment.id);
  }

  // 7) INADIMPLENCIA.
  if (event_type === "PAYMENT_OVERDUE" && tenant) {
    if (isento(tenant)) return await finish("tenant_exempt_no_action", { tenant_id: tenant.id });
    if (tenant.billing_status === "active") {
      await db.from("tenants").update({
        billing_status: "past_due",
        past_due_since: new Date().toISOString(),
        billing_invoice_url: payment?.invoiceUrl ?? null,
        updated_at: new Date().toISOString(),
      }).eq("id", tenant.id);
      return await finish("tenant_past_due", { tenant_id: tenant.id });
    }
    await db.from("tenants")
      .update({ billing_invoice_url: payment?.invoiceUrl ?? null, updated_at: new Date().toISOString() })
      .eq("id", tenant.id);
    return await finish("past_due_invoice_updated", { tenant_id: tenant.id });
  }

  // 8) So evento de pagamento concluido segue. O resto fica registrado.
  if (!PROVISION_EVENTS.includes(event_type)) return await finish("recorded_only");

  // 9) CAMINHO RENOVACAO / TRIAL->PAGANTE / TROCA DE PLANO.
  if (intent && intent.tenant_id) {
    if (intent.status === "provisioned") return await finish("already_applied", { tenant_id: intent.tenant_id });
    const { data: tid, error: applyErr } = await db.rpc("apply_paid_plan", { p_intent_id: intent.id });
    if (applyErr) {
      await db.from("signup_intents")
        .update({ status: "failed", failure_reason: `apply_paid_plan_failed: ${applyErr.message}` })
        .eq("id", intent.id);
      return await finish("apply_paid_plan_failed", { detail: applyErr.message });
    }
    return await finish("plan_applied", { tenant_id: tid });
  }

  // 10) REATIVACAO por pagamento avulso (sem intencao vinculada).
  if (tenant && !isento(tenant)
      && (tenant.billing_status === "past_due" || tenant.billing_status === "suspended")) {
    await db.from("tenants").update({
      billing_status: "active",
      past_due_since: null,
      billing_invoice_url: null,
      updated_at: new Date().toISOString(),
    }).eq("id", tenant.id);
    return await finish("tenant_reactivated", { tenant_id: tenant.id });
  }

  // 11) CAMINHO CONTA NOVA (1a compra): cria usuario + tenant + plano.
  if (!intent) return await finish("intent_not_found");
  if (intent.status === "provisioned") return await finish("already_provisioned");

  const customerId = payment?.customer ?? intent.asaas_customer_id ?? null;
  let cnpj = null;
  if (customerId) {
    try {
      const r = await fetch(`${ASAAS_API}/customers/${customerId}`, {
        headers: { accept: "application/json", access_token: ASAAS_KEY, "User-Agent": "AcessoFast/1.0" },
      });
      if (r.ok) { const c = await r.json(); cnpj = (c?.cpfCnpj ?? "").replace(/\D/g, "") || null; }
    } catch (e) { console.error("customer fetch failed:", String(e)); }
  }
  if (cnpj) await db.from("signup_intents").update({ cnpj }).eq("id", intent.id);

  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email: intent.admin_email, email_confirm: true, user_metadata: {},
  });
  if (createErr || !created?.user) {
    await db.from("signup_intents")
      .update({ status: "failed", failure_reason: `create_user_failed: ${createErr?.message ?? "unknown"}` })
      .eq("id", intent.id);
    return await finish("create_user_failed", { detail: createErr?.message });
  }
  const userId = created.user.id;

  const { data: tenantId, error: provErr } = await db.rpc("provision_from_intent", {
    p_intent_id: intent.id, p_admin_user_id: userId,
  });
  if (provErr) {
    await db.auth.admin.deleteUser(userId);
    await db.from("signup_intents")
      .update({ status: "failed", failure_reason: `provision_failed: ${provErr.message}` })
      .eq("id", intent.id);
    return await finish("provision_failed", { detail: provErr.message });
  }

  try {
    await db.auth.admin.updateUserById(userId, { app_metadata: { tenant_id: tenantId, role: "admin" } });
  } catch (_) { /* nao-fatal */ }

  const { error: mailErr } = await pub.auth.resetPasswordForEmail(intent.admin_email);
  if (mailErr) {
    console.error("set-password email failed:", mailErr.message);
    return await finish("provisioned_email_failed", { tenant_id: tenantId, user_id: userId });
  }

  return await finish("provisioned", { tenant_id: tenantId, user_id: userId });
});
