// supabase/functions/definir-senha-dispositivo/index.ts
// AcessoFast — Passo 2 do plano "Aposentar a Senha Rotativa": senha propria da
// maquina, definida pelo painel.
//
// A senha digitada NAO vai para device_secrets. Ela vira um PEDIDO
// (private.senha_pedida), que o proximo presence leva ao agente; o agente aplica com
// --password e confirma pelo rotate-device-secret, e so entao ela passa a ser a senha
// que o Conectar entrega. Ate la o Conectar segue com a antiga — que e a que a maquina
// tem. E a invariante da Fase 2, intacta: o painel nunca conhece uma senha que ainda
// nao esta no endpoint. (O provision-device-secret, que grava direto e manda aplicar a
// mao, continua existindo para maquina sem agente.)
//
// Acoes (POST, JWT do usuario):
//   status    { device_id, pedido_id?, desde? } -> elegibilidade + estado do pedido
//   definir   { device_id, senha }              -> cria/substitui o pedido
//   cancelar  { device_id, pedido_id }          -> apaga o pedido, se ainda vigente
//
// QUEM PODE. 14/09/2026: validado em campo so com super_admin; no mesmo dia aberto a
// admin, head e tecnico — sempre da empresa DONA do dispositivo (super_admin, de
// qualquer uma). Excecao: dispositivo PRIVADO. Nele so admin e super_admin definem,
// porque quem define a senha passa a conhece-la, e o privado existe justamente para o
// tecnico nao conhecer (ver a connect-device e a migration 20260914160000).
//
// CONTRATO DE CRIPTO: o de device_secrets (AES-256-GCM, IV 12 bytes, base64,
// key_version 1, chave DEVICE_SECRET_ENC_KEY), com AAD = "senha_pedida:" + device_id.
// Quem decifra e a session-ingest, no presence.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PAPEIS_QUE_DEFINEM = ["super_admin", "admin", "head", "tech"];
// Mesma lista da connect-device: quem ve a senha de um dispositivo privado.
const PAPEIS_QUE_VEEM_PRIVADO = ["super_admin", "admin"];

// Primeiro build do agente que sabe aplicar a senha pedida. Mesma comparacao por
// string que o painel usa para versao (AAAA.MM.DD vem primeiro, largura fixa). A
// session-ingest tem a mesma constante: agente mais velho nem recebe o pedido.
const VERSAO_MINIMA_AGENTE = "2026.09.14";

// Senha propria so faz sentido onde a rotacao de rotina esta desligada (Passo 1): em
// 'session' o proximo fim de sessao sorteia outra por cima da que foi escolhida, e o
// painel mostraria "aplicada" para uma senha que ja morreu.
const MODOS_SEM_ROTINA = ["install_only", "off"];

