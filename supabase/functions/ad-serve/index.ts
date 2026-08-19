// supabase/functions/ad-serve/index.ts
// Anuncios no plano gratuito — Fase 1 (painel).
//
// AUTENTICACAO: JWT do usuario, e so. O ANUNCIOS-POSSIBILIDADES.md descreve uma
// ad-serve que autentica por rustdesk_id + agent_token; aquilo pressupunha o
// agente entregando o anuncio, e o agente e servico Windows em sessao 0 — nao
// desenha na tela. Na Fase 1 quem exibe e o painel, que ja tem o JWT do tecnico.
// O agent_token, alem de nao servir aqui, nao e alcancavel: enroll.go tranca
// C:\ProgramData\AcessoFast com icacls pra SYSTEM+Admins de proposito.
//
// Duas acoes na mesma funcao:
//   POST { placement }                    -> escolhe e registra a exibicao
//   POST { impression_id, event:'click' } -> registra o clique
//
// Nao ha acao de "fechar/dispensar": exibicao e clique bastam pra CTR, e cada
// evento a mais e mais superficie pra inflar numero que depois se vende.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEMENTS = ["free_start", "exhausted"] as const;
// Tela que desenhou. 'embed' = a janela de 520px do DoctorSaaS, que fecha
// sozinha — o CTR dela nao e comparavel ao do painel.
const SURFACES = ["painel", "embed"] as const;

// Vida da URL assinada do criativo. Curta de proposito: a arte e servida pra uma
// tela que esta aberta agora. Link longo vaza inventario de anunciante pra fora
// do contexto onde a elegibilidade e o teto foram aplicados.
const SIGNED_URL_TTL_S = 120;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

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
    const body = await req.json().catch(() => ({}));

    // -----------------------------------------------------------------------
    // Acao 2 — clique
    // -----------------------------------------------------------------------
    if (body?.event === "click") {
      const impressionId = body?.impression_id;
      if (typeof impressionId !== "string" || !UUID_RE.test(impressionId)) {
        return json({ error: "impression_id_invalido" }, 400);
      }
      // O filtro por viewer_user_id NAO e redundante com o id ser uuid: sem ele,
      // qualquer sessao autenticada que adivinhe/observe um impression_id marca
      // clique em exibicao alheia — e CTR e exatamente o numero que se leva pro
      // anunciante. O clicked_at is null impede recontar o mesmo clique.
      const { error } = await admin
        .from("ad_impressions")
        .update({ clicked_at: new Date().toISOString() })
        .eq("id", impressionId)
        .eq("viewer_user_id", user.id)
        .is("clicked_at", null);
      if (error) return json({ error: "track_failed" }, 500);
      return json({ ok: true });
    }

    // -----------------------------------------------------------------------
    // Acao 1 — escolher e registrar a exibicao
    // -----------------------------------------------------------------------
    const placement = body?.placement;
    if (typeof placement !== "string" || !PLACEMENTS.includes(placement as never)) {
      return json({ error: "placement_invalido" }, 400);
    }
    // Superficie e rotulo de leitura, nao autorizacao — por isso vem da tela e
    // cai no default em vez de rejeitar a chamada.
    const surface = SURFACES.includes(body?.surface as never) ? body.surface : "painel";

    const { data: profile } = await admin
      .from("profiles")
      .select("tenant_id, is_active")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile || profile.is_active === false) return json({ error: "user_inactive" }, 403);
    const viewerTenant = (profile.tenant_id as string | null) ?? null;

    const { data: picked, error: pickErr } = await admin.rpc("ad_pick_for_viewer", {
      p_placement: placement,
      p_viewer_user: user.id,
      p_viewer_tenant: viewerTenant,
    });
    if (pickErr) return json({ error: "pick_failed" }, 500);

    const ad = Array.isArray(picked) ? picked[0] : picked;
    // Zero linhas e resultado NORMAL: sem terceiro elegivel, teto do espectador
    // batido, ou placement sem campanha. O painel simplesmente nao desenha o slot.
    if (!ad) return json({ ad: null });

    // A impressao e gravada AQUI, no serve — ou seja, ela mede "peca entregue ao
    // painel", nao "pixel visto pelo tecnico". Vale porque o painel so chama isto
    // no momento em que ja vai desenhar a tela. Quando houver anunciante pagando
    // por CPM, esta e a linha que precisa virar confirmacao vinda da tela.
    const { data: imp, error: impErr } = await admin
      .from("ad_impressions")
      .insert({
        campaign_id: ad.id,
        placement,
        surface,
        viewer_user_id: user.id,
        viewer_tenant_id: viewerTenant,
      })
      .select("id")
      .single();
    if (impErr || !imp) return json({ error: "impression_failed" }, 500);

    // Criativo: bucket privado, URL assinada na hora. Peca so de texto (o caso da
    // campanha da casa) tem image_path null e nao assina nada.
    let imageUrl: string | null = null;
    if (ad.image_path) {
      const { data: signed } = await admin.storage
        .from("ad-creatives")
        .createSignedUrl(ad.image_path as string, SIGNED_URL_TTL_S);
      imageUrl = signed?.signedUrl ?? null;
    }

    return json({
      ad: {
        impression_id: imp.id,
        // 'house' vs 'third_party' vai pra tela porque a peca da casa e rotulada
        // como oferta do AcessoFast e a de terceiro precisa ser rotulada como
        // publicidade — misturar as duas sem rotulo e o que faz o usuario perder
        // a confianca no painel.
        kind: ad.kind,
        headline: ad.headline,
        body: ad.body,
        cta_label: ad.cta_label,
        cta_url: ad.cta_url,
        image_url: imageUrl,
      },
    });
  } catch (_e) {
    return json({ error: "internal_error" }, 500);
  }
});
