# Billing & Quota — Design (AcessoFast)

> **Escopo:** monetização do AcessoFast — **Free (5/dia)**, **Créditos (top-up)** e **Planos** (Team/Business/Scale/Enterprise), com trial, dunning e cobrança via **Asaas**. Fonte de verdade do modelo; ainda **não implementado** (só planos/seats/Asaas/claims estão scaffolded no schema).
> **Regras confirmadas com o cliente em 2026-07-26.** Itens abertos marcados em **§11**.
> Complementa o `FASE3-DESIGN.md` (controle de acesso/credencial). O **ponto de cobrança reusa o mesmo choke point da Fase 1/3: a emissão da credencial no `connect-device`**.

---

## 0. Princípio central

Toda decisão de billing acontece **no mesmo ponto único** onde a credencial é emitida — o `connect-device` (RPC `create_access_grant`). Antes de emitir a senha ao técnico, o servidor decide: **pode conectar? sob qual débito (free / crédito / plano)?** Isso mantém o choke point da arquitetura de acesso e evita espalhar regra de cobrança pelo sistema.

Um segundo enforcement é **temporal**: o **corte às 2h do free** é um `end` forçado da sessão → reusa a **rotação de fim-de-sessão da Fase 3** (`fase3-teste1-validado`).

---

## 1. Os três modos

| Modo | Escopo | Unidade de consumo | Simultaneidade | Limite de tempo |
|------|--------|--------------------|----------------|-----------------|
| **Free** | por **conta** (individual, ~1 técnico) | 1 acesso = 1 **device distinto/dia** (teto 5/dia) | **1** | **2h/atendimento** → corte + rotação |
| **Créditos** | por **conta** | 1 crédito = 1 atendimento/device por **janela de 3h** | **ilimitada** | sessão máx = **TBD** (§11) |
| **Planos** | por **tenant** | **nenhuma** (uso ilimitado) | por técnico (5 / 10 / ∞) | — |

**Reset do free:** diário à **meia-noite `America/Sao_Paulo` (GMT-3)**.

**Definição de "atendimento":** um agrupamento de conexões ao **mesmo `rustdesk_id`** dentro de uma **janela de tolerância** (2h no free, 3h no crédito). Reconexões dentro da janela **não** geram novo consumo. Passou da janela → **novo atendimento** → nova cobrança.

---

## 2. Algoritmo de metering (Free × Crédito) — coexistência

Aplicado **a cada novo atendimento** numa conta free-capaz com créditos. Confirmado por diagrama do cliente.

```
ao "Conectar" (connect-device), para device D do técnico T:

  # 1) reconexão dentro da janela? não cobra.
  se existe atendimento ATIVO/recente de T→D dentro da janela (2h free | 3h crédito):
      → reconecta, NÃO consome nada

  # 2) novo atendimento: decide a fonte do débito
  ativos = nº de sessões ATIVAS de T neste instante
  se ativos == 0 (individual) E free_restante_hoje > 0:
      → OFERECER ESCOLHA ao técnico:
          [A] usar 1 ACESSO FREE   (teto 2h; reconnect grátis ≤2h)
          [B] usar 1 CRÉDITO       (sem teto 2h; reconnect grátis ≤3h)
  senão:                            # já simultâneo, OU free esgotado
      se saldo_creditos > 0:
          → consome 1 CRÉDITO
      senão:
          → BLOQUEIA (oferece comprar créditos / conhecer planos)
```

**Exemplo (3 PCs simultâneos, 3 free + 10 créditos):** 1º = individual → **free**; 2º e 3º = simultâneos → **1 crédito cada**. Resultado: 1 free + 2 créditos.

**Escolha free×crédito (§ novo):** só aparece no caso individual+free-disponível. Racional: o free trava em 2h; num atendimento longo o técnico prefere já entrar no crédito e não ser cortado.

**Fim das 2h do free:** ao completar 2h, a sessão free é **desconectada** e a **senha rotaciona**. Para voltar, o técnico **reconecta** e isso conta como **novo acesso** (free se ainda houver / crédito), passando pelo algoritmo de novo. (Não há auto-conversão silenciosa.)

---

## 3. Planos — "ilimitado dentro da concorrência"

Tarifa fixa. **Sem** metering por conexão (não gasta free nem crédito). Únicos limites: **concorrência por técnico** + **seats (usuários)**.

