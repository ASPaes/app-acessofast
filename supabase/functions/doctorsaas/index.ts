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
//   sincronizar_clientes  a carteira em lote. Cria o que falta E CORRIGE o nome
//                         do que ja existe: o DoctorSaaS e a fonte da verdade do
//                         nome, decisao de 21/08/2026. Casamento so por CNPJ
//                         exato — nome nunca casa nada, so e escrito.
//                         Cliente desativado depende de configuracao da empresa
//                         (integration_settings.reactivate_on_sync).
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

// Mesma normalizacao do indice clients_tenant_name_uk — lower(btrim(name)).
// Comparar assim evita gravar de novo o que so difere em espaco ou caixa.
function chaveNome(v: string): string {
  return v.trim().toLowerCase();
}

// 23505 e violacao de indice unico, e aqui isso quase sempre quer dizer que o
// nome ja pertence a outro cliente ativo. Vale reportar com esse nome: quem le
// a resposta precisa saber que foi grafia, nao pane.
function motivoDoErro(e: { code?: string; message?: string }): string {
  return e?.code === "23505" ? "nome_em_uso" : `falha:${e?.code ?? "?"}`;
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

      // CNPJ exato e nome diferente: o DoctorSaaS manda no nome, entao corrige
      // na hora, sem esperar a proxima importacao em lote. Nao vale para o
      // casamento por raiz mais abaixo — la o CNPJ e de OUTRA unidade, e o nome
      // que veio e da unidade errada.
      //
      // Falhar aqui nao derruba o vinculo. O nome colide com o de outro cliente
      // ativo (clients_tenant_name_uk) uma vez ou outra, e ficar sem vincular a
      // conversa por causa de grafia seria trocar um problema pequeno por um
      // grande — o tecnico voltaria a escolher cliente na mao.
      if (cliente && nome && chaveNome(cliente.name) !== chaveNome(nome)) {
        const { error: rErr } = await admin
          .from("clients")
          .update({ name: nome })
          .eq("id", cliente.id);
        if (rErr) console.warn("doctorsaas_rename_ignorado", cliente.id, rErr.code);
        else cliente = { ...cliente, name: nome };
      }

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

      // Quem manda em cliente desativado e escolha da empresa. Linha ausente vale
      // o padrao conservador: nao reativa, porque desativar aqui foi decisao de
      // quem opera o painel e uma sincronizacao nao deve desfazer sozinha.
      const { data: config } = await admin
        .from("integration_settings")
        .select("reactivate_on_sync")
        .eq("tenant_id", tenantId)
        .eq("provider", "doctorsaas")
        .maybeSingle();
      const reativar = config?.reactivate_on_sync === true;

      // Uma consulta so para saber o que ja existe, em vez de uma por cliente.
      // is_active vem junto por causa da configuracao acima.
      const { data: existentes } = await admin
        .from("clients")
        .select("id, name, phone, document, is_active")
        .eq("tenant_id", tenantId)
        .in(
          "document",
          validos.map((v) => v.cnpj),
        );
      const porDoc = new Map((existentes ?? []).map((c) => [c.document as string, c]));

      const novos: typeof validos = [];
      const paraCorrigir: {
        id: string;
        cnpj: string;
        patch: Record<string, string | boolean>;
        reativa: boolean;
      }[] = [];
      let inalterados = 0;

      for (const v of validos) {
        const atual = porDoc.get(v.cnpj);
        if (!atual) {
          novos.push(v);
          continue;
        }
        const inativo = !atual.is_active;
        if (inativo && !reativar) {
          recusados.push({ cnpj: v.cnpj, motivo: "cliente_inativo" });
          continue;
        }
        // O DoctorSaaS manda no nome: se difere, o nosso e que esta velho.
        // O telefone nao segue a mesma regra — so preenchemos o que esta vazio.
        // Na pratica o DoctorSaaS tem varios contatos por CNPJ, entao o numero
        // que chega e um deles, nao "o" telefone da empresa.
        const patch: Record<string, string | boolean> = {};
        if (inativo) patch.is_active = true;
        if (chaveNome(String(atual.name)) !== chaveNome(v.nome)) patch.name = v.nome;
        if (!atual.phone && v.telefone) patch.phone = v.telefone;
        if (Object.keys(patch).length > 0) {
          paraCorrigir.push({
            id: atual.id as string,
            cnpj: v.cnpj,
            patch,
            reativa: inativo,
          });
        } else {
          inalterados++;
        }
      }

      // Insercao em bloco, que e o caminho normal. Se UMA linha colidir de nome
      // com cliente ativo (clients_tenant_name_uk), o INSERT inteiro morre — e
      // dai a segunda tentativa, uma a uma, para o lote entrar todo menos as
      // colisoes de verdade. Custa caro so quando ja deu errado.
      let criados = 0;
      const paraInserir = novos.map((v) => ({
        tenant_id: tenantId,
        name: v.nome,
        document: v.cnpj,
        document_type: "cnpj",
        phone: v.telefone,
      }));

      if (paraInserir.length > 0) {
        const { data: inseridos, error: iErr } = await admin
          .from("clients")
          .insert(paraInserir)
          .select("id");
        if (!iErr) {
          criados = (inseridos ?? []).length;
        } else {
          for (const linha of paraInserir) {
            const { error: uErr } = await admin.from("clients").insert(linha);
            if (!uErr) criados++;
            else recusados.push({ cnpj: linha.document, motivo: motivoDoErro(uErr) });
          }
        }
      }

      // Correcoes uma a uma de proposito: UPDATE nao tem ON CONFLICT, entao em
      // bloco uma colisao de nome levaria as outras junto. Sao poucas depois da
      // primeira carga — o normal e esta lista vir vazia.
      let atualizados = 0;
      let reativados = 0;
      for (const c of paraCorrigir) {
        const { error: aErr } = await admin.from("clients").update(c.patch).eq("id", c.id);
        if (aErr) {
          recusados.push({ cnpj: c.cnpj, motivo: motivoDoErro(aErr) });
          continue;
        }
        atualizados++;
        if (c.reativa) reativados++;
      }

      return json({
        ok: true,
        recebidos: lista.length,
        criados,
        atualizados,
        reativados,
        inalterados,
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
