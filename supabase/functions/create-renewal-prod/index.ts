// AcessoFast — create-renewal-prod (v3)
// PRODUCAO. Tenant que JA EXISTE: trial->pagante, renovacao, troca de plano.
// verify_jwt = TRUE: quem chama e o admin logado. Tenant vem do JWT, nunca do body.
//
// v3 (31/07/2026) — consome o cupom aplicado no painel:
//   A apply_promo_code_to_tenant deixa o desconto RESERVADO num
//   promo_code_redemptions com consumed_at null. Quem transforma isso em dinheiro
//   e este checkout, do mesmo jeito que a create-checkout-prod faz no site:
//   baixando items[].value, que e o unico lever de desconto do checkout do Asaas.
//
//     anual                        -> cobranca unica ja sai com desconto.
//     mensal, discount_months null -> desconto em todas as cobrancas (a semantica
//                                     de null em promo_codes).
//     mensal, discount_months = N  -> abre promo_subscription_windows; a
//                                     asaas-webhook-prod conta N cobrancas pagas
//                                     e devolve o valor cheio na assinatura.
//
//   O resgate NAO e apagado quando o checkout falha — diferente do site, aqui o
//   cupom foi aplicado deliberadamente na conta e some-lo por um 502 do Asaas
//   seria roubar um beneficio que ja e do cliente. So a amarracao com a intencao
//   e desfeita; o cupom continua reservado para a proxima tentativa. Quem fecha
//   o resgate e a apply_paid_plan, no webhook, quando a cobranca e provisionada.
//
// v2 — MAX_INSTALLMENTS 12 -> 3 (decisao de negocio jul/2026: anual pago a
// vista, cliente parcela no cartao em ate 3x; plano vale 12 meses).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const ENV = "production";
const ASAAS_API = "https://api.asaas.com/v3";
const ASAAS_CHECKOUT_BASE = "https://asaas.com/checkoutSession/show?id=";
const ASAAS_KEY = Deno.env.get("ASAAS_API_KEY_PROD")!;
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const SITE = "https://acessofast.com.br";
const PANEL = "https://app.acessofast.com.br";
const URL_SUCCESS = `${SITE}/obrigado`;
const URL_CANCEL = PANEL;
const URL_EXPIRED = PANEL;
const PAID_PLANS = ["team", "business", "scale"];  // individual=gratis, enterprise=assistido
const MAX_INSTALLMENTS = 3; // anual: valor cheio a vista p/ AcessoFast; cliente parcela ate 3x no cartao

