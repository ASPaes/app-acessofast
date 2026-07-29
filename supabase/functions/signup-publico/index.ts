// signup-publico — cadastro de conta a partir da tela de login do app.
// verify_jwt = false: quem chama e um visitante anonimo.
//
// Duas acoes:
//   lookup — dado o CPF/CNPJ, responde se ja existe empresa com ele (e o nome
//            dela, para o formulario preencher sozinho) e se ha vaga.
//   submit — cria a conta. Se o documento e novo, provisiona uma empresa no
//            plano individual (mesmo caminho da start-free do site comercial,
//            so que com a senha vinda do formulario). Se o documento ja tem
//            dono, cria o usuario SEM empresa e abre uma solicitacao para o
//            admin aprovar.
//
// PRIVACIDADE (LGPD): o CPF/CNPJ nunca e gravado por esta funcao. So o HMAC vai
// ao banco (private.trial_documents), igual a start-free. CNPJ tambem e gravado
// em signup_intents/tenants quando a conta e nova, porque e dado publico da
// Receita e o restante do sistema ja depende disso.

import { createClient } from "npm:@supabase/supabase-js@2";

const ENV = "production";
const FREE_PLAN = "individual";
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HMAC_KEY = Deno.env.get("TRIAL_DOC_HMAC_KEY")!;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SENHA_MIN = 8;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "access-control-allow-methods": "POST, OPTIONS",
};

const j = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { "content-type": "application/json", ...CORS },
  });

