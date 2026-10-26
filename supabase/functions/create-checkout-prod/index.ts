// AcessoFast — create-checkout-prod (v7)
// PRODUCAO. verify_jwt = FALSE: chamado pelo site comercial (visitante anonimo).
//
// v7 (26/10/2026) — indicacao de revendedor; codigo trazido para o repo:
//   Ate a v6 o codigo vivia so no Supabase. `indicacao` opcional no body: o
//   codigo do link do revendedor que o site guardou no navegador. Fica gravada
//   pela intencao, porque a empresa so nasce no pagamento; la a
//   asaas-webhook-prod liga a indicacao a empresa e conta a venda. Nao-fatal:
//   codigo errado ou falha aqui nunca impede o checkout.
//
// v6 (21/08/2026) — o preco de lancamento passa a ter PRAZO:
//   Antes ele era definitivo para quem entrasse entre as primeiras empresas.
//   Agora vale por launch_offer.discount_months (12) e depois a assinatura volta
//   ao preco de tabela — a mesma promessa que o site anuncia.
//
//   No anual nada muda: a cobranca e unica e ja cobre o periodo. No MENSAL abre
//   uma promo_subscription_windows, exatamente como o voucher com prazo faz; a
//   asaas-webhook-prod conta as cobrancas pagas e devolve o valor cheio na
//   decima terceira. A janela nasce com redemption_id NULL, que e como se
//   distingue "desconto de lancamento" de "desconto de voucher".
//
// v5 (21/08/2026) — oferta de lancamento (public.launch_offer):
//   Enquanto sobrar vaga entre as N primeiras empresas contratantes, o valor
//   cobrado sai do preco de tabela com o desconto da oferta. Quem manda e a RPC
//   launch_offer_status — a MESMA que o site le para montar a vitrine e a barra
//   de vagas. Se essa consulta falhar, o checkout ABORTA em vez de cair no preco
//   cheio: cobrar mais do que a pagina prometeu e pior do que nao vender.
//
//   Nao acumula com voucher: vale o MAIOR dos dois descontos. O voucher continua
//   sendo resgatado mesmo quando perde, porque o resgate tambem e o registro de
//   atribuicao do parceiro que indicou a venda.
//
// v4 (30/07/2026) — o resgate passa a levar doc_hash:
//   O assinar nao pedia CPF/CNPJ (quem coleta e o checkout do Asaas), entao o
//   resgate ia com doc_hash null e a mesma empresa podia queimar o mesmo voucher
//   varias vezes — so o teto global (max_redemptions) segurava. Agora, QUANDO ha
//   voucher, o documento e obrigatorio e vira o mesmo HMAC do start-trial-prod,
//   fechando o unique (promo_code_id, doc_hash): um voucher de campanha pode
//   valer 20 usos, mas nao 20 usos da mesma empresa.
//   Sem voucher nada muda: o campo nem aparece e o funil pago segue igual.
//
// v3 (30/07/2026) — voucher de parceiro (promo_codes):
//   `promo_code` opcional no body. Aplica o desconto percentual do voucher
//   baixando items[].value, que e o unico lever de desconto que o checkout do
//   Asaas oferece — o payload nao tem objeto de desconto e o `subscription` so
//   aceita cycle/nextDueDate/endDate.
//
//   Isso cobre inteiramente dois casos:
//     anual                        -> cobranca unica ja sai com desconto.
//     mensal, discount_months null -> desconto em todas as cobrancas, que e a
//                                     semantica de null em promo_codes.
//   E deixa um terceiro para a janela:
//     mensal, discount_months = N  -> o Asaas cobraria com desconto para sempre.
//                                     Abrimos uma promo_subscription_windows; a
//                                     asaas-webhook-prod conta N cobrancas pagas
//                                     e devolve o valor cheio na assinatura.
//
//   O codigo e conferido ANTES do intent (falha barata) e resgatado depois dele
//   (o resgate precisa do intent.id). Qualquer falha posterior devolve o uso com
//   release_promo_code, que por cascata tambem apaga a janela.
//
// v2 (jul/2026) — MAX_INSTALLMENTS 12 -> 3 (anual pago a vista para a
//   AcessoFast; cliente parcela no cartao em ate 3x; plano vale 12 meses).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const ENV = "production";
const ASAAS_API = "https://api.asaas.com/v3";
const ASAAS_CHECKOUT_BASE = "https://asaas.com/checkoutSession/show?id=";
const ASAAS_KEY = Deno.env.get("ASAAS_API_KEY_PROD")!;
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Mesma chave do start-trial-prod de proposito: o doc_hash tem que ser o mesmo
// nos dois fluxos, senao a mesma empresa apareceria como duas.
const HMAC_KEY = Deno.env.get("TRIAL_DOC_HMAC_KEY")!;