| Plano | Usuários | Simult./técnico | Mensal | Anual | Trial | Ativação |
|-------|----------|-----------------|--------|-------|-------|----------|
| **Team** | 10 | 5 | R$ 249 | R$ 2.988 | **7d** | imediata |
| **Business** | 20 | 10 | R$ 449 | R$ 5.388 | **7d** | imediata |
| **Scale** | 50 | **∞** | R$ 899 | R$ 10.788 | **não** | **pay-first** |
| **Enterprise** | custom | custom | sob consulta | — | — | comercial |

- **Anual = mesmo total** (12×), **sem desconto** por ora (regra futura — §11).
- Mapeamento no schema existente: **`plans.max_concurrent_per_tech`** (o gate da Fase 1) + **`plans.max_users`** / seats (`tenant_seat_usage`, `assign_member`). Preços em `price_month_cents`/`price_year_cents` + `billing_cycle`.

---

## 4. Fluxos de acesso ao portal (§1/§7)

**Cadastro (site comercial):** e-mail, nome da empresa, CPF/CNPJ, telefone → cria conta → e-mail para definir senha. Técnicos são convidados pelo admin (definem a própria senha por e-mail).

| Origem | Acesso ao portal | Pagamento |
|--------|------------------|-----------|
| **Free** | imediato | — |
| **Team / Business** | imediato (entra em **trial 7d**) | cartão na **aba Financeiro** antes do fim do trial |
| **Scale** | **só após pagamento confirmado** (pay-first, Asaas) | no checkout, antes do acesso |
| **Enterprise** | via comercial | contrato/comercial |
| **Créditos** | (conta já existe) | compra na **aba Financeiro** |

**Aba Financeiro (no painel):** ligada à **API do Asaas** — cartão, compra de créditos, faturas/comprovantes, estado da assinatura/trial, e o CTA de upgrade. É o único lugar de cobrança pós-acesso.

---

## 5. Trial (§5/§6) — máquina de estados

Só **Team/Business**. **1 trial por CNPJ** (anti-farming).

```
[signup Team/Business] → TRIAL(7d, countdown no painel)
   ├─ voucher aplicado (1/CNPJ, dias def. pelo comercial) → TRIAL estende (não empilha)
   ├─ cartão cadastrado + fim do trial → Asaas cobra
   │      sucesso → ACTIVE (assinatura; uso sem interrupção; comprovante ao e-mail financeiro)
   │      falha   → DUNNING (§6)
   └─ fim do trial SEM cartão → BLOCKED_TRIAL
            (novos acessos bloqueados; devices/usuários/histórico mantidos)
            saídas: assinar · aplicar voucher · solicitar mais dias · falar com comercial
```

**Solicitação de mais dias (§7 do spec):** plano em teste + empresa + motivo + telefone → comercial analisa → se aprovado, aplica voucher. Envio **não** garante extensão. Registrar no histórico.

---

## 6. Renovação & Dunning (§9/§10)

**Mensal (Team/Business/Scale):**
```
vencimento → Asaas tenta renovar
   sucesso → ACTIVE (novo ciclo)
   falha   → DUNNING: janela de 5 DIAS CORRIDOS
        durante: avisa; acessos SEGUEM liberados; pode atualizar cartão / retentar
        fim dos 5 dias sem pagar → BLOCKED_BILLING
              (novos acessos bloqueados; devices/usuários/histórico mantidos)
```

**Anual (Team/Business/Scale):**
```
vencimento − 30d → AVISO (dias restantes, data, valor, forma de pagto, timeline)
   durante o aviso: NENHUM acesso bloqueado; pode renovar antecipado / atualizar cartão
   não renovou no vencimento → (política a alinhar: mesma dunning 5d? — §11)
```

---

## 7. Modelo de dados (proposto)

**Já existe** (reusar): `plans`, `tenants` (`max_concurrent_per_tech`, `billing_email`), `tenant_settings`, `tenant_features`/`features`, `tenant_seat_usage`, `assign_member`/`assign_plan`, `asaas_events`, `signup_intents`, `leads`, `clients`, `address_book`, `connection_logs`, `log_connection_attempt`, `close_stale_sessions`, `create_access_grant`, claims (`claim_register`/`claim_poll`/`redeem_claim`).

**Novo** (a criar):

