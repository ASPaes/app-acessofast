// AcessoFast — Edge Function: session-ingest (v2)
// Recebe eventos de sessao do AGENTE do endpoint e mantem o ciclo em connection_logs.
// Deploy com verify_jwt = FALSE (auth propria via token de dispositivo).
// FIX v2: duration_seconds e coluna GERADA -> nunca escrever nela; so setar session_end.
// FIX v3: aceita o evento "presence" (agente manda a cada 60s com a maquina ociosa) e
//         carimba address_book.last_online em TODO evento autenticado. O painel deriva
//         online/offline dessa coluna (janela de 2 min) — sem isto tudo fica "Offline".

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { rustdesk_id?: string; agent_token?: string; event?: string; peer_ip?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const rustdesk_id = (body.rustdesk_id ?? "").trim();
  const agent_token = body.agent_token ?? "";
  const event = body.event ?? "";
  // B6: IP do peer conectante (do log "opened from <IP>"). Opcional — o agente
  // atual ainda não envia; entra como auditoria da sessão direta quando enviar.
  const peer_ip = (body.peer_ip ?? "").trim() || null;

  if (!rustdesk_id || !agent_token || !["start", "heartbeat", "end", "presence"].includes(event)) {
    return json({ error: "missing_or_invalid_fields" }, 400);
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 1) Resolver o dispositivo pelo rustdesk_id (unico) -> tenant + hash do token.
  const { data: device, error: devErr } = await db
    .from("address_book")
    .select("id, tenant_id, agent_token_hash")
    .eq("rustdesk_id", rustdesk_id)
    .maybeSingle();

  if (devErr) return json({ error: "db_error", detail: devErr.message }, 500);
  if (!device) return json({ error: "device_not_registered" }, 404);
  if (!device.agent_token_hash) return json({ error: "device_not_provisioned" }, 401);

  // 2) Autenticar o agente.
  const presentedHash = await sha256Hex(agent_token);
  if (presentedHash !== device.agent_token_hash) {
    return json({ error: "unauthorized" }, 401);
  }

  const nowIso = new Date().toISOString();

  // 2.1) Presenca: qualquer evento autenticado prova que a maquina esta viva agora.
  // O painel calcula online/offline por address_book.last_online > now() - 2min, e o
  // agente ocioso so manda "presence" (60s em 60s) — por isso o carimbo vem ANTES do
  // roteamento por evento, e nao so no ramo de sessao.
  const { error: presErr } = await db
    .from("address_book")
    .update({ last_online: nowIso })
    .eq("id", device.id);

  // "presence" = maquina ligada e ociosa. Marca presenca e sai: nao abre, nao fecha
  // e nao toca em connection_logs (nao e sessao, nao cobra, nao gera grant).
  if (event === "presence") {
    if (presErr) return json({ error: "db_error", detail: presErr.message }, 500);
    return json({ ok: true, action: "presence" });
  }

  async function latestActive() {
    const { data } = await db
      .from("connection_logs")
      .select("id, session_start, notes")
      .eq("rustdesk_id", rustdesk_id)
      .eq("status", "active")
      .order("session_start", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data;
  }

  // Billing B2/B6: cap de 2h do free. Devolve o hard_cap_at do atendimento ABERTO
  // do device (free -> +2h; crédito/plano -> null). Vale p/ PAINEL e DIRETO: no B6
  // a sessao externa (.exe) tambem passa a ter atendimento, entao nao filtramos mais
  // por origem — so pelo atendimento aberto do rustdesk_id.
  //
  // Usa o atendimento aberto MAIS RECENTE (order by started_at desc). Isso resolve
  // dois casos de uma vez:
  //  • "vazamento": se ja ha uma sessao/atendimento NOVO (cap futuro), ele e o mais
  //    recente e vence — o cap vencido de um free anterior nao corta a sessao nova.
  //  • overstay: se o unico atendimento aberto e um free cujo cap JA venceu (sessao
  //    esticou alem das 2h e o agente nao cortou), devolvemos "cortar AGORA" (nowIso,
  //    mesma convencao do ramo blocked) em vez de null — antes o null desarmava o
  //    corte e a sessao virava fantasma. hard_cap_at null (credito/plano) = sem corte.
  async function currentHardCap(): Promise<string | null> {
    const nowIso2 = new Date().toISOString();
    const { data } = await db
      .from("atendimentos")
      .select("hard_cap_at")
      .eq("rustdesk_id", rustdesk_id)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data || !data.hard_cap_at) return null;           // sem atendimento aberto, ou credito/plano
    return data.hard_cap_at <= nowIso2 ? nowIso2 : data.hard_cap_at;
  }

  // 3) Tratar o evento.
  if (event === "start" || event === "heartbeat") {
    const active = await latestActive();

    if (active) {
      const { error } = await db
        .from("connection_logs")
        .update({ last_heartbeat_at: nowIso })
        .eq("id", active.id);
      if (error) return json({ error: "db_error", detail: error.message }, 500);
      const hard_cap_at = await currentHardCap();
      return json({ ok: true, session_id: active.id, action: "heartbeat", hard_cap_at });
    }

    const { data: inserted, error } = await db
      .from("connection_logs")
      .insert({
        tenant_id: device.tenant_id,
        rustdesk_id,
        address_book_id: device.id,
        status: "active",
        session_start: nowIso,
        last_heartbeat_at: nowIso,
        notes: "Acesso externo (nao iniciado pelo painel)",
      })
      .select("id")
      .single();
    if (error) return json({ error: "db_error", detail: error.message }, 500);

    // Billing B6: sessao externa (.exe, direta) agora e MEDIDA aqui. Auto free->credito;
    // reconexao unificada nao cobra; sem saldo/conta bloqueada -> blocked (cortamos).
    const { data: meterRows, error: meterErr } = await db.rpc("meter_external_session", {
      p_rustdesk_id: rustdesk_id,
      p_connection_log_id: inserted.id,
      p_peer_ip: peer_ip,
    });
    if (meterErr) {
      // Medicao falhou: nao derruba a sessao (fail-open); segue sem cap.
      return json({ ok: true, session_id: inserted.id, action: "created_external", hard_cap_at: null });
    }
    const meter = Array.isArray(meterRows) ? meterRows[0] : meterRows;
    if (meter?.blocked) {
      // Sem saldo / conta bloqueada: cap = AGORA -> o agente (B2) corta na hora.
      return json({
        ok: true,
        session_id: inserted.id,
        action: "blocked_external",
        reason: meter.reason ?? "blocked",
        hard_cap_at: nowIso,
      });
    }
    // Permitida: free -> +2h (cortada aos 2h); credito/plano -> null (sem corte).
    return json({
      ok: true,
      session_id: inserted.id,
      action: "created_external",
      source: meter?.source ?? null,
      hard_cap_at: meter?.hard_cap_at ?? null,
    });
  }

  // event === "end": fecha a sessao. NAO escreve duration_seconds (coluna gerada).
  const active = await latestActive();
  if (!active) return json({ ok: true, action: "noop_no_active_session" });

  const { error } = await db
    .from("connection_logs")
    .update({
      session_end: nowIso,
      status: "ended",
      last_heartbeat_at: nowIso,
    })
    .eq("id", active.id);
  if (error) return json({ error: "db_error", detail: error.message }, 500);

  const durationSec = Math.max(
    0,
    Math.round((Date.now() - new Date(active.session_start).getTime()) / 1000),
  );
  return json({ ok: true, session_id: active.id, action: "ended", duration_seconds: durationSec });
});
