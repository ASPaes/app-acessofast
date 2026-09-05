# Fase 3 — Design: fechar a brecha de acesso (AcessoFast)

> Autor: sessão Claude Code + Luiz · Data: 2026-07-24
> Estado: **DESIGN / planejamento** — nada implementado. Precede qualquer mudança em `build-client.yml`, no agente ou no painel.
> Pré-requisito de leitura: `HANDOFF.md` (raiz), memórias `acessofast-access-control-plan`, `acessofast-installer-build-flow`, `supabase-project-refs`.

---

## 0. Onde estamos

- **Fase 1 (gate de quota)** e **Fase 2 (senha efêmera)** — deployadas e **validadas em produção** (2026-07-24, device rustdesk_id `51200651`, tenant ASP):
  - Rotação da senha ~0,75s após o fim da sessão (`private.device_secrets.updated_at`, `updated_by=null` = escrito pelo agente).
  - Gate de quota barra a 2ª conexão simultânea do técnico (`429 quota_exceeded`).
- **A brecha continua aberta:** o build atual do client é `approve-mode:"password-click"` + `allow-remote-config-modification:"Y"` → dá pra conectar clicando **Aceitar** (sem senha nenhuma) e dá pra reconfigurar o device remoto.

**Objetivo da Fase 3:** transformar a senha efêmera no **único** caminho de acesso, fechar a escalada por config remota, e reconciliar isso com **continuidade de sessão** (quedas curtas e reboot).

### Restrições inegociáveis (contexto do produto)
1. O fluxo "cliente baixa em `acessofast.com.br/download` e informa o ID" **não muda**.
2. A chave de relay `-k` é **pública** (embutida no client). ⇒ o relay **não distingue** conexão via painel de conexão direta. **Toda a segurança recai sobre a senha.**
3. RustDesk **OSS** (self-hosted hbbs/hbbr). Sem recursos do Pro (access control, OIDC, API de sessão).

### Princípios de design
- **Choke point = a senha do device.** É o único ponto onde dá pra impor política.
- **Quota é controle de uso justo / faturamento, NÃO fronteira dura** — uma senha compartilhável nunca será criptograficamente imponível. Aceitar isso e projetar em torno.
- **Defense-in-depth:** exigir credencial (approve-mode:password) + travar config + senha efêmera + detecção. Cada camada reduz blast-radius.
- **Falhar para "espera", nunca para "vazamento":** em dúvida, o pior caso aceitável é o técnico esperar/re-Conectar — nunca uma senha viva além da conta.

---

## 1. Modelo de ameaça (furos #1–#9)

Ancorado no código real (`main.go`, `rotate.go`, `create_access_grant`, `set_device_secret`).

| # | Furo | Mecanismo | Prevenível? | Tratamento na Fase 3 |
|---|---|---|---|---|
| 1 | **Senha compartilhada burla a quota** | senha permanente é *bearer*; gate conta emissão por `technician_id`, não conexões; relay `-k` público não distingue | ⚠️ parcial | §4.4 (detectar; OTP como evolução) |
| 2 | **Piggyback INVISÍVEL** | `processLine` só posta `start` no 1º `#N`; conectar durante sessão já aberta não gera novo `start` → sem flag "externo", sem contagem, e adia a rotação | ❌ hoje → ✅ | §4.5 (reporte por-`#N` + IP) |
| 3 | **Senha congela enquanto houver conexão aberta** | `go rotateNow()` só quando `len(open)==0`; sessão de 4,7h observada = senha estática por horas | ⚠️ | §4.2 + §4.4 |
| 4 | **`allow-remote-config-modification:Y` = escalada/persistência** | quem conecta 1x reconfigura remoto: seta senha própria, desliga rotação, volta approve-mode p/ click | ✅ | §4.1 (base) |
| 5 | **`password-click` = conectar só com "Aceitar"** | sem credencial alguma, qualquer um com o ID entra clicando Aceitar | ✅ | §4.1 (base) |
| 6 | **`agent_token` vazado = backdoor permanente** | admin local do endpoint lê o token e chama `rotate-device-secret` p/ setar senha conhecida | ⚠️ | §4.7 |
| 7 | **`super_admin` fura o gate** | `create_access_grant` isenta super_admin | ✅ | §4.6 (política de papéis) |
| 8 | **Deadlock de bootstrap** | approve-mode:password num device sem senha = inalcançável | ✅ | §4.1 + §4.3 (rotar no boot) |
| 9 | **Confiabilidade da rotação** | `--password` seta permanente é **ASSUNÇÃO** (comentada em rotate.go); agente offline não rotaciona | ⚠️ | §7 (validar em máquina real) |

