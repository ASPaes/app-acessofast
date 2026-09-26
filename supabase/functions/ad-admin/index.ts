// supabase/functions/ad-admin/index.ts
// Gestao de campanhas de anuncio — SO super_admin (a plataforma).
//
// Por que edge com service_role, e nao grant de insert/update em ad_campaigns:
// a migration ads_fase1 fixou que a escrita de campanha nao pode ser grant direto
// — 'status' e o que separa peca aprovada de peca crua, e um grant deixaria o
// dono se auto-aprovar. Aqui a escrita e centralizada, autenticada por JWT e
// barrada por super_admin ANTES de qualquer service_role tocar no banco. O bucket
// ad-creatives continua privado sem policy: so esta funcao (service_role) sobe e
// assina arte.
//
// Acoes (POST { action, ... }):
//   list                 -> todas as campanhas + URL assinada da arte
//   save { campaign }    -> cria (sem id) ou atualiza (com id) uma campanha
//   upload { id, name, content_base64 } -> sobe a arte, seta image_path, assina
//   set_status { id, status }
//   remove_image { id }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PLACEMENTS = ["free_start", "exhausted", "agent_exhausted"];
const STATUSES = ["draft", "pending", "approved", "paused", "archived"];
const KINDS = ["house", "third_party"];
const SIGN_TTL_S = 600;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Extensao -> content-type, so os formatos de imagem que a janela do agente e o
// painel sabem desenhar. Qualquer outro e recusado antes de subir.
const TIPOS: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing_authorization" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    const user = userData?.user;
    if (userErr || !user) return json({ error: "unauthenticated" }, 401);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // GUARDA: so super_admin. A checagem sai do banco (profiles.role), nao do JWT.
    const { data: prof } = await admin
      .from("profiles").select("role, is_active").eq("id", user.id).maybeSingle();
    if (!prof || prof.is_active === false || prof.role !== "super_admin") {
      return json({ error: "forbidden" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    // -----------------------------------------------------------------------
    // list
    // -----------------------------------------------------------------------
    if (action === "list") {
      const { data: rows, error } = await admin
        .from("ad_campaigns")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) return json({ error: "db_error", detail: error.message }, 500);

      // Assina a arte de cada campanha (as que tem image_path).
      const out = [];
      for (const c of rows ?? []) {
        let image_url: string | null = null;
        if (c.image_path) {
          const { data: signed } = await admin.storage
            .from("ad-creatives").createSignedUrl(c.image_path, SIGN_TTL_S);
          image_url = signed?.signedUrl ?? null;
        }
        out.push({ ...c, image_url });
      }
      return json({ campaigns: out });
    }

    // -----------------------------------------------------------------------
    // save — cria (sem id) ou atualiza (com id)
    // -----------------------------------------------------------------------
    if (action === "save") {
      const c = body?.campaign ?? {};
      const kind = c.kind;
      if (!KINDS.includes(kind)) return json({ error: "kind_invalido" }, 400);

      const placements = Array.isArray(c.placements) ? c.placements : [];
      if (placements.length === 0 || !placements.every((p: string) => PLACEMENTS.includes(p))) {
        return json({ error: "placements_invalidos" }, 400);
      }
      // Coerencia kind x anunciante, o mesmo check que a tabela impoe — validado
      // aqui para devolver erro legivel em vez de estourar a constraint.
      const advertiser = kind === "third_party" ? (c.advertiser_tenant_id ?? null) : null;
      if (kind === "third_party" && !advertiser) {
        return json({ error: "third_party_exige_anunciante" }, 400);
      }
      // Campanha da casa NAO pode receber 'exhausted' (aquela tela do painel ja e a
      // oferta de credito) — regra da Fase 1, garantida no dado. 'agent_exhausted'
      // e 'free_start' sao liberados para a casa.
      if (kind === "house" && placements.includes("exhausted")) {
        return json({ error: "casa_nao_recebe_exhausted" }, 400);
      }
      const status = STATUSES.includes(c.status) ? c.status : "draft";

      const campos = {
        kind,
        advertiser_tenant_id: advertiser,
        name: String(c.name ?? "").trim(),
        headline: String(c.headline ?? "").trim(),
        body: c.body != null ? String(c.body) : null,
        cta_label: String(c.cta_label ?? "").trim(),
        cta_url: String(c.cta_url ?? "").trim(),
        placements,
        status,
        starts_at: c.starts_at || null,
        ends_at: c.ends_at || null,
        daily_cap: c.daily_cap != null && c.daily_cap !== "" ? Number(c.daily_cap) : null,
        weight: c.weight != null && c.weight !== "" ? Number(c.weight) : 1,
        updated_at: new Date().toISOString(),
      };
      if (!campos.name || !campos.headline || !campos.cta_label || !campos.cta_url) {
        return json({ error: "campos_obrigatorios" }, 400);
      }

      if (c.id) {
        const { data, error } = await admin
          .from("ad_campaigns").update(campos).eq("id", c.id).select("*").single();
        if (error) return json({ error: "db_error", detail: error.message }, 500);
        return json({ campaign: data });
      } else {
        const { data, error } = await admin
          .from("ad_campaigns").insert(campos).select("*").single();
        if (error) return json({ error: "db_error", detail: error.message }, 500);
        return json({ campaign: data });
      }
    }

    // -----------------------------------------------------------------------
    // upload — sobe a arte, seta image_path, devolve URL assinada
    // -----------------------------------------------------------------------
    if (action === "upload") {
      const id = body?.id;
      const name = String(body?.name ?? "");
      const b64 = body?.content_base64;
      if (!id || typeof b64 !== "string") return json({ error: "campos_obrigatorios" }, 400);

      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      const contentType = TIPOS[ext];
      if (!contentType) return json({ error: "formato_invalido" }, 400);

      let bytes: Uint8Array;
      try {
        const bin = atob(b64);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } catch {
        return json({ error: "base64_invalido" }, 400);
      }
      // Teto de 8 MB — arte e cartaz, nao arquivo grande.
      if (bytes.length > 8 * 1024 * 1024) return json({ error: "imagem_grande" }, 400);

      // Caminho isolado por campanha; sufixo temporal para nao colidir e para o
      // cache da URL assinada anterior nao servir arte trocada.
      const path = `${id}/${Date.now()}.${ext === "jpeg" ? "jpg" : ext}`;
      const { error: upErr } = await admin.storage
        .from("ad-creatives").upload(path, bytes, { contentType, upsert: true });
      if (upErr) return json({ error: "upload_falhou", detail: upErr.message }, 500);

      // Troca image_path; guarda o antigo para apagar depois de gravar.
      const { data: antes } = await admin
        .from("ad_campaigns").select("image_path").eq("id", id).maybeSingle();
      const { data: camp, error: updErr } = await admin
        .from("ad_campaigns").update({ image_path: path, updated_at: new Date().toISOString() })
        .eq("id", id).select("*").single();
      if (updErr) return json({ error: "db_error", detail: updErr.message }, 500);

      if (antes?.image_path && antes.image_path !== path) {
        await admin.storage.from("ad-creatives").remove([antes.image_path]);
      }
      const { data: signed } = await admin.storage
        .from("ad-creatives").createSignedUrl(path, SIGN_TTL_S);
      return json({ campaign: { ...camp, image_url: signed?.signedUrl ?? null } });
    }

    // -----------------------------------------------------------------------
    // set_status
    // -----------------------------------------------------------------------
    if (action === "set_status") {
      const id = body?.id;
      const status = body?.status;
      if (!id || !STATUSES.includes(status)) return json({ error: "campos_obrigatorios" }, 400);
      const { data, error } = await admin
        .from("ad_campaigns")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id).select("*").single();
      if (error) return json({ error: "db_error", detail: error.message }, 500);
      return json({ campaign: data });
    }

    // -----------------------------------------------------------------------
    // remove_image
    // -----------------------------------------------------------------------
    if (action === "remove_image") {
      const id = body?.id;
      if (!id) return json({ error: "campos_obrigatorios" }, 400);
      const { data: antes } = await admin
        .from("ad_campaigns").select("image_path").eq("id", id).maybeSingle();
      const { data, error } = await admin
        .from("ad_campaigns").update({ image_path: null, updated_at: new Date().toISOString() })
        .eq("id", id).select("*").single();
      if (error) return json({ error: "db_error", detail: error.message }, 500);
      if (antes?.image_path) await admin.storage.from("ad-creatives").remove([antes.image_path]);
      return json({ campaign: { ...data, image_url: null } });
    }

    return json({ error: "acao_invalida" }, 400);
  } catch (_e) {
    return json({ error: "internal_error" }, 500);
  }
});
