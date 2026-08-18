// AcessoFast — adopt-device (v2). Tecnico ADOTA um claim pendente POR rustdesk_id.
// Cria/atualiza o device no tenant do tecnico e VINCULA o agent_token do claim
// (redeem_claim). NAO gera senha — quem gera a senha e o AGENTE da maquina.
//
// POR QUE A ADOCAO NAO PROVISIONA MAIS SENHA (bug do 1o acesso):
// ao subir depois da instalacao, o agente faz rotate-on-boot — sorteia uma senha e
// APLICA nela mesma (AcessoFast.exe --password). O reporte ao painel leva 404
// (device ainda nao adotado) e fica pendente no endpoint, reenviado em loop. Se a
// adocao sorteasse OUTRA senha e gravasse em device_secrets, o painel passaria a
// servir uma senha que NUNCA esteve na maquina: o 1o acesso falhava ate o retry do
// agente sobrescrever — o "abre e fecha a tela de dispositivos ate acertar".
// Agora a adocao nao escreve senha nenhuma. O painel fica sem senha e o
// connect-device responde 'aguardando_agente' ate o reporte do agente chegar; a
// tela espera nesse intervalo e abre o Conectar sozinha.
//
// Escape se o agente nunca publicar (cliente antigo, --password falhou):
// provision-device-secret ("Redefinir senha"), que o tecnico aplica a mao.
// Authz IDENTICA ao register-device.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const RUSTID = /^[0-9]{6,12}$/, UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return j({ error: "method_not_allowed" }, 405);
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return j({ error: "missing_authorization" }, 401);
    const body = await req.json().catch(() => ({}));
    const rustdeskId = String(body?.rustdesk_id ?? "").replace(/\s+/g, "");
    if (!RUSTID.test(rustdeskId)) return j({ error: "rustdesk_id_invalido" }, 400);
    const alias = body?.alias ? String(body.alias).slice(0, 120) : null;

    const url = Deno.env.get("SUPABASE_URL")!, anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: ud } = await userClient.auth.getUser();
    const user = ud?.user;
    if (!user) return j({ error: "unauthenticated" }, 401);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: profile } = await admin.from("profiles").select("role, tenant_id, is_active").eq("id", user.id).maybeSingle();
    if (!profile || profile.is_active === false) return j({ error: "user_inactive_or_missing" }, 403);

    let tenant: string;
    if (profile.role === "super_admin") {
      const t = String(body?.tenant_id ?? "");
      if (!UUID.test(t)) return j({ error: "tenant_id_obrigatorio_para_super" }, 400);
      tenant = t;
    } else {
      if (!profile.tenant_id) return j({ error: "sem_tenant" }, 403);
      tenant = profile.tenant_id;
    }

    // adota (atomico no RPC): device + vinculo do token + marca claim
    const { data: rows, error: rErr } = await admin.rpc("redeem_claim", {
      p_rustdesk_id: rustdeskId, p_tenant_id: tenant, p_actor: user.id, p_alias: alias });
    if (rErr) {
      if (rErr.code === "P0002" || (rErr.message ?? "").includes("no_pending_claim"))
        return j({ error: "no_pending_claim", detail: "Nenhum computador aguardando adocao com esse ID. Confirme que o cliente instalou e leia o ID de novo." }, 404);
      return j({ error: "adopt_failed", detail: rErr.message }, 500);
    }
    const r = Array.isArray(rows) ? rows[0] : rows;
    const deviceId = r.r_device_id, wasInserted = r.r_was_inserted;

    return j({ device_id: deviceId, rustdesk_id: rustdeskId, hostname: r.r_hostname, os: r.r_os,
      was_inserted: wasInserted,
      // awaiting_agent: device novo nasce SEM senha no painel — a maquina publica a
      // dela em seguida (rotate-device-secret). Dica p/ a tela, que espera o reporte
      // em vez de oferecer uma senha que o endpoint nao tem.
      awaiting_agent: wasInserted,
      note: wasInserted
        ? "Adotado. A maquina publica a senha dela em alguns segundos — o Conectar espera por ela."
        : "Device ja existia neste tenant; token do agente rotacionado, senha mantida." });
  } catch (_e) { return j({ error: "internal_error" }, 500); }
});
