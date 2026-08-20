// supabase/functions/doctorsaas/index.ts
// AcessoFast — a API que o DoctorSaaS chama. Primeira superficie de ENTRADA do
// painel: todas as outras functions exigem sessao de usuario, esta se autentica
// por chave.
//
// AUTENTICACAO
// Header `X-AcessoFast-Key`. A chave nao esta em lugar nenhum do nosso banco —
// guardamos o SHA-256 dela (integration_keys.key_hash), entao o lookup e pelo
// hash do que chegou. Isso tambem responde "de quem e esta chamada": a chave e
// emitida POR tenant, e o tenant dela e o unico que a chamada alcanca. Nao ha
// parametro de empresa em lugar nenhum deste arquivo, de proposito — se
// houvesse, seria uma forma de um assinante escrever no cadastro de outro.
//
// verify_jwt PRECISA estar desligado no deploy. Nao e afrouxamento: e que a
// autenticacao daqui e a chave, e o JWT do Supabase exigiria uma sessao que o
// DoctorSaaS nao tem nem deve ter.
//
// DUAS ACOES
//   vincular_conversa     de quem e esta conversa. Casa o CNPJ, cria o cliente
//                         se faltar, grava o vinculo. E o que faz a tela de
//                         escolher cliente sumir.
//   sincronizar_clientes  a carteira em lote. So CRIA o que falta — nunca
//                         sobrescreve cadastro nosso, porque o nome daqui pode
//                         ter sido corrigido a mao e a importacao nao tem como
//                         saber qual dos dois esta certo.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-acessofast-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Teto por chamada. Carteira maior que isso vem paginada — evita uma requisicao
// de 20 MB derrubar a function e o cadastro entrar pela metade sem ninguem ver.
const MAX_CLIENTES = 500;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function sha256Hex(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function soDigitos(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

type EmpresaEntrada = { nome?: string; cnpj?: string; telefone?: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const chave = req.headers.get("x-acessofast-key") ?? "";
    if (!chave) return json({ error: "chave_ausente" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // A busca e pelo hash: chave errada nao encontra linha, e nunca chegamos a
    // comparar texto com texto.
    const { data: registro } = await admin
      .from("integration_keys")
      .select("id, tenant_id, revoked_at")
      .eq("key_hash", await sha256Hex(chave))
      .maybeSingle();

    if (!registro || registro.revoked_at) return json({ error: "chave_invalida" }, 401);
    const tenantId = registro.tenant_id as string;

    const body = await req.json().catch(() => ({}));
    const acao = String(body?.acao ?? "");

    // "Essa integracao esta viva?" sem precisar abrir log. Falhar aqui nao pode
    // derrubar a chamada — e telemetria, nao regra.
    void admin
      .from("integration_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", registro.id)
      .then(() => {});

    // ------------------------------------------------------------------
    if (acao === "vincular_conversa") {
      const conv = String(body?.conv ?? "").trim();
      if (!conv || conv.length > 200) return json({ error: "conv_invalido" }, 400);

      const entrada = (body?.empresa ?? {}) as EmpresaEntrada;
      const cnpj = soDigitos(entrada.cnpj);
      const nome = String(entrada.nome ?? "").trim();
      if (cnpj.length !== 14) return json({ error: "cnpj_invalido" }, 400);

      const { data: exatos } = await admin
        .from("clients")
        .select("id, name, document")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .eq("document", cnpj);

      let cliente = (exatos ?? [])[0] ?? null;
      let criado = false;

      if (!cliente) {
        // Sem o CNPJ exato, tenta a raiz: matriz e filial quase nunca batem
        // entre dois cadastros diferentes.
        const { data: raiz } = await admin
          .from("clients")
          .select("id, name, document")
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .eq("document_type", "cnpj")
          .like("document", `${cnpj.slice(0, 8)}%`);

        const irmaos = raiz ?? [];
        if (irmaos.length === 1) {
          cliente = irmaos[0];
        } else if (irmaos.length > 1) {
          // Varias unidades do grupo e nenhuma com este CNPJ. Escolher uma seria
          // chute, e chute errado manda o tecnico para as maquinas da filial
          // errada. Melhor deixar a janelinha perguntar.
          return json({
            ok: true,
            vinculado: false,
            motivo: "varias_unidades",
            detalhe: "O grupo tem mais de uma unidade e nenhuma com este CNPJ exato.",
          });
        }
      }

      if (!cliente) {
        if (!nome) return json({ error: "nome_obrigatorio_para_criar" }, 400);
        const { data: novo, error: cErr } = await admin
          .from("clients")
          .insert({
            tenant_id: tenantId,
            name: nome,
            document: cnpj,
            document_type: "cnpj",
            phone: soDigitos(entrada.telefone) || null,
          })
          .select("id, name, document")
          .single();
        if (cErr) return json({ error: "falha_ao_criar_cliente", detalhe: cErr.message }, 500);
        cliente = novo;
        criado = true;
      }

      const { error: vErr } = await admin
        .from("doctorsaas_conversation_links")
        .upsert(
          { tenant_id: tenantId, conversation_id: conv, client_id: cliente!.id },
          { onConflict: "tenant_id,conversation_id" },
        );
      if (vErr) return json({ error: "falha_ao_vincular", detalhe: vErr.message }, 500);

      return json({
        ok: true,
        vinculado: true,
        cliente_criado: criado,
        cliente: { id: cliente!.id, nome: cliente!.name },
      });
    }

    // ------------------------------------------------------------------
    if (acao === "sincronizar_clientes") {
      const lista = Array.isArray(body?.clientes) ? (body.clientes as EmpresaEntrada[]) : null;
      if (!lista) return json({ error: "clientes_ausente" }, 400);
      if (lista.length > MAX_CLIENTES) {
        return json({ error: "lote_grande_demais", maximo: MAX_CLIENTES }, 400);
      }

      const validos: { cnpj: string; nome: string; telefone: string | null }[] = [];
      const recusados: { cnpj: string; motivo: string }[] = [];
      for (const item of lista) {
        const cnpj = soDigitos(item?.cnpj);
        const nome = String(item?.nome ?? "").trim();
        if (cnpj.length !== 14) recusados.push({ cnpj, motivo: "cnpj_invalido" });
        else if (!nome) recusados.push({ cnpj, motivo: "nome_vazio" });
        else validos.push({ cnpj, nome, telefone: soDigitos(item?.telefone) || null });
      }

      // Uma consulta so para saber o que ja existe, em vez de uma por cliente.
      const { data: existentes } = await admin
        .from("clients")
        .select("document")
        .eq("tenant_id", tenantId)
        .in(
          "document",
          validos.map((v) => v.cnpj),
        );
      const jaTem = new Set((existentes ?? []).map((c) => c.document as string));

      const novos = validos.filter((v) => !jaTem.has(v.cnpj));
      let criados = 0;
      if (novos.length > 0) {
        const { data: inseridos, error: iErr } = await admin
          .from("clients")
          .insert(
            novos.map((v) => ({
              tenant_id: tenantId,
              name: v.nome,
              document: v.cnpj,
              document_type: "cnpj",
              phone: v.telefone,
            })),
          )
          .select("id");
        if (iErr) return json({ error: "falha_ao_importar", detalhe: iErr.message }, 500);
        criados = (inseridos ?? []).length;
      }

      return json({
        ok: true,
        recebidos: lista.length,
        criados,
        ja_existiam: validos.length - novos.length,
        recusados,
      });
    }

    return json(
      { error: "acao_desconhecida", acoes: ["vincular_conversa", "sincronizar_clientes"] },
      400,
    );
  } catch (e) {
    console.error("doctorsaas_api_internal", String(e));
    return json({ error: "internal_error" }, 500);
  }
});