// Piso do Asaas para cobranca no cartao. Um cupom que derrube o valor abaixo
// disso seria recusado la na frente com erro opaco.
const MIN_CHARGE_CENTS = 500;

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
  const plan_code = String(b.plan_code ?? "").trim().toLowerCase();
  const billing_cycle = String(b.billing_cycle ?? "monthly").trim().toLowerCase();

  if (!PAID_PLANS.includes(plan_code)) return j({ error: "plan_not_purchasable" }, 400);
  if (billing_cycle !== "monthly" && billing_cycle !== "annual")
    return j({ error: "invalid_billing_cycle" }, 400);

  // 1) Identidade: o tenant vem do JWT do admin, nunca do request.
  const userClient = createClient(SB_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: udata, error: uerr } = await userClient.auth.getUser();
  const user = udata?.user;
  if (uerr || !user) return j({ error: "unauthenticated" }, 401);

  const db = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

  const { data: prof } = await db.from("profiles")
    .select("tenant_id, role, is_active").eq("id", user.id).maybeSingle();
  if (!prof || prof.is_active === false) return j({ error: "user_inactive" }, 403);
  if (prof.role !== "admin") return j({ error: "forbidden_role" }, 403);  // so admin assina
  if (!prof.tenant_id) return j({ error: "no_tenant" }, 400);
  const tenantId = prof.tenant_id;

  // 2) Tenant + plano do catalogo
  const { data: tenant } = await db.from("tenants")
    .select("id, company_name:name, billing_email, asaas_customer_id, billing_exempt").eq("id", tenantId).maybeSingle();
  if (!tenant) return j({ error: "tenant_not_found" }, 404);
  if (tenant.billing_exempt) return j({ error: "tenant_exempt", detail: "Conta isenta de cobranca." }, 409);

  const { data: plan } = await db.from("plans")
    .select("code, name, price_month_cents, price_year_cents, max_users, is_active").eq("code", plan_code).maybeSingle();
  if (!plan || !plan.is_active) return j({ error: "unknown_plan" }, 400);

  // 3) REGRA A — bloqueio de downgrade. Mesma contagem da assign_plan.
  const { count: activeUsers } = await db.from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId).eq("is_active", true).neq("role", "super_admin");
  if (plan.max_users != null && (activeUsers ?? 0) > plan.max_users) {
    return j({ error: "downgrade_blocked",
               detail: `Seu tenant tem ${activeUsers} usuarios ativos; o plano ${plan.name} permite ${plan.max_users}. Desative usuarios antes de trocar.`,
               active_users: activeUsers, plan_limit: plan.max_users }, 409);
  }

  const full_cents = billing_cycle === "annual" ? plan.price_year_cents : plan.price_month_cents;
  if (!full_cents || full_cents < 1) return j({ error: "plan_has_no_price" }, 400);

  // 4) (v3) CUPOM RESERVADO. Os beneficios usados sao os congelados no resgate:
  //    se o cupom mudou no catalogo depois, quem ja resgatou nao acompanha.
  //    Nada aqui pode impedir uma renovacao: em qualquer duvida o checkout segue
  //    com o valor cheio e a resposta diz por que o cupom nao entrou.
  let promo = null;
  let promo_skipped = null;
  {
    const { data, error } = await db.from("promo_code_redemptions")
      .select("id, code, applied_discount_percent, applied_discount_months, promo_codes(plan_codes)")
      .eq("tenant_id", tenantId)
      // Resgate do site ja nasce consumido; reservado so existe vindo do painel.
      .eq("source", "app")
      .is("consumed_at", null)
      .not("applied_discount_percent", "is", null)
      .order("redeemed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("leitura do cupom reservado falhou (nao-fatal):", error.message);
    } else if (data) {
      // O embed de um-para-muitos volta objeto; aceitar array tambem custa uma
      // linha e evita quebrar se o PostgREST mudar de ideia.
      const rel = Array.isArray(data.promo_codes) ? data.promo_codes[0] : data.promo_codes;
      const planos = rel?.plan_codes ?? null;
      if (planos !== null && !planos.includes(plan_code)) {
        promo_skipped = "plan_not_eligible";
      } else {
        promo = data;
      }
    }
  }

  let amount_cents = full_cents;
  if (promo) {
    const candidato = Math.round((full_cents * (100 - promo.applied_discount_percent)) / 100);
    if (candidato < MIN_CHARGE_CENTS) {
      // O Asaas recusaria a cobranca. Melhor renovar sem desconto e manter o
      // cupom reservado do que travar o cliente.
      promo_skipped = "discount_too_large";
      promo = null;
    } else {
      amount_cents = candidato;
    }
  }

  // A janela so faz sentido no mensal com prazo. No anual a cobranca e unica; no
  // mensal sem prazo o desconto vale enquanto a assinatura durar, que e o que o
  // value reduzido ja faz.
  const precisaJanela =
    !!promo && promo.applied_discount_months !== null && billing_cycle === "monthly";

  // 5) Intencao JA COM tenant_id: e esse campo que faz o webhook chamar apply_paid_plan.
  const { data: intent, error: intentErr } = await db.from("signup_intents").insert({
    company_name: tenant.company_name, admin_email: tenant.billing_email ?? user.email,
    consent: true, plan_code, billing_cycle, amount_cents,
    status: "pending", environment: ENV, tenant_id: tenantId,
  }).select("id").single();
  if (intentErr) return j({ error: "db_error", detail: intentErr.message }, 500);

  // Desfaz so o que este checkout criou. O resgate continua vivo e reservado.
  let windowId = null;
  const desfazer = async (motivo) => {
    if (windowId) {
      const { error } = await db.from("promo_subscription_windows")
        .update({ status: "cancelled" }).eq("id", windowId);
      if (error) console.error("cancelar janela falhou:", error.message);
    }
    if (promo) {
      const { error } = await db.from("promo_code_redemptions")
        .update({ consumed_intent_id: null }).eq("id", promo.id);
      if (error) console.error("soltar resgate falhou:", error.message);
    }
    await db.from("signup_intents")
      .update({ status: "failed", failure_reason: motivo }).eq("id", intent.id);
  };

  if (promo) {
    const { error } = await db.from("promo_code_redemptions")
      .update({ consumed_intent_id: intent.id }).eq("id", promo.id);
    if (error) {
      // Sem essa amarracao a apply_paid_plan nao fecharia o resgate e o desconto
      // voltaria a valer na renovacao seguinte.
      await desfazer(`promo_link_failed: ${error.message}`);
      return j({ error: "db_error", detail: error.message }, 500);
    }
  }

  if (precisaJanela) {
    const { data: wid, error: wErr } = await db.rpc("promo_window_open", {
      p_redemption_id: promo.id,
      p_signup_intent_id: intent.id,
      p_full_value_cents: full_cents,
      p_discounted_value_cents: amount_cents,
      p_discount_months: promo.applied_discount_months,
      p_environment: ENV,
    });
    if (wErr) {
      // Sem a janela o desconto de N meses viraria vitalicio na assinatura.
      console.error("promo_window_open failed:", wErr.message);
      await desfazer(`promo_window_open_failed: ${wErr.message}`);
      return j({ error: "db_error", detail: wErr.message }, 500);
    }
    windowId = wid;
  }

  // 6) Checkout no Asaas. Anual = DETACHED+INSTALLMENT (ate 3x); mensal = assinatura recorrente.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const sufixoDesconto = promo ? ` — ${promo.applied_discount_percent}% OFF (${promo.code})` : "";
  const payload = {
    billingTypes: ["CREDIT_CARD"],
    minutesToExpire: 60,
    externalReference: intent.id,
    callback: { successUrl: URL_SUCCESS, cancelUrl: URL_CANCEL, expiredUrl: URL_EXPIRED },
    items: [{
      name: plan.name,
      description: `${billing_cycle === "annual" ? "Plano anual" : "Assinatura mensal"} — ${plan.name}${sufixoDesconto}`,
      quantity: 1, value: amount_cents / 100,
    }],
    ...(tenant.asaas_customer_id ? { customer: tenant.asaas_customer_id } : {}),
  };
  if (billing_cycle === "annual") {
    payload.chargeTypes = ["DETACHED", "INSTALLMENT"];
    payload.installment = { maxInstallmentCount: MAX_INSTALLMENTS };
  } else {
    payload.chargeTypes = ["RECURRENT"];
    payload.subscription = { cycle: "MONTHLY", nextDueDate: today };
  }

  let res, body;
  try {
    res = await fetch(`${ASAAS_API}/checkouts`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json",
                 access_token: ASAAS_KEY, "User-Agent": "AcessoFast/1.0" },
      body: JSON.stringify(payload),
    });
    body = await res.json();
  } catch (e) {
    await desfazer("asaas_unreachable");
    return j({ error: "asaas_unreachable", detail: String(e) }, 502);
  }
  if (!res.ok || !body?.id) {
    await desfazer(`asaas_${res.status}: ${JSON.stringify(body?.errors ?? body).slice(0, 400)}`);
    return j({ error: "asaas_error", status: res.status, detail: body?.errors ?? null }, 502);
  }

  await db.from("signup_intents").update({ asaas_checkout_id: body.id }).eq("id", intent.id);
  return j({
    ok: true,
    intent_id: intent.id,
    checkout_url: ASAAS_CHECKOUT_BASE + body.id,
    amount_cents,
    full_amount_cents: full_cents,
    promo_code: promo?.code ?? null,
    discount_percent: promo?.applied_discount_percent ?? null,
    discount_months: promo?.applied_discount_months ?? null,
    promo_skipped,
  });
});