function cpfValido(c: string) {
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

function cnpjValido(c: string) {
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (base: string, pesos: number[]) => {
    const s = base.split("").reduce((a, d, i) => a + Number(d) * pesos[i], 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(c.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(c.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(c[12]) && d2 === Number(c[13]);
}

async function hmacDoc(doc: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(HMAC_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(doc));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Rate limit e controle secundario: se o contador falhar, deixa passar.
async function rlAllows(db: any, key: string, limit: number, win: number) {
  try {
    const { data, error } = await db.rpc("rl_hit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: win,
    });
    if (error) {
      console.error("rl_hit error (fail-open):", error.message);
      return true;
    }
    return data !== false;
  } catch (e) {
    console.error("rl_hit threw (fail-open):", String(e));
    return true;
  }
}

function clientIp(req: Request) {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const f = xff.split(/\s*,\s*/)[0];
    if (f) return f.trim();
  }
  return (req.headers.get("x-real-ip") ?? "").trim();
}

type DocInfo = { doc: string; doc_type: "cpf" | "cnpj" } | null;

function lerDocumento(bruto: unknown): DocInfo {
  const doc = String(bruto ?? "").replace(/\D/g, "");
  if (doc.length === 11) return cpfValido(doc) ? { doc, doc_type: "cpf" } : null;
  if (doc.length === 14) return cnpjValido(doc) ? { doc, doc_type: "cnpj" } : null;
  return null;
}

type Empresa = {
  tenant_id: string | null;
  tenant_name: string | null;
  seat_limit: number | null;
  active_users: number | null;
  doc_reservado: boolean;
};

async function buscarEmpresa(db: any, info: NonNullable<DocInfo>): Promise<Empresa> {
  const doc_hash = await hmacDoc(info.doc);
  const { data, error } = await db.rpc("find_tenant_by_document", {
    p_doc_hash: doc_hash,
    p_cnpj: info.doc_type === "cnpj" ? info.doc : null,
  });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) ?? null;
  return {
    tenant_id: row?.tenant_id ?? null,
    tenant_name: row?.tenant_name ?? null,
    seat_limit: row?.seat_limit ?? null,
    active_users: row?.active_users ?? null,
    doc_reservado: Boolean(row?.doc_reservado),
  };
}

function temVaga(e: Empresa) {
  if (e.seat_limit == null) return true; // plano sob medida, sem teto
  return (e.active_users ?? 0) < e.seat_limit;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return j({ error: "method_not_allowed" }, 405);
  if (!HMAC_KEY) {
    console.error("TRIAL_DOC_HMAC_KEY ausente");
    return j({ error: "server_misconfig" }, 500);
  }

  let b: any;
  try {
    b = await req.json();
  } catch {
    return j({ error: "invalid_json" }, 400);
  }

  const action = String(b?.action ?? "").trim();
  if (action !== "lookup" && action !== "submit") {
    return j({ error: "invalid_action" }, 400);
  }

  const db = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const ip = clientIp(req);

  const info = lerDocumento(b?.document);
  if (!info) return j({ error: "invalid_document" }, 400);

  // -------------------------------------------------------------------------
  // lookup — alimenta o auto-preenchimento do nome da empresa.
  // Rate limit apertado porque a resposta revela que um CNPJ e cliente.
  // -------------------------------------------------------------------------
  if (action === "lookup") {
    if (ip && !(await rlAllows(db, "sgl:ip:" + ip, 30, 3600))) {
      return j({ error: "rate_limited" }, 429);
    }
    let empresa: Empresa;
    try {
      empresa = await buscarEmpresa(db, info);
    } catch (e) {
      return j({ error: "db_error", detail: String((e as Error).message) }, 500);
    }
    if (!empresa.tenant_id) {
      return j({ ok: true, exists: false, doc_reservado: empresa.doc_reservado });
    }
    return j({
      ok: true,
      exists: true,
      company_name: empresa.tenant_name,
      has_seat: temVaga(empresa),
      doc_reservado: false,
    });
  }

  // -------------------------------------------------------------------------
  // submit — cria a conta.
  // -------------------------------------------------------------------------
  const full_name = String(b?.full_name ?? "").trim().slice(0, 120);
  const company_name = String(b?.company_name ?? "").trim().slice(0, 120);
  const email = String(b?.email ?? "").trim().toLowerCase().slice(0, 160);
  const password = String(b?.password ?? "");
  const consent = b?.consent === true;

  if (!full_name) return j({ error: "full_name_required" }, 400);
  if (!EMAIL_RE.test(email)) return j({ error: "invalid_email" }, 400);
  if (password.length < SENHA_MIN) return j({ error: "weak_password" }, 400);
  if (!consent) return j({ error: "consent_required" }, 400);

  if (ip && !(await rlAllows(db, "sg:ip:" + ip, 5, 3600))) {
    return j({ error: "rate_limited" }, 429);
  }
  if (!(await rlAllows(db, "sg:em:" + email, 3, 3600))) {
    return j({ error: "rate_limited" }, 429);
  }

  let empresa: Empresa;
  try {
    empresa = await buscarEmpresa(db, info);
  } catch (e) {
    return j({ error: "db_error", detail: String((e as Error).message) }, 500);
  }

  // ---- Caminho 2: documento ja tem dono -> solicitacao de acesso ----
  if (empresa.tenant_id) {
    if (!temVaga(empresa)) {
      return j(
        {
          error: "sem_vagas",
          company_name: empresa.tenant_name,
          detail:
            "A empresa atingiu o limite de usuarios do plano. Peca ao administrador dela para ampliar o plano antes de se cadastrar.",
        },
        409,
      );
    }

    const { data: created, error: createErr } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    });
    if (createErr || !created?.user) {
      return j(
        {
          error: "email_already_registered",
          detail: "Ja existe uma conta com este e-mail.",
        },
        409,
      );
    }
    const userId = created.user.id;

    const { error: reqErr } = await db.rpc("create_join_request", {
      p_user_id: userId,
      p_tenant_id: empresa.tenant_id,
      p_full_name: full_name,
      p_email: email,
    });
    if (reqErr) {
      await db.auth.admin.deleteUser(userId);
      const semVaga = /sem_vagas/.test(reqErr.message);
      return j(
        {
          error: semVaga ? "sem_vagas" : "request_failed",
          company_name: empresa.tenant_name,
          detail: semVaga
            ? "A ultima vaga do plano foi ocupada durante o cadastro."
            : reqErr.message,
        },
        semVaga ? 409 : 500,
      );
    }

    return j({
      ok: true,
      status: "pending_approval",
      company_name: empresa.tenant_name,
    });
  }

  // Documento reservado mas sem empresa: provisionamento antigo que morreu no
  // meio. Nao da para vincular nem criar — precisa de suporte.
  if (empresa.doc_reservado) {
    return j(
      {
        error: "documento_indisponivel",
        detail:
          "Este documento esta reservado por um cadastro anterior que nao foi concluido. Fale com o suporte.",
      },
      409,
    );
  }

  // ---- Caminho 1: documento novo -> conta nova no plano individual ----
  if (!company_name) return j({ error: "company_name_required" }, 400);

  const doc_hash = await hmacDoc(info.doc);

  // O usuario vem antes da reserva do documento de proposito: e-mail repetido e
  // a falha mais comum, e reservar antes deixaria o CPF/CNPJ travado sem conta
  // nenhuma. Se qualquer etapa depois falhar, a reserva e devolvida.
  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (createErr || !created?.user) {
    return j(
      { error: "email_already_registered", detail: "Ja existe uma conta com este e-mail." },
      409,
    );
  }
  const userId = created.user.id;

  const desfazer = async () => {
    await db.auth.admin.deleteUser(userId);
    const { error } = await db.rpc("release_trial_document", { p_doc_hash: doc_hash });
    if (error) console.error("release_trial_document failed:", error.message);
  };

  const { data: disponivel, error: claimErr } = await db.rpc("claim_trial_document", {
    p_doc_hash: doc_hash,
    p_doc_type: info.doc_type,
    p_tenant_id: null,
  });
  if (claimErr || disponivel === false) {
    await db.auth.admin.deleteUser(userId);
    if (claimErr) return j({ error: "db_error", detail: claimErr.message }, 500);
    return j(
      { error: "document_already_used", detail: "Este documento ja possui uma conta." },
      409,
    );
  }

  const { data: intent, error: intentErr } = await db
    .from("signup_intents")
    .insert({
      company_name,
      admin_email: email,
      consent,
      plan_code: FREE_PLAN,
      billing_cycle: "monthly",
      amount_cents: 0,
      cnpj: info.doc_type === "cnpj" ? info.doc : null,
      status: "pending",
      environment: ENV,
    })
    .select("id")
    .single();
  if (intentErr) {
    await desfazer();
    return j({ error: "db_error", detail: intentErr.message }, 500);
  }

  const { data: tenantId, error: provErr } = await db.rpc("provision_from_intent", {
    p_intent_id: intent.id,
    p_admin_user_id: userId,
  });
  if (provErr) {
    await desfazer();
    await db
      .from("signup_intents")
      .update({ status: "failed", failure_reason: `provision_failed: ${provErr.message}` })
      .eq("id", intent.id);
    return j({ error: "provision_failed", detail: provErr.message }, 500);
  }

  const { error: attachErr } = await db.rpc("attach_trial_tenant", {
    p_doc_hash: doc_hash,
    p_tenant_id: tenantId,
  });
  if (attachErr) console.error("attach_trial_tenant failed:", attachErr.message);

  try {
    await db.auth.admin.updateUserById(userId, {
      app_metadata: { tenant_id: tenantId, role: "admin" },
    });
  } catch (_) {
    /* nao-fatal: a autorizacao real le profiles, nao app_metadata */
  }

  return j({ ok: true, status: "created", tenant_id: tenantId, company_name });
});
