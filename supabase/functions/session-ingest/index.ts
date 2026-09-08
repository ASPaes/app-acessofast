// AcessoFast — Edge Function: session-ingest (v2)
// Recebe eventos de sessao do AGENTE do endpoint e mantem o ciclo em connection_logs.
// Deploy com verify_jwt = FALSE (auth propria via token de dispositivo).
// FIX v2: duration_seconds e coluna GERADA -> nunca escrever nela; so setar session_end.
// FIX v3: aceita o evento "presence" (agente manda a cada 60s com a maquina ociosa) e
//         carimba address_book.last_online em TODO evento autenticado. O painel deriva
//         online/offline dessa coluna (janela em src/lib/presenca.ts do painel) — sem
//         isto tudo fica "Offline".

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

  let body: { rustdesk_id?: string; agent_token?: string; event?: string; peer_ip?: string; controller_rustdesk_id?: string; agent_version?: string };
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
  // Auto-adoção: rustdesk_id do CONTROLADOR (máquina do técnico) parseado do log do
  // cliente. Opcional; usado só p/ adotar um device ainda não registrado no 'start'.
  const controller_rustdesk_id = (body.controller_rustdesk_id ?? "").trim() || null;
  // Versao do agente que esta falando. Opcional: agente anterior ao reporte nao
  // manda, e nesse caso NAO sobrescrevemos a coluna (ver abaixo). Truncado em 40
  // chars — e um rotulo de build, nao um campo livre.
  const agent_version = (body.agent_version ?? "").trim().slice(0, 40) || null;

  if (!rustdesk_id || !agent_token || !["start", "heartbeat", "end", "presence"].includes(event)) {
    return json({ error: "missing_or_invalid_fields" }, 400);
  }

  // ===========================================================================
  // DESCARTE ANTECIPADO — a chamada morre AQUI, sem tocar no banco.
  //
  // Esta guarda vem antes de tudo: antes do client do Supabase, antes do sha256,
  // antes de qualquer consulta. Nada de rede, nada de leitura, nada de escrita.
  //
  // Como reconhecemos sem perguntar ao banco: binario anterior a 10/08/2026 nao
  // manda `agent_version` — foi essa build que introduziu o campo. E exatamente
  // o mesmo criterio que deixa a coluna agent_version nula nessas 82 maquinas.
  // Elas batem a cada 60s (o dobro da cadencia atual), nao se atualizam sozinhas
  // e nao podem ser alcancadas: sao de parceiro, sem acesso fisico nem remoto.
  //
  // O que isso evitava, medido no banco antes da mudanca:
  //   address_book  2.977.214 updates numa tabela de 177 linhas
  // Cada presence carimbava last_online, e no Postgres todo UPDATE escreve uma
  // versao nova da linha e deixa a anterior morta pro autovacuum recolher. Sao
  // ~85 mil escritas/dia, 2,5 milhoes/mes, que deixam de existir.
  //
  // A INVOCACAO em si continua contando na cota — foi testado, chamada a rota
  // inexistente conta igual, nao ha como recusar antes de entrar. O que morre e
  // o trabalho: banco, WAL, autovacuum.
  //
  // So o 'presence' e descartado. start/heartbeat/end de agente antigo PASSAM
  // normalmente: sao sessao de verdade e contam para cobranca. Cortar telemetria
  // de billing para poupar escrita seria trocar um problema por outro pior.
  if (event === "presence" && !agent_version) {
    return json({ ok: true, action: "presence", ignored: "agente_sem_versao" });
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Hash do token apresentado (usado na auth e na auto-adoção).
  const presentedHash = await sha256Hex(agent_token);

  // 1) Resolver o dispositivo pelo rustdesk_id (unico) -> tenant + hash do token.
  let { data: device, error: devErr } = await db
    .from("address_book")
    .select("id, tenant_id, agent_token_hash, ignorar_presenca, alias")
    .eq("rustdesk_id", rustdesk_id)
    .maybeSingle();
  if (devErr) return json({ error: "db_error", detail: devErr.message }, 500);

  // Passo 2 (auto-update): resolve o alvo em cascata device -> tenant -> global e
  // devolve o release correspondente, ou null. Uma unica ida ao banco (a cascata
  // inteira vive no coalesce da RPC) e zero linhas no caso comum — sem alvo, ou ja
  // na versao certa.
  //
  // Fail-open de proposito: se a resolucao falhar, a maquina simplesmente nao
  // atualiza agora. Presenca e sessao NAO podem quebrar por causa disso — um erro
  // aqui nao vale derrubar a telemetria de billing da frota inteira.
  async function resolveUpdate(deviceId: string): Promise<Record<string, string> | null> {
    try {
      const { data, error } = await db.rpc("resolve_agent_update", {
        p_device_id: deviceId,
        p_current_version: agent_version ?? "",
      });
      if (error) return null;
      const r = Array.isArray(data) ? data[0] : data;
      if (!r?.version || !r?.url || !r?.sha256 || !r?.signature) return null;
      return { version: r.version, url: r.url, sha256: r.sha256, signature: r.signature };
    } catch {
      return null;
    }
  }

  // Mesma coisa, para maquina que ainda NAO esta no address_book. O alvo aqui e
  // so o global (sem device nao ha override por dispositivo nem por tenant), e a
  // plataforma sai do claim da matricula.
  async function resolveUpdateGlobal(rid: string): Promise<Record<string, string> | null> {
    try {
      const { data, error } = await db.rpc("resolve_agent_update_global", {
        p_rustdesk_id: rid,
        p_current_version: agent_version ?? "",
      });
      if (error) return null;
      const r = Array.isArray(data) ? data[0] : data;
      if (!r?.version || !r?.url || !r?.sha256 || !r?.signature) return null;
      return { version: r.version, url: r.url, sha256: r.sha256, signature: r.signature };
    } catch {
      return null;
    }
  }

  // 1.1) AUTO-ADOÇÃO (acesso direto): device ainda não adotado (só claim 'waiting',
  // não está no address_book). Só no 'start' e com o rustdesk_id do CONTROLADOR (a
  // máquina do técnico, já adotada): a RPC autentica pelo claim, resolve o tenant pelo
  // controlador e cria o device 'approved'. Controlador desconhecido -> 403 (corta).
  if (!device && event === "start" && controller_rustdesk_id) {
    const { data: adoptRows, error: adoptErr } = await db.rpc("auto_adopt_direct", {
      p_rustdesk_id: rustdesk_id,
      p_agent_token_hash: presentedHash,
      p_controller_rustdesk_id: controller_rustdesk_id,
    });
    if (adoptErr) return json({ error: "db_error", detail: adoptErr.message }, 500);
    const a = Array.isArray(adoptRows) ? adoptRows[0] : adoptRows;
    if (a && (a.adopted || a.reason === "already_adopted")) {
      // adotado agora (ou já estava) -> re-busca pra seguir o fluxo normal.
      const r = await db
        .from("address_book")
        .select("id, tenant_id, agent_token_hash, ignorar_presenca, alias")
        .eq("rustdesk_id", rustdesk_id)
        .maybeSingle();
      device = r.data;
    } else if (a?.reason === "unknown_controller") {
      // Segurança (B6): o device É um cliente AcessoFast (claim + token válidos), mas
      // está sendo controlado por uma máquina NÃO adotada -> acesso ilegítimo (possível
      // invasão). Não há tenant/registro pra medir, mas mandamos o sinal de CORTE:
      // hard_cap_at = agora. O agente lê hard_cap_at do corpo (independe do status HTTP)
      // e derruba a sessão no próximo tick (~3s): rotaciona a senha efêmera + reinicia o
      // cliente. Só cortamos neste caso (controlador conhecido-porém-não-adotado); um
      // device_not_registered cru NÃO corta (cobre matrícula legítima / cliente antigo).
      return json({
        error: "unknown_controller",
        action: "cut_unknown_controller",
        hard_cap_at: new Date().toISOString(),
      }, 403);
    }
    // no_claim_or_bad_token (ou nulo) -> cai no device_not_registered abaixo.
  }

  // A maquina nao esta no cadastro: nao ha o que registrar, e o 404 continua.
  // Mas o corpo vai com o bloco de update mesmo assim, e isso e proposital.
  //
  // O postEventFull do agente faz json.Unmarshal do corpo SEM olhar o status
  // (main.go) e devolve r.Update incondicionalmente. Esta e a UNICA porta por
  // onde uma correcao alcanca uma maquina presa no laco de matricula — sem ela,
  // mudar o agente dessas maquinas exige ir ate elas. Entregar o update sem
  // autenticar nao afrouxa nada: o agente so aplica release cuja assinatura
  // Ed25519 confere com a chave publica embutida nele.
  //
  // So no 'presence' porque e o unico evento em que o agente consome o update —
  // em start/heartbeat seria uma ida ao banco que nao serve para nada.
  if (!device) {
    if (event === "presence") {
      const update = await resolveUpdateGlobal(rustdesk_id);
      if (update) return json({ error: "device_not_registered", update }, 404);
    }
    return json({ error: "device_not_registered" }, 404);
  }
  if (!device.agent_token_hash) return json({ error: "device_not_provisioned" }, 401);

  // 2) Autenticar o agente.
  //
  // Continua 401 — aqui o agente NAO entra em laco por causa da resposta (o
  // presence segue a cadencia normal), entao nao ha o problema que o
  // rotate-device-secret tinha. Mas o rustdesk_id vai pro log de proposito: os
  // logs da plataforma so guardam o IP, e em 05/09/2026 isso impediu de
  // descobrir QUAL maquina estava com token divergente. Um device nesse estado
  // nao volta sozinho — precisa ser re-adotado — entao ele tem que ser
  // localizavel.
  if (presentedHash !== device.agent_token_hash) {
    console.warn("session_token_invalido", rustdesk_id, device.id);
    return json({ error: "unauthorized" }, 401);
  }

  const nowIso = new Date().toISOString();

  // Override manual: marca no cadastro para silenciar UMA maquina especifica que
  // ainda reporta versao (logo, escapa da guarda la de cima). Serve para o caso
  // pontual — uma maquina em laco, um cliente que pediu para sair do monitoramento
  // — sem precisar de deploy. O caso das 82 nao passa por aqui: aquelas morrem
  // antes, sem consulta nenhuma.
  if (event === "presence" && device.ignorar_presenca === true) {
    return json({ ok: true, action: "presence", ignored: "marcado_no_cadastro" });
  }

  // 2.1) Presenca: qualquer evento autenticado prova que a maquina esta viva agora.
  // O painel calcula online/offline por address_book.last_online > now() - JANELA_ONLINE_MS
  // (src/lib/presenca.ts; hoje 7min, dimensionada pelo presenceInterval do agente), e o
  // agente ocioso so manda "presence" (60s em 60s) — por isso o carimbo vem ANTES do
  // roteamento por evento, e nao so no ramo de sessao.
  //
  // Carona da versao do agente: o mesmo update que ja acontece a cada sinal grava
  // agent_version, entao a visibilidade de frota sai de graca (zero requisicao a
  // mais). So escreve quando o agente informou — um agente antigo, que nao manda o
  // campo, nao deve apagar a versao ja conhecida do dispositivo.
  const patch: { last_online: string; agent_version?: string } = { last_online: nowIso };
  if (agent_version) patch.agent_version = agent_version;
  const { error: presErr } = await db
    .from("address_book")
    .update(patch)
    .eq("id", device.id);

  // "presence" = maquina ligada e ociosa. Marca presenca e sai: nao abre, nao fecha
  // e nao toca em connection_logs (nao e sessao, nao cobra, nao gera grant).
  //
  // O 'update' sai SO aqui, e nao no start/heartbeat, porque 'presence' e a unica
  // prova que o servidor tem de que a maquina esta ociosa. Trocar o binario e
  // reiniciar o servico no meio de um atendimento derrubaria a telemetria da sessao
  // em curso — e um tecnico conectado veria a conexao oscilar sem explicacao.
  if (event === "presence") {
    if (presErr) return json({ error: "db_error", detail: presErr.message }, 500);
    const update = await resolveUpdate(device.id);

    // Aviso pendente para ESTA maquina (ela e a do tecnico). Vem de um acesso
    // direto que ele fez a uma maquina desatualizada — ver o 'start' abaixo. O
    // presence e o unico canal que o servidor tem para falar com um agente
    // ocioso, entao e por aqui que o aviso sai.
    //
    // Fail-open: se a busca falhar, a presenca NAO pode quebrar por causa de um
    // aviso. Perder um aviso custa um lembrete; perder presenca custa o status
    // da maquina.
    let aviso: { titulo: string; mensagem: string } | null = null;
    try {
      const { data: avisoRows } = await db.rpc("puxar_aviso_agente", {
        p_rustdesk_id: rustdesk_id,
      });
      const a = Array.isArray(avisoRows) ? avisoRows[0] : avisoRows;
      if (a?.titulo && a?.mensagem) aviso = { titulo: a.titulo, mensagem: a.mensagem };
    } catch { /* sem aviso desta vez */ }

    const corpo: Record<string, unknown> = { ok: true, action: "presence" };
    if (update) corpo.update = update;
    if (aviso) corpo.aviso = aviso;
    return json(corpo);
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

  // ACESSO DIRETO A MAQUINA DESATUALIZADA -> deixa um aviso para o tecnico.
  //
  // O painel ja barra quem clica em Conectar por la. Este ramo cobre quem abre o
  // cliente e digita o ID: nao ha tela nossa nesse caminho, e a maquina acessada
  // nao pode mostrar nada (o agente dela e justamente o desatualizado). Entao o
  // aviso vai para a maquina DO TECNICO, que o `controller_rustdesk_id` acabou
  // de identificar, e sai no proximo presence dele — ate 3 min depois.
  //
  // So no 'start': heartbeat repetiria o registro a cada batida da mesma sessao.
  // A RPC ainda dedupe por (destino, alvo) pendente, mas nao custa nada nao
  // chamar 300 vezes.
  if (
    event === "start" &&
    controller_rustdesk_id &&
    !agent_version // a maquina ACESSADA e a desatualizada
  ) {
    try {
      await db.rpc("registrar_aviso_desatualizado", {
        p_destino_rustdesk_id: controller_rustdesk_id,
        p_alvo_rustdesk_id: rustdesk_id,
        p_alvo_nome: device.alias ?? null,
      });
    } catch { /* aviso e acessorio: nunca derruba a sessao */ }
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