const SITE = "https://acessofast.com.br";
const URL_SUCCESS = `${SITE}/obrigado`;
// /planos nunca existiu como rota: os precos sao a seccao #preco da home. Isso
// mandava para um 404 (e em ingles) justamente quem cancelou ou deixou a sessao
// do Asaas expirar — gente que ainda estava a um clique de assinar.
const URL_CANCEL = `${SITE}/#preco`;
const URL_EXPIRED = `${SITE}/#preco`;
const TZ = "America/Sao_Paulo";

const SELF_SERVE_PLANS = ["team", "business", "scale"]; // enterprise = venda assistida
const MAX_INSTALLMENTS = 3; // anual: valor cheio a vista p/ AcessoFast; cliente parcela ate 3x no cartao

// Piso do Asaas para cobranca no cartao. Um voucher que derrube o valor abaixo
// disso seria recusado la na frente com erro opaco; melhor barrar aqui.
const MIN_CHARGE_CENTS = 500;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "access-control-allow-methods": "POST, OPTIONS",
};
const j = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", ...CORS } });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function hojeBR() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

const RL_IP_LIMIT = 10, RL_EMAIL_LIMIT = 5, RL_WINDOW = 600;
async function rlAllows(db, key, limit, windowSec) {
  try {
    const { data, error } = await db.rpc("rl_hit", { p_key: key, p_limit: limit, p_window_seconds: windowSec });
    if (error) { console.error("rl_hit error (fail-open):", error.message); return true; }
    return data !== false;
  } catch (e) { console.error("rl_hit threw (fail-open):", String(e)); return true; }
}
function clientIp(req) {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) { const first = xff.split(/\s*,\s*/)[0]; if (first) return first.trim(); }
  return (req.headers.get("x-real-ip") ?? "").trim();
}

// (v4) Validacao e HMAC do documento — copia fiel do start-trial-prod para que
// o mesmo CPF/CNPJ produza o mesmo doc_hash nos dois fluxos.
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

