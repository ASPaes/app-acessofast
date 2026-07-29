// join-request — decide as solicitacoes de acesso abertas pelo cadastro publico.
// Modos: approve | reject | reopen.
//
// Passa por edge function (e nao por RPC direta do front) pelo mesmo motivo da
// invite-user: mexer em profiles.tenant_id/role exige service_role, porque
// private.guard_profile_privileges() so libera super_admin e o backend. Aqui
// tambem sincronizamos o app_metadata do usuario, para o convidado e o
// aprovado terminarem com o mesmo formato de conta.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const ASSIGNABLE_ROLES = ["admin", "head", "tech"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_authorization" }, 401);
  const token = authHeader.replace(/^Bearer\s+/i, "");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }

  const mode = body?.mode;
  if (mode !== "approve" && mode !== "reject" && mode !== "reopen") {
    return json(
      { error: "invalid_mode", detail: "mode deve ser 'approve', 'reject' ou 'reopen'" },
      400,
    );
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: "invalid_token" }, 401);
  const callerId = userData.user.id;

  // ---- REOPEN: o proprio recusado pede de novo ----
  if (mode === "reopen") {
    const { data, error } = await admin.rpc("reopen_join_request", { p_user_id: callerId });
    if (error) return json({ error: "reopen_failed", detail: traduzir(error.message) }, 400);
    return json({ ok: true, mode, request_id: data });
  }

  // ---- APPROVE / REJECT: precisa ser admin da empresa da solicitacao ----
  const requestId = body?.request_id ?? null;
  if (!requestId) return json({ error: "missing_request_id" }, 400);

  const { data: solicitacao, error: reqErr } = await admin
    .from("join_requests")
    .select("id, tenant_id, user_id, status")
    .eq("id", requestId)
    .maybeSingle();
  if (reqErr) return json({ error: "lookup_failed", detail: reqErr.message }, 400);
  if (!solicitacao) return json({ error: "request_not_found" }, 404);
  if (solicitacao.status !== "pending") {
    return json({ error: "already_decided", detail: "Esta solicitacao ja foi decidida." }, 409);
  }

  const { data: callerProfile, error: profErr } = await admin
    .from("profiles")
    .select("role, tenant_id")
    .eq("id", callerId)
    .single();
  if (profErr || !callerProfile) return json({ error: "caller_has_no_profile" }, 403);

  const isSuper = callerProfile.role === "super_admin";
  const isTenantAdmin =
    callerProfile.role === "admin" && callerProfile.tenant_id === solicitacao.tenant_id;
  if (!isSuper && !isTenantAdmin) {
    return json(
      { error: "forbidden", detail: "apenas super_admin ou admin da propria empresa" },
      403,
    );
  }

  if (mode === "reject") {
    const { error } = await admin.rpc("reject_join_request", {
      p_request_id: requestId,
      p_actor: callerId,
    });
    if (error) return json({ error: "reject_failed", detail: traduzir(error.message) }, 400);
    return json({ ok: true, mode, request_id: requestId });
  }

  const role = body?.role ?? null;
  if (!ASSIGNABLE_ROLES.includes(role)) {
    return json({ error: "invalid_role", detail: "role deve ser admin, head ou tech" }, 400);
  }

  const { error } = await admin.rpc("approve_join_request", {
    p_request_id: requestId,
    p_role: role,
    p_actor: callerId,
  });
  if (error) return json({ error: "approve_failed", detail: traduzir(error.message) }, 400);

  try {
    await admin.auth.admin.updateUserById(solicitacao.user_id, {
      app_metadata: { tenant_id: solicitacao.tenant_id, role },
    });
  } catch (_) {
    /* nao-fatal: a autorizacao real le profiles, nao app_metadata */
  }

  return json({ ok: true, mode, request_id: requestId, user_id: solicitacao.user_id, role });
});

function traduzir(msg: string): string {
  if (/sem_vagas/.test(msg))
    return "O plano da empresa atingiu o limite de usuarios. Amplie o plano para aprovar.";
  if (/solicitacao_ja_decidida/.test(msg)) return "Esta solicitacao ja foi decidida.";
  if (/solicitacao_ja_pendente/.test(msg)) return "Ja existe uma solicitacao em aberto.";
  if (/usuario_ja_tem_empresa/.test(msg)) return "Este usuario ja pertence a uma empresa.";
  if (/sem_solicitacao_anterior/.test(msg)) return "Nao ha solicitacao anterior para reabrir.";
  return msg;
}
