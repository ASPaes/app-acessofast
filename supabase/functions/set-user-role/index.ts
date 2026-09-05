// set-user-role — promove/rebaixa o papel de um usuario dentro da empresa.
//
// Passa por edge function (e nao por RPC direta do front) pelo mesmo motivo da
// invite-user e da join-request: mexer em profiles.role exige service_role,
// porque private.guard_profile_privileges() so libera super_admin e o backend.
// Aqui tambem sincronizamos o app_metadata, para o usuario terminar com o mesmo
// formato de conta que sai do convite e da aprovacao de solicitacao.
//
// Quem pode: super_admin (qualquer empresa) e admin (dentro da propria empresa).
// O que NAO da pra fazer, de proposito:
//   - mexer no proprio papel (ninguem se promove nem se rebaixa sozinho);
//   - tocar num super_admin, ou conceder super_admin — papel de plataforma,
//     continua sendo operacao manual de banco, fora do alcance do painel;
//   - rebaixar o ultimo admin ativo de uma empresa, que deixaria o tenant sem
//     ninguem para convidar, aprovar ou reativar membro.

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

  const userId = body?.user_id ?? null;
  if (!userId) return json({ error: "missing_user_id" }, 400);

  const role = body?.role ?? null;
  if (!ASSIGNABLE_ROLES.includes(role)) {
    return json(
      { error: "invalid_role", detail: "O papel deve ser admin, head ou tech." },
      400,
    );
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: "invalid_token" }, 401);
  const callerId = userData.user.id;

  if (callerId === userId) {
    return json(
      { error: "forbidden", detail: "Voce nao pode alterar o proprio papel." },
      403,
    );
  }

  const { data: callerProfile, error: profErr } = await admin
    .from("profiles")
    .select("role, tenant_id")
    .eq("id", callerId)
    .single();
  if (profErr || !callerProfile) return json({ error: "caller_has_no_profile" }, 403);

  const { data: alvo, error: alvoErr } = await admin
    .from("profiles")
    .select("id, role, tenant_id, is_active")
    .eq("id", userId)
    .maybeSingle();
  if (alvoErr) return json({ error: "lookup_failed", detail: alvoErr.message }, 400);
  if (!alvo) return json({ error: "user_not_found" }, 404);

  const isSuper = callerProfile.role === "super_admin";
  const isTenantAdmin =
    callerProfile.role === "admin" &&
    !!callerProfile.tenant_id &&
    callerProfile.tenant_id === alvo.tenant_id;
  if (!isSuper && !isTenantAdmin) {
    return json(
      { error: "forbidden", detail: "Apenas super_admin ou admin da propria empresa." },
      403,
    );
  }

  if (alvo.role === "super_admin") {
    return json(
      { error: "forbidden", detail: "O papel de um super_admin nao muda pelo painel." },
      403,
    );
  }

  if (alvo.role === role) {
    return json({ ok: true, user_id: userId, role, unchanged: true });
  }

  // Rebaixar o unico admin ativo deixaria a empresa sem quem convidar, aprovar
  // solicitacao ou reativar usuario — e o proprio rebaixado nao poderia desfazer.
  if (alvo.role === "admin" && alvo.tenant_id) {
    const { count, error: countErr } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", alvo.tenant_id)
      .eq("role", "admin")
      .eq("is_active", true);
    if (countErr) return json({ error: "lookup_failed", detail: countErr.message }, 400);
    if (alvo.is_active && (count ?? 0) <= 1) {
      return json(
        {
          error: "last_admin",
          detail:
            "Este e o unico admin ativo da empresa. Promova outro usuario a admin antes de rebaixar este.",
        },
        409,
      );
    }
  }

  const { error: updErr } = await admin
    .from("profiles")
    .update({ role })
    .eq("id", userId);
  if (updErr) return json({ error: "update_failed", detail: updErr.message }, 400);

  try {
    await admin.auth.admin.updateUserById(userId, {
      app_metadata: { tenant_id: alvo.tenant_id, role },
    });
  } catch (_) {
    /* nao-fatal: a autorizacao real le profiles, nao app_metadata */
  }

  return json({ ok: true, user_id: userId, role, previous_role: alvo.role });
});