| Tabela | Papel |
|--------|-------|
| `account_plan` / uso de `tenants` | modo atual da conta: `free` \| `credits` \| `plan:<id>` \| `trial` \| estado dunning |
| `credit_ledger` | razão append-only: +compras (via Asaas) / −consumo (por atendimento); saldo = soma |
| `credit_packages` | catálogo 20/50/200/1000 + preço (valores TBD) |
| `daily_access` | contador free por conta+dia (`account_id`, `date_gmt3`, `used`, cap 5); reset lógico por data |
| `atendimentos` | 1 linha por atendimento: `account/tenant`, `technician_id`, `rustdesk_id`, `source` (free\|credit\|plan), `started_at`, `window_expires_at` (2h/3h), `ended_at`, `charged` |
| `trials` | `tenant_id`, `plan`, `starts_at`, `ends_at`, estado, cartão? |
| `vouchers` | `code`, `cnpj`, `days`, `used_at`, `applied_by` (comercial); 1/CNPJ |
| `voucher_requests` | solicitações de mais dias (empresa, motivo, telefone, status) |

> `atendimentos` é a peça que implementa a **janela de tolerância** (2h free / 3h crédito) e evita cobrança dupla em reconexão — provável evolução do `connection_logs` + `create_access_grant`.

---

## 8. Mapa de enforcement (onde cada regra "morde")

| Regra | Onde | Como |
|-------|------|------|
| Escolha free/crédito, débito, bloqueio por saldo | **`connect-device`** (`create_access_grant`) | decide fonte + grava `atendimentos` + debita `credit_ledger`/`daily_access` antes de emitir a senha |
| Concorrência por técnico (plano) | **`connect-device`** | já existe — `max_concurrent_per_tech` |
| Reconnect sem cobrar (janela 2h/3h) | **`connect-device`** | consulta `atendimentos` ativo/recente do par técnico→device |
| **Corte às 2h (free)** | **agente / relay** | timer de sessão → `end` forçado → **rotação Fase 3**; painel marca fim + libera o slot |
| Bloqueio por trial/dunning expirado | **`connect-device`** + UI | estado da conta nega emissão; painel mostra CTA |
| Renovação/cobrança/trial→assinatura | **Asaas webhooks** → `asaas_events` | atualiza estado da conta |

**A construir de fato novo:** o **corte temporal às 2h** (não existe hoje) e o **débito no `connect-device`** (o gate atual só conta concorrência, não cobra).

---

## 9. Interface (§2/§3 — o que o painel mostra)

- **Free:** acessos usados / restantes, sessão em andamento, tempo consumido no device, horário da renovação (meia-noite GMT-3). Aviso ao restar 1–2 acessos (comprar créditos / conhecer planos). Bloqueio de 2ª simultânea → retomar sessão / comprar / planos.
- **Créditos:** saldo, créditos usados, histórico de consumo (técnico, device, cliente atendido). Aviso de saldo baixo; saldo zero → comprar/plano. **Recomendação consultiva** de plano com base no consumo.
- **Planos:** trial countdown; dunning/renovação (timeline, dias restantes, valor, forma de pagamento).

---

## 10. Adoção de device (automação) — já existe, decisão em aberto

O agente **auto-registra** um claim por `rustdesk_id` no enroll; o técnico **adota por ID** (`redeem_claim`/`adopt-device`). O download genérico em `/baixar` **força o caminho sem segredo de tenant**.

⚠️ **Risco bearer** (ID de 9 dígitos, enumerável): qualquer tenant que souber o ID adota. **Postura anti-sequestro = decisão em aberto** — opções: confirmação no endpoint (código efêmero), exigir device online+validado, ou release-para-readotar. Ver `acessofast-access-control-plan`.

---

## 11. Em aberto

- **§7 site:** ✅ resolvido — Scale pay-first; demais acesso imediato + aba Financeiro (Asaas).
- **Créditos:** valores/quantidades dos pacotes; **validade** dos créditos comprados.
- **Tempo máx** de uma sessão paga por crédito.
- **Anual:** política de não-renovação (mesma dunning de 5d?); desconto anual (hoje sem).
- **Enterprise:** condições comerciais.
- **Anti-sequestro** da adoção genérica por ID.

---

## 12. Sequenciamento de implementação (roadmap)

Ordenado por **dependência** e por **caminho crítico do produto** (o par Free+Crédito funcionando ponta a ponta é o menor incremento vendável). Fases nomeadas **B0–B5** para não colidir com as Fases 1/2/3 do controle de acesso.