**Destaque — furo #2 é o pior ponto cego:** a detecção de "acesso externo" só dispara quando uma sessão **começa** sem grant. Se o atacante conecta **enquanto** a sessão legítima está aberta, o agente enxerga como a *mesma* sessão — nenhum `start` novo, nenhuma flag, e ainda **adia a rotação** (regra do último close).

---

## 2. Casos de resiliência (R1, R2) — colidem com a rotação

O gatilho `end` serve segurança (rotacionar) **e** dispara os problemas de continuidade.

### R1 — Queda de poucos segundos
`#N closed` → `len(open)==0` → `end` → `rotateNow()`. Numa queda transitória:
1. **Reconexão quebra** — senha rotacionou; o client volta com a senha antiga → falha → re-Conectar pelo painel.
2. **Falso "acesso externo"** — grant fechou; reconexão sem grant → marcada como externa (técnico legítimo).
3. **Churn de quota** — grant fecha/reabre; grant velho ainda `active` → conta 2 contra a quota.
- Corrida: `rotateNow` leva ~1-3s; se o RustDesk reconectar antes, às vezes passa com a senha velha.

### R2 — Reinício do computador
- **(a) Endpoint reinicia:** senha permanente **sobrevive** ao reboot (fica na config do client); reboot mata a sessão **sem `end` limpo** → agente (também reiniciado) **não rotaciona** → a senha vista (e cópias compartilhadas, #1) **continua válida**. Grant fica `active` órfão até auto-close por heartbeat. **Conflito direto:** auto-reconectar exige que a senha sobreviva ao reboot — o oposto do efêmero.
- **(b) Máquina do técnico reinicia:** ele re-Conecta pelo painel; se o client cachear e auto-reconectar, cai no R1.

---

## 3. Decisão central: reconciliar efêmero × continuidade

A rotação some do gatilho instantâneo e passa a ter **duas guardas**:

### 3.1 Janela de carência (debounce) — enquanto o agente está vivo
Ao esvaziar `open` (`len(open)==0`): **não** rotacionar/fechar-grant na hora. Armar um timer (**default 60s**, tunável):
- Novo `#N` abre antes do timer → **cancela**: mesma sessão, senha inalterada, sem `end`, sem flag externa, sem churn de quota. ⇒ **auto-reconnect dentro da carência funciona** (senha não mudou). Resolve **R1** e o reconnect rápido.
- Timer estoura com sessão ainda fechada → aí sim `end` + `rotateNow()`. ⇒ efêmero preservado no regime normal.
- Custo: a senha vive ~carência a mais após uma desconexão real. Blast-radius pequeno e limitado.

### 3.2 Rotação no boot do agente — cobre o reboot (timer em memória não sobrevive a reboot)
No `worker()` (startup), assim que o client estiver acessível: **rotacionar 1x**, **exceto** se houver um **"hold de manutenção"** ativo (flag persistida, ver §4.3).
- Reboot **não planejado** → rotaciona no boot (fecha o furo "senha sobreviveu ao reboot", #8/R2a). Técnico re-Conecta.
- Reboot **planejado** (hold setado pelo operador) → **não** rotaciona → a sessão pode voltar sozinha dentro da janela do hold → rotaciona ao fim do hold.
- Subsume a Fase 3 "rotar 1x na matrícula" (a matrícula é o primeiro boot).

> Recomendação: **rotate-on-boot sempre, exceto sob hold** (simples e fail-secure). A "detecção de sessão suja" é otimização desnecessária.

---

## 4. Decisões de design (recomendadas)

### 4.1 Base — fechar #4 e #5 (PRIORIDADE MÁXIMA; sem isso o resto é teatro)
No `custom` do `build-client.yml` (hoje `{"approve-mode":"password-click","allow-remote-config-modification":"Y","allow-logon-screen-password":"Y"}`):
- `approve-mode` → **`"password"`** (exige senha; remove o bypass do "Aceitar").
- `allow-remote-config-modification` → **`"N"`** (impede reconfigurar o device por dentro de uma sessão).
- **Candidatos a travar** (confirmar ao ler o `build-client.yml` inteiro): `verification-method` → só senha permanente; desabilitar UI de "senha temporária" se não for usada; `allow-remote-restart`/troca de senha pelo peer.
- **Rebuildar o client** (workflow `build-client.yml`, ~48min) e **recompilar o instalador** (fluxo em `acessofast-installer-build-flow`).

⚠️ **Risco #1 — ✅ VALIDADO 2026-07-24 (não bloqueia):** `allow-remote-config-modification:"N"` **não** bloqueia o `AcessoFast.exe --password` local (SYSTEM). Testado via flip local do `custom_.txt` (override-settings) → N; a rotação real do agente gravou `device_secrets` sob N (`updated_by=null`) e um controlador autenticou com a senha setada. **A base (§4.1) segue como desenhada.** Detalhe no `HANDOFF.md` §7#1.

### 4.2 Rotação com janela de carência
Implementa §3.1 no agente (`main.go`/`rotate.go`): timer no último close, cancelável por novo `#N`. Mesmo debounce aplicado ao `end` que vai pro session-ingest (não fechar grant no piscar).

### 4.3 Política de reboot + hold de manutenção
- Rotate-on-boot (§3.2), suprimível por **hold**.
- **Hold de manutenção:** botão no painel ("vou reiniciar esta máquina") → grava um flag (via edge function → o agente lê no boot, ou um campo em `address_book`/tabela dedicada com `hold_until`). Janela limitada (ex.: 15min). Durante o hold: sem rotação no boot; a sessão pode voltar sozinha. Ao expirar: rotação.

### 4.4 Quota (#1/#3) — estratégia escolhida: **A) Detectar + responsabilizar** (agora); **C) OTP** (evolução futura)
- **Agora (A):** já que a senha bearer torna a prevenção frágil sob OSS, tornar o abuso **visível e atribuível** (ver §4.5). O gate de emissão continua como controle de uso justo; a rotação efêmera + base limitam o blast-radius de uma senha vazada à janela de uma sessão.
- **Futuro (C):** se a quota precisar virar fronteira dura, migrar pra **one-time password** com TTL curto — painel busca um OTP fresh do agente a cada Conectar (inverte o fluxo: client gera temp, agente lê e reporta; a propriedade one-time mata o compartilhamento). Requer patch no client fork + fluxo real-time (agente offline vira ponto de falha). **Fora do escopo imediato.**
- **B) Rotar-na-abertura** — descartado por ora: risco de quebrar canais extras (transferência de arquivo re-autentica noutro `#N`); só reconsiderar após validar o comportamento de canais do client.

### 4.5 Detecção de piggyback (#2) — a rede de segurança
- Agente passa a reportar **por-`#N`** (não só primeiro/último): cada open/close com o **IP do peer** (o log já traz: `#619 Connection opened from 189.4.111.147:12288`).
- Backend (`session-ingest` + correlação): se **nº de `#N` concorrentes > nº de grants ativos** do device, ou o **IP do peer não bate** com o IP de quem emitiu o grant → registrar/alertar "possível uso fora do painel / piggyback".
- Vale mesmo com a estratégia A e sobrevive a uma futura migração pra C.

### 4.6 Papéis (#7)
- Documentar/forçar: técnicos operacionais = `admin` ou abaixo (super_admin fura o gate por design). Revisar contas dos tenants reais (no ASP, `luiz`/`asp` são super_admin — ok pra dono, não pra operação).

### 4.7 `agent_token` (#6)
- ACL já é SYSTEM+Admins (`hardenDir`). Adicionar: **rotação do agent_token** (endpoint p/ regenerar) e considerar vincular o token a um device_id + detectar reuso anômalo. Prioridade menor (exige admin local do endpoint pra explorar).

---

## 5. Mudanças por componente (esboço — sem código ainda)

| Componente | Mudança | Furos/Casos |
|---|---|---|
| **Client build** (`build-client.yml`, repo acessofast-agent) | `custom`: approve-mode=password, allow-remote-config-modification=N, + settings travadas | #4, #5 |
| **Agente** (`main.go`/`rotate.go`) | (a) janela de carência no último close; (b) rotate-on-boot exceto hold; (c) reporte por-`#N` + IP do peer | #2, #3, #8, R1, R2 |
| **Edge / DB** (`session-ingest`, schema) | consumir eventos por-`#N`; correlação grants×conexões×IP; flag de piggyback; campo de `hold_until` | #1, #2, §4.3 |
| **Painel** (React) | botão "hold de manutenção"; superfície de alertas de uso-fora-do-painel; guidance de papéis | §4.3, §4.5, §4.6 |
| **Instalador** (`.iss`) | rebuild com client novo + agente novo (fluxo já conhecido) | — |

---

## 6. Sequência de implementação (faseada)

1. **Base (§4.1) + rotate-on-boot/enroll (§3.2)** — maior prioridade e independente do resto. **Bloqueado pela validação do Risco #1.**
2. **Janela de carência (§4.2)** no agente — resolve R1 e reboots curtos.
3. **Detecção por-`#N` + IP (§4.5)** — fecha o ponto cego #2; base pra qualquer política de quota.
4. **Hold de manutenção (§4.3)** — painel + agente + campo no banco.
5. **Validações em máquina real (§7)** — algumas são pré-requisito da etapa 1.
6. *(futuro)* **OTP (§4.4 C)** se a quota precisar virar fronteira dura.

---

## 7. A VALIDAR em máquina real (perguntas abertas — bloqueiam decisões)

1. **[BLOQUEANTE]** `allow-remote-config-modification:"N"` bloqueia o `AcessoFast.exe --password` **local** do agente? (Se sim, a base quebra a rotação — redesenhar.)
2. `AcessoFast.exe --password <pw>` seta senha **permanente** que **persiste no reboot**? (ASSUNÇÃO em rotate.go.)
3. O RustDesk **absorve** um blip de poucos segundos sem gerar `#N closed/opened`? (Define o tamanho do R1.)
4. `approve-mode:password` permite **múltiplas** conexões simultâneas com a mesma senha permanente? (Define se a quota é sequer parcialmente imponível.)
5. Comportamento de **canais extras** (transferência de arquivo): abrem `#N` separado e re-autenticam? (Define viabilidade da opção B.)
6. `--password` local ainda funciona com `verification-method` só-permanente e demais travas.

---

## 8. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Trava de config bloquear a rotação do agente → device inalcançável | Validação #1 antes de rollout; rollout canário numa máquina só |
| Lockout (painel serve senha velha) numa falha de report | `rotate.go` já aplica-antes-de-reportar + retry loop; carência reduz janela |
| Deadlock bootstrap (device novo sem senha) | rotate-on-boot/enroll (§3.2) |
| Senha vive durante a carência | janela curta (60s) e limitada; aceitável vs. o ganho de continuidade |
| Piggyback residual (janela de carência / OTP não adotado) | detecção §4.5 torna visível e atribuível |

---

## 9. Decisões em aberto (defaults recomendados — Luiz pode sobrescrever)

| Decisão | Default recomendado | Alternativa |
|---|---|---|
| Reboot do endpoint | **Continuidade via carência + hold**; rotate-on-boot fora do hold | Segurança-primeiro: sempre rotaciona no boot, técnico sempre re-Conecta |
| Janela de carência | **60s** | 30s (mais seguro) / 90s (mais tolerante) |
| "Reconexão automática" (o que é) | **retomar a sessão do técnico** dentro do hold; endpoint-ficar-acessível já é padrão do serviço | esclarecer se é só reachability |
| Estratégia de quota | **A (detectar) agora**, C (OTP) futuro | C agora (mais trabalho) |
| Hold de manutenção | janela **15min** | tunável por tenant |

> Próximo passo sugerido: rodar as validações **§7 #1–#4** na sua máquina (é rápido e destrava a etapa 1). Depois eu preparo o diff do `build-client.yml` + o patch do agente conforme este doc.
