// invite-user — bootstrap/convite/reenvio de usuários do AcessoFast.
// Modos: bootstrap_msp | add_member | resend_invite.
// Link de senha: usa o fluxo token_hash (PKCE) apontando para o PROPRIO app (/definir-senha?token_hash=...&type=...),
// para que pre-visualizadores de link (WhatsApp/e-mail) NAO consumam o token de uso unico. Fallback: action_link direto.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

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

// Monta o link apontando para o app com token_hash (prova-de-prefetch). Fallback: action_link direto do Supabase.
function buildAppLink(redirectTo: string | undefined, props: any, type: string): string | null {
  if (!props) return null;
  if (redirectTo && props.hashed_token) {
    try {
      const u = new URL(redirectTo);
      u.searchParams.set("token_hash", props.hashed_token);
      u.searchParams.set("type", type);
      return u.toString();
    } catch (_) { /* redirectTo invalido -> cai no fallback */ }
  }
  return props.action_link ?? null;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
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
  const email = (body?.email ?? "").trim().toLowerCase();
  const fullName = body?.full_name ?? null;
  const password = body?.password ?? null;
  const redirectTo = typeof body?.redirect_to === "string" && body.redirect_to.trim() ? body.redirect_to.trim() : undefined;

  if (mode !== "bootstrap_msp" && mode !== "add_member" && mode !== "resend_invite")
    return json({ error: "invalid_mode", detail: "mode deve ser 'bootstrap_msp', 'add_member' ou 'resend_invite'" }, 400);
  if (!EMAIL_RE.test(email))
    return json({ error: "invalid_email" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: "invalid_token" }, 401);
  const callerId = userData.user.id;

  const { data: callerProfile, error: profErr } = await admin
    .from("profiles").select("role, tenant_id").eq("id", callerId).single();
  if (profErr || !callerProfile) return json({ error: "caller_has_no_profile" }, 403);

  // ---- RESEND: link fresco para usuario existente ----
  if (mode === "resend_invite") {
    const rTenant = body?.tenant_id ?? null;
    if (!rTenant) return json({ error: "missing_tenant_id" }, 400);
    const { data: target, error: tErr } = await admin
      .from("profiles").select("id, role, tenant_id").eq("email", email).maybeSingle();
    if (tErr) return json({ error: "lookup_failed", detail: tErr.message }, 400);
    if (!target) return json({ error: "user_not_found", detail: "nenhum usuario com esse e-mail" }, 404);
    if (target.role === "super_admin") return json({ error: "forbidden", detail: "nao e possivel reenviar para super_admin" }, 403);
    if (target.tenant_id !== rTenant) return json({ error: "forbidden", detail: "usuario nao pertence a esse tenant" }, 403);
    const isSuper = callerProfile.role === "super_admin";
    const isTenantAdmin = callerProfile.role === "admin" && callerProfile.tenant_id === rTenant;
    if (!isSuper && !isTenantAdmin) return json({ error: "forbidden", detail: "apenas super_admin ou admin do proprio tenant" }, 403);

    let link: string | null = null;
    try {
      const { data: gl, error: glErr } = await admin.auth.admin.generateLink({
        type: "recovery", email, options: redirectTo ? { redirectTo } : undefined,
      });
      if (glErr) return json({ error: "generate_link_failed", detail: glErr.message }, 400);
      link = buildAppLink(redirectTo, (gl as any)?.properties, "recovery");
    } catch (e) {
      return json({ error: "generate_link_failed", detail: String((e as any)?.message ?? e) }, 400);
    }
    return json({
      ok: true, mode, user_id: target.id, tenant_id: rTenant, role: target.role, invite_link: link,
      note: "Link de redefinicao de senha gerado. Envie ao usuario; ele define a senha em /definir-senha.",
    });
  }

  // ---- BOOTSTRAP / ADD_MEMBER (criam usuario) ----
  let tenantName: string | null = null;
  let seatLimit = 1;
  let targetTenantId: string | null = null;
  let targetRole: string | null = null;

  if (mode === "bootstrap_msp") {
    if (callerProfile.role !== "super_admin")
      return json({ error: "forbidden", detail: "apenas super_admin pode fazer bootstrap de tenant" }, 403);
    tenantName = (body?.name ?? "").trim();
    if (!tenantName) return json({ error: "missing_tenant_name" }, 400);
    if (body?.seat_limit != null) {
      seatLimit = Number(body.seat_limit);
      if (!Number.isInteger(seatLimit) || seatLimit < 1)
        return json({ error: "invalid_seat_limit" }, 400);
    }
  } else {
    targetTenantId = body?.tenant_id ?? null;
    targetRole = body?.role ?? null;
    if (!targetTenantId) return json({ error: "missing_tenant_id" }, 400);
    if (!ASSIGNABLE_ROLES.includes(targetRole))
      return json({ error: "invalid_role", detail: "role deve ser admin, head ou tech" }, 400);
    const isSuper = callerProfile.role === "super_admin";
    const isTenantAdmin = callerProfile.role === "admin" && callerProfile.tenant_id === targetTenantId;
    if (!isSuper && !isTenantAdmin)
      return json({ error: "forbidden", detail: "apenas super_admin ou admin do proprio tenant pode adicionar membros" }, 403);
  }

  const createPayload: any = {
    email,
    email_confirm: password ? true : false,
    user_metadata: fullName ? { full_name: fullName } : {},
  };
  if (password) createPayload.password = password;

  const { data: created, error: createErr } = await admin.auth.admin.createUser(createPayload);
  if (createErr || !created?.user) {
    return json({ error: "create_user_failed", detail: createErr?.message ?? "unknown" }, 409);
  }
  const newUserId = created.user.id;

  let boundTenantId: string | null = null;
  if (mode === "bootstrap_msp") {
    const { data, error } = await caller.rpc("provision_tenant", {
      p_name: tenantName, p_admin_user_id: newUserId, p_seat_limit: seatLimit,
    });
    if (error) {
      await admin.auth.admin.deleteUser(newUserId);
      return json({ error: "provision_failed", detail: error.message }, 400);
    }
    boundTenantId = data as string;
  } else {
    const { error } = await admin.from("profiles")
      .update({ tenant_id: targetTenantId, role: targetRole })
      .eq("id", newUserId);
    if (error) {
      await admin.auth.admin.deleteUser(newUserId);
      return json({ error: "assign_failed", detail: error.message }, 400);
    }
    boundTenantId = targetTenantId;
  }

  try {
    await admin.auth.admin.updateUserById(newUserId, {
      app_metadata: { tenant_id: boundTenantId, role: mode === "bootstrap_msp" ? "admin" : targetRole },
    });
  } catch (_) { /* nao-fatal */ }

  let inviteLink: string | null = null;
  if (!password) {
    try {
      const { data: link } = await admin.auth.admin.generateLink({
        type: "invite", email, options: redirectTo ? { redirectTo } : undefined,
      });
      inviteLink = buildAppLink(redirectTo, (link as any)?.properties, "invite");
    } catch (_) { /* nao-fatal */ }
  }

  return json({
    ok: true, mode, user_id: newUserId, tenant_id: boundTenantId,
    role: mode === "bootstrap_msp" ? "admin" : targetRole,
    invite_link: inviteLink,
    note: password ? "Senha veio no request (teste)." : "Usuario criado; envie o invite_link p/ ele definir a senha em /definir-senha.",
  });
});