**Pré-requisitos de entrada (bloqueiam qualquer migration/deploy):**
- **Supabase MCP `supabase-acessofast` reconectado** ao projeto **`plmfyibyrowbgjjyblcl`**. O MCP conectado nesta sessão (`Supa_Hiper`) aponta pro projeto **errado** (`ygevmtqzainzcjrqxenr`) — **não usar** pra migrations/deploy. Sem isso, dá pra escrever migrations/edge functions em arquivo, mas **não aplicar**.
- **Decisão B1:** contrato de duas etapas do connect-device pra "escolha free×crédito" (§2). 
- **Decisão B2:** onde vive o timer do corte de 2h (recomendação: **agente**, que já rastreia sessão e rotaciona — Fase 3).

### B0 — Fundação de schema  *(desbloqueia tudo)*
- **Entregáveis:** migrations das tabelas novas (§7): `account_plan`/estado na `tenants`, `credit_ledger`, `credit_packages`, `daily_access`, `atendimentos`, `trials`, `vouchers`, `voucher_requests`. RLS + índices (par técnico→device+janela em `atendimentos`; `account_id+date_gmt3` em `daily_access`).
- **Depende de:** pré-req Supabase. **Não** bloqueia por valores TBD (schema aceita catálogo vazio).
- **Esforço:** M.

### B1 — Metering no `connect-device`  *(o coração — §8 "novo")*
- **Entregáveis:** estender `create_access_grant` pra: (1) detectar **reconexão dentro da janela** em `atendimentos` → não cobra; (2) contar **sessões ativas** do técnico; (3) decidir **fonte** (free/crédito/plano) pelo algoritmo §2; (4) na etapa individual+free-disponível, **retornar a escolha** [A]free/[B]crédito pro cliente e reentrar com a decisão; (5) **debitar** `credit_ledger`/`daily_access` e **gravar `atendimentos`** antes de emitir a senha; (6) **bloquear** por saldo/quota com CTA.
- **Depende de:** B0. Reusa o gate de concorrência (`max_concurrent_per_tech`) já existente.
- **Esforço:** G. **Pode rodar em paralelo com B3** (superfícies distintas).

### B2 — Corte temporal às 2h (free)  *(§8 "novo" — reusa Fase 3)*
- **Entregáveis:** no **grant**, backend sinaliza ao agente "sessão com **cap rígido de 2h**" (só free; crédito/plano = sem cap). Agente arma timer → aos 2h força **`end`** → **rotação Fase 3**. Painel marca fim + **libera o slot**.
- **Depende de:** B1 (fonte=free + `atendimentos.window_expires_at`). Reaproveita o caminho `end`→rotação já **validado na canary** (`fase3-teste1-validado`). Provável rebuild do agente + instalador.
- **Esforço:** M.

### B3 — Financeiro + Asaas  *(habilita receber dinheiro)*
- **Entregáveis:** aba **Financeiro** no painel; **compra de crédito** (Asaas → credita `credit_ledger`); estado de assinatura/trial; **webhooks Asaas → `asaas_events` → estado da conta**; faturas/comprovantes. Catálogo `credit_packages` (valores — §11).
- **Depende de:** B0. Reusa `asaas_events`/`signup_intents`/`PlanCheckoutDialog`.
- **Esforço:** G. **Paraleliza com B1/B2 após B0.**

### B4 — Trial & Dunning  *(ciclo de vida do plano)*
- **Entregáveis:** máquinas de estado §5/§6 (trial 7d Team/Business, 1/CNPJ; dunning mensal 5d corridos; aviso anual 30d); `vouchers`/`voucher_requests` + fluxo comercial; **countdown/timeline** na UI; estados `BLOCKED_TRIAL`/`BLOCKED_BILLING` negando emissão no connect-device.
- **Depende de:** B0 + B3 (Asaas cobra/renova). 
- **Esforço:** G.

### B5 — Anti-sequestro da adoção  *(decisão em aberto → hardening)*
- **Entregáveis:** fechar a **postura** (§10/§11) e endurecer `redeem_claim`/`adopt-device` (código efêmero / device online+validado / release-pra-readotar).
- **Depende de:** só da **decisão** — independente das demais.
- **Esforço:** P–M.

### Caminho crítico e paralelismo
```
B0 ──┬── B1 ── B2            (Free+Crédito ponta a ponta = 1º produto vendável)
     └── B3 ── B4            (receber $ → ciclo de plano)
B5 (independente, após decisão)
```
**Menor incremento vendável:** B0 → B1 → B2 (free com corte real + crédito). **Receita de crédito** exige também B3. **Planos** já têm scaffolding (concorrência+seats+Asaas parcial); faltam trial/dunning (B4).