// promo_code_preview / redeem_promo_code retornam table(...): sempre 1 linha.
const umaLinha = (data) => (Array.isArray(data) ? data[0] : data);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return j({ error: "method_not_allowed" }, 405);

  let b; try { b = await req.json(); } catch { return j({ error: "invalid_json" }, 400); }

  const company_name = String(b.company_name ?? "").trim().slice(0, 120);
  const admin_email = String(b.admin_email ?? "").trim().toLowerCase().slice(0, 160);
  const phone = String(b.phone ?? "").replace(/\D/g, "").slice(0, 15);
  const plan_code = String(b.plan_code ?? "").trim().toLowerCase();
  const billing_cycle = String(b.billing_cycle ?? "monthly").trim().toLowerCase();
  const consent = b.consent === true;
  const promo_code = String(b.promo_code ?? "").trim().toUpperCase().slice(0, 32);
  const doc = String(b.document ?? "").replace(/\D/g, "");
  const indicacao = String(b.indicacao ?? "").trim().toLowerCase().slice(0, 32);

  if (!company_name) return j({ error: "company_name_required" }, 400);
  if (!EMAIL_RE.test(admin_email)) return j({ error: "invalid_email" }, 400);
  if (!consent) return j({ error: "consent_required" }, 400);
  if (billing_cycle !== "monthly" && billing_cycle !== "annual")
    return j({ error: "invalid_billing_cycle" }, 400);
  if (!SELF_SERVE_PLANS.includes(plan_code))
    return j({ error: "plan_not_self_serve", detail: "Enterprise e venda assistida." }, 400);

  // (v4) So exigimos documento quando ha voucher. Sem voucher o funil pago
  // continua sem pedir nada a mais — quem coleta e o checkout do Asaas.
  let doc_type = null;
  if (promo_code) {
    if (!HMAC_KEY) { console.error("TRIAL_DOC_HMAC_KEY ausente"); return j({ error: "server_misconfig" }, 500); }
    doc_type = doc.length === 11 ? "cpf" : doc.length === 14 ? "cnpj" : null;
    if (!doc_type) return j({ error: "document_required_for_promo" }, 400);
    if (doc_type === "cpf" && !cpfValido(doc)) return j({ error: "invalid_document" }, 400);
    if (doc_type === "cnpj" && !cnpjValido(doc)) return j({ error: "invalid_document" }, 400);
  }

  const db = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

  const ip = clientIp(req);
  if (ip && !(await rlAllows(db, "cc:ip:" + ip, RL_IP_LIMIT, RL_WINDOW)))
    return j({ error: "rate_limited" }, 429);
  if (!(await rlAllows(db, "cc:em:" + admin_email, RL_EMAIL_LIMIT, RL_WINDOW)))
    return j({ error: "rate_limited" }, 429);

  const { data: plan, error: planErr } = await db
    .from("plans").select("code, name, price_month_cents, price_year_cents, is_active")
    .eq("code", plan_code).single();
  if (planErr || !plan) return j({ error: "unknown_plan" }, 400);
  if (!plan.is_active) return j({ error: "plan_inactive" }, 400);

  const full_cents = billing_cycle === "annual" ? plan.price_year_cents : plan.price_month_cents;
  if (!full_cents || full_cents < 1) return j({ error: "plan_has_no_price" }, 400);

  // (v3) Confere o voucher antes de criar qualquer coisa.
  let discount_percent = null;
  let discount_months = null;
  if (promo_code) {
    const { data: pv, error: pvErr } = await db.rpc("promo_code_preview", {
      p_code: promo_code, p_plan_code: plan_code,
    });
    if (pvErr) {
      console.error("promo_code_preview failed:", pvErr.message);
      return j({ error: "db_error", detail: pvErr.message }, 500);
    }
    const linha = umaLinha(pv);
    if (!linha?.ok) return j({ error: "promo_code_invalid", reason: linha?.reason ?? "not_found" }, 400);
    discount_percent = linha.discount_percent ?? null;
    discount_months = linha.discount_months ?? null;
  }

  // (v5) Oferta de lancamento. is_active ja vem combinado com "ainda ha vaga",
  // entao aqui nao se repete regra nenhuma da promocao.
  const { data: lo, error: loErr } = await db.rpc("launch_offer_status");
  if (loErr) {
    // Sem saber se a oferta vale, o valor certo e desconhecido. Abortar e a
    // unica saida que nao arrisca cobrar acima do anunciado.
    console.error("launch_offer_status failed:", loErr.message);
    return j({ error: "db_error", detail: loErr.message }, 500);
  }
  const oferta = umaLinha(lo);
  const launch_percent = oferta?.is_active ? (oferta.discount_percent ?? null) : null;
  // null aqui significa "sem prazo": o preco de lancamento valeria enquanto a
  // assinatura durasse. Hoje vem 12.
  const launch_months = launch_percent === null ? null : (oferta.discount_months ?? null);

  // Os dias extras de trial do voucher nao valem aqui: assinatura nao tem trial.
  // Se o voucher so der dias, ele e aceito e simplesmente nao muda o preco.
  //
  // (v5) Lancamento e voucher NAO se somam: aplica-se o maior. Empate vai para o
  // lancamento, que e a promessa feita na vitrine para todo mundo.
  const usa_lancamento =
    launch_percent !== null && launch_percent >= (discount_percent ?? 0);
  const applied_percent = usa_lancamento ? launch_percent : discount_percent;
  const applied_source = applied_percent === null ? null : usa_lancamento ? "launch" : "promo";

  const amount_cents = applied_percent === null
    ? full_cents
    : Math.round((full_cents * (100 - applied_percent)) / 100);

  if (applied_percent !== null && amount_cents < MIN_CHARGE_CENTS) {
    // Na pratica so um voucher chega a esse ponto; o desconto de lancamento e
    // teto de 90% sobre planos de centenas de reais.
    if (applied_source === "promo")
      return j({ error: "promo_code_invalid", reason: "discount_too_large" }, 400);
    console.error("desconto de lancamento abaixo do minimo do Asaas:", plan_code, amount_cents);
    return j({ error: "amount_below_minimum" }, 400);
  }

  // Prazo do desconto que de fato entrou no preco. (v6) O lancamento tambem tem
  // prazo agora, entao os dois caminhos caem na mesma regra.
  const applied_months =
    applied_source === "launch" ? launch_months : applied_source === "promo" ? discount_months : null;

  // A janela so faz sentido no mensal com prazo. No anual a cobranca e unica e
  // ja cobre o periodo; no mensal sem prazo o desconto vale enquanto a
  // assinatura durar, que e o que o value reduzido ja faz sozinho.
  const precisaJanela =
    applied_percent !== null && applied_months !== null && billing_cycle === "monthly";

  const { data: intent, error: intentErr } = await db
    .from("signup_intents")
    .insert({
      company_name, admin_email, phone: phone || null, consent,
      plan_code, billing_cycle, amount_cents,
      // Mesma regra do start-trial-prod: o CNPJ (identificador de empresa) e
      // gravado; o CPF nunca — dele so existe o HMAC.
      cnpj: doc_type === "cnpj" ? doc : null,
      status: "pending", environment: ENV,
    })
    .select("id").single();
  if (intentErr) return j({ error: "db_error", detail: intentErr.message }, 500);

  // (v3) Resgate. Reconfere sob lock: entre o preview e agora o ultimo uso do
  // codigo pode ter sido consumido por outro checkout.
  let redemptionId = null;
  const desfazer = async (motivo) => {
    if (redemptionId) {
      const { error } = await db.rpc("release_promo_code", { p_redemption_id: redemptionId });
      if (error) console.error("release_promo_code failed:", error.message);
    }
    await db.from("signup_intents")
      .update({ status: "failed", failure_reason: motivo })
      .eq("id", intent.id);
  };

  if (promo_code) {
    // (v4) O doc_hash faz o unique (promo_code_id, doc_hash) valer aqui tambem:
    // a segunda tentativa da mesma empresa volta com reason 'already_used'.
    const doc_hash = await hmacDoc(doc);
    const { data: rd, error: rdErr } = await db.rpc("redeem_promo_code", {
      p_code: promo_code, p_plan_code: plan_code, p_doc_hash: doc_hash,
      p_signup_intent_id: intent.id, p_admin_email: admin_email,
    });
    if (rdErr) {
      await desfazer(`redeem_promo_code_failed: ${rdErr.message}`);
      return j({ error: "db_error", detail: rdErr.message }, 500);
    }
    const linha = umaLinha(rd);
    if (!linha?.ok) {
      await desfazer(`promo_code_invalid: ${linha?.reason ?? "not_found"}`);
      return j({ error: "promo_code_invalid", reason: linha?.reason ?? "not_found" }, 400);
    }
    redemptionId = linha.redemption_id;
  }

  // (v6) Nao depende mais de haver voucher: o desconto de lancamento abre a
  // janela do mesmo jeito, com redemption_id nulo.
  if (precisaJanela) {
    const { error: wErr } = await db.rpc("promo_window_open", {
      p_redemption_id: applied_source === "promo" ? redemptionId : null,
      p_signup_intent_id: intent.id,
      p_full_value_cents: full_cents,
      p_discounted_value_cents: amount_cents,
      p_discount_months: applied_months,
      p_environment: ENV,
    });
    if (wErr) {
      // Sem a janela o desconto viraria vitalicio. Melhor abortar o checkout.
      console.error("promo_window_open failed:", wErr.message);
      await desfazer(`promo_window_open_failed: ${wErr.message}`);
      return j({ error: "db_error", detail: wErr.message }, 500);
    }
  }

  const value = amount_cents / 100;
  const sufixoDesconto =
    applied_source === "launch"
      ? ` — Preco de lancamento ${applied_percent}% OFF`
      : applied_source === "promo"
        ? ` — ${applied_percent}% OFF (${promo_code})`
        : "";
  const payload = {
    billingTypes: ["CREDIT_CARD"],
    minutesToExpire: 60,
    externalReference: intent.id,
    callback: { successUrl: URL_SUCCESS, cancelUrl: URL_CANCEL, expiredUrl: URL_EXPIRED },
    items: [{
      name: plan.name,
      description: `${billing_cycle === "annual" ? "Plano anual" : "Assinatura mensal"} — ${plan.name}${sufixoDesconto}`,
      quantity: 1,
      value,
    }],
  };

  if (billing_cycle === "annual") {
    payload.chargeTypes = ["DETACHED", "INSTALLMENT"];
    payload.installment = { maxInstallmentCount: MAX_INSTALLMENTS };
  } else {
    payload.chargeTypes = ["RECURRENT"];
    payload.subscription = { cycle: "MONTHLY", nextDueDate: hojeBR() };
  }

  let res, body;
  try {
    res = await fetch(`${ASAAS_API}/checkouts`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        access_token: ASAAS_KEY,
        "User-Agent": "AcessoFast/1.0",
      },
      body: JSON.stringify(payload),
    });
    body = await res.json();
  } catch (e) {
    await desfazer("asaas_unreachable");
    return j({ error: "asaas_unreachable", detail: String(e) }, 502);
  }

  if (!res.ok || !body?.id) {
    console.error("asaas checkout error:", res.status, JSON.stringify(body));
    await desfazer(`asaas_${res.status}: ${JSON.stringify(body?.errors ?? body).slice(0, 400)}`);
    return j({ error: "asaas_error", status: res.status, detail: body?.errors ?? null }, 502);
  }

  await db.from("signup_intents").update({ asaas_checkout_id: body.id }).eq("id", intent.id);

  // (v7) Veio pelo link de um revendedor. Depois do checkout aberto, para nao
  // deixar indicacao em intencao que falhou.
  if (indicacao) {
    const { error: indErr } = await db.rpc("registrar_indicacao", {
      p_codigo: indicacao, p_signup_intent_id: intent.id, p_tenant_id: null,
    });
    if (indErr) console.error("registrar_indicacao failed:", indErr.message);
  }

  return j({
    ok: true,
    intent_id: intent.id,
    checkout_url: ASAAS_CHECKOUT_BASE + body.id,
    promo_code: promo_code || null,
    amount_cents,
    full_amount_cents: full_cents,
    // Do voucher, aceito ou nao aplicado por perder para o lancamento.
    discount_percent,
    discount_months,
    // (v5) O que de fato entrou no preco. (v6) applied_months = por quantas
    // cobrancas mensais ele vale; null = enquanto a assinatura durar.
    applied_discount_percent: applied_percent,
    applied_discount_months: applied_months,
    discount_source: applied_source,
    launch_discount_percent: launch_percent,
    launch_discount_months: launch_months,
  });
});