// Regra da senha — ESPELHADA em senhaAceitavel (senha_painel.go, repo do agente).
// Letras, digitos e um punhado de simbolos que nao pedem escape em lugar nenhum: a
// senha e digitada por gente e atravessa uma linha de comando do Windows.
const SENHA_MIN = 8;
const SENHA_MAX = 64;
const SENHA_RE = /^[A-Za-z0-9!@#$%*\-_=+.?]+$/;

function senhaAceitavel(pw: string): boolean {
  return pw.length >= SENHA_MIN && pw.length <= SENHA_MAX &&
    SENHA_RE.test(pw) && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

type Device = {
  id: string;
  tenant_id: string;
  rustdesk_id: string;
  os: string | null;
  is_active: boolean | null;
  privado: boolean | null;
  agent_version: string | null;
  agent_token_hash: string | null;
  rotacao_modo_efetivo: string | null;
  last_online: string | null;
};

// Por que ESTE usuario nao pode definir a senha DESTA maquina agora — ou null.
function bloqueio(d: Device, papel: string): string | null {
  if (d.privado === true && !PAPEIS_QUE_VEEM_PRIVADO.includes(papel)) return "dispositivo_privado";
  if (d.is_active === false) return "dispositivo_inativo";
  if (!d.agent_token_hash) return "sem_agente";
  if (/^(android|ios)/i.test(d.os ?? "")) return "plataforma_movel";
  if (!d.agent_version || d.agent_version < VERSAO_MINIMA_AGENTE) return "agente_antigo";
  if (!MODOS_SEM_ROTINA.includes(d.rotacao_modo_efetivo ?? "")) return "rotacao_ativa";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing_authorization" }, 401);

    const body = await req.json().catch(() => ({}));
    const deviceId = body?.device_id;
    if (typeof deviceId !== "string" || !UUID_RE.test(deviceId)) {
      return json({ error: "device_id_invalido" }, 400);
    }
    const acao = body?.acao;
    if (!["status", "definir", "cancelar"].includes(acao)) {
      return json({ error: "acao_invalida" }, 400);
    }

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

    const { data: profile } = await admin
      .from("profiles").select("role, tenant_id, is_active").eq("id", user.id).maybeSingle();
    if (!profile || profile.is_active === false) return json({ error: "user_inactive_or_missing" }, 403);
    if (!PAPEIS_QUE_DEFINEM.includes(profile.role)) return json({ error: "forbidden" }, 403);

    const { data: device, error: devErr } = await admin
      .from("address_book")
      .select("id, tenant_id, rustdesk_id, os, is_active, privado, agent_version, agent_token_hash, rotacao_modo_efetivo, last_online")
      .eq("id", deviceId)
      .maybeSingle<Device>();
    if (devErr) return json({ error: "lookup_failed" }, 500);
    // Dispositivo de outra empresa responde igual a inexistente: nao confirma que existe.
    if (!device || (profile.role !== "super_admin" && device.tenant_id !== profile.tenant_id)) {
      return json({ error: "device_nao_encontrado" }, 404);
    }

    const motivo = bloqueio(device, profile.role);

    // ---------------------------------------------------------------- status
    if (acao === "status") {
      const { data: rows, error } = await admin.rpc("status_senha_pedida", { p_device_id: deviceId });
      if (error) return json({ error: "status_failed" }, 500);
      const r = (Array.isArray(rows) ? rows[0] : rows) ?? {};

      // O estado so tem sentido em relacao a UM pedido — o que esta tela fez.
      const meu = typeof body?.pedido_id === "string" ? body.pedido_id : null;
      const desde = typeof body?.desde === "string" ? body.desde : null;
      let estado: "sem_pedido" | "pendente" | "expirado" | "aplicada" | "substituido" = "sem_pedido";
      if (meu) {
        if (r.pedido_id === meu) {
          estado = new Date(r.expira_em).getTime() > Date.now() ? "pendente" : "expirado";
        } else if (r.pedido_id) {
          estado = "substituido";
        } else if (desde && r.senha_atualizada_em && r.senha_atualizada_em >= desde) {
          // O pedido sumiu e a senha do painel mudou depois dele: foi a confirmacao.
          estado = "aplicada";
        }
      } else if (r.pedido_id) {
        estado = new Date(r.expira_em).getTime() > Date.now() ? "pendente" : "expirado";
      }

      return json({
        estado,
        bloqueio: motivo,
        privado: device.privado === true,
        pedido_id: r.pedido_id ?? null,
        pedido_em: r.pedido_em ?? null,
        expira_em: r.expira_em ?? null,
        senha_atualizada_em: r.senha_atualizada_em ?? null,
        modo_efetivo: device.rotacao_modo_efetivo,
        agent_version: device.agent_version,
        last_online: device.last_online,
      });
    }

    // Privado barra tambem o cancelar: nao ha senha em jogo, mas quem nao pode pedir
    // tambem nao desfaz o pedido de um admin.
    if (motivo === "dispositivo_privado") return json({ error: motivo }, 403);

    // -------------------------------------------------------------- cancelar
    if (acao === "cancelar") {
      const pedidoId = body?.pedido_id;
      if (typeof pedidoId !== "string" || !UUID_RE.test(pedidoId)) {
        return json({ error: "pedido_id_invalido" }, 400);
      }
      const { data, error } = await admin.rpc("cancelar_senha_pedida", {
        p_device_id: deviceId,
        p_pedido_id: pedidoId,
      });
      if (error) return json({ error: "cancel_failed" }, 500);
      console.info("senha_pedida_cancelada", device.rustdesk_id, user.id, data === true);
      return json({ cancelado: data === true });
    }

    // --------------------------------------------------------------- definir
    if (motivo) return json({ error: motivo }, 409);

    const senha = typeof body?.senha === "string" ? body.senha : "";
    if (!senhaAceitavel(senha)) return json({ error: "senha_invalida" }, 400);

    const encKeyB64 = Deno.env.get("DEVICE_SECRET_ENC_KEY");
    if (!encKeyB64) return json({ error: "server_misconfig" }, 500);

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey(
      "raw", b64ToBytes(encKeyB64), { name: "AES-GCM" }, false, ["encrypt"],
    );
    const ctBuf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(`senha_pedida:${deviceId}`) },
      key, new TextEncoder().encode(senha),
    );

    const { data: rows, error: rpcErr } = await admin.rpc("pedir_senha_dispositivo", {
      p_device_id: deviceId,
      p_ciphertext: bytesToB64(new Uint8Array(ctBuf)),
      p_iv: bytesToB64(iv),
      p_key_version: 1,
      p_actor: user.id,
    });
    if (rpcErr) return json({ error: "store_failed" }, 500);
    const p = Array.isArray(rows) ? rows[0] : rows;
    if (!p?.pedido_id) return json({ error: "store_failed" }, 500);

    // Sem a senha no log, obvio — so quem pediu, com qual papel, para qual maquina.
    console.info("senha_pedida", device.rustdesk_id, user.id, profile.role, p.pedido_id);
    return json({ pedido_id: p.pedido_id, pedido_em: p.pedido_em, expira_em: p.expira_em });
  } catch (_e) {
    return json({ error: "internal_error" }, 500);
  }
});
