# HANDOFF — AcessoFast (continuar na próxima sessão)

> **Sessão 2026-08-07.** Estado: **Passo 1 da atualização de frota** (reporte da versão do agente)
> **commitado em branch nos dois repos e verificado localmente — NÃO mergeado, NÃO deployado.**
> **Retomar em:** o deploy, na ordem do §3. A ordem é obrigatória e o motivo está lá.
> Substitui o handoff anterior (Fase 3 — validações §7 concluídas). A Fase 3 segue aberta:
> virou **frente pausada no §8 deste arquivo**, com o estado do canary preservado.

---

## 1. ⚠️ Regras de ambiente — LER PRIMEIRO

1. **PRIMEIRO comando: `get_project_url`.** Tem que ser **`plmfyibyrowbgjjyblcl`**. Se vier
   `ygevmtqzainzcjrqxenr` (é o `Supa_Hiper`, projeto **DIFERENTE**) → **PARE**.
2. Usar o MCP **`supabase-acessofast`**. **NÃO** usar `claude.ai Supa Hiper`.
3. Schema vivo está à frente das migrations locais; fonte de verdade local = `src/integrations/supabase/types.ts`.
   Deploy de edge function via MCP.
4. Repos: **painel** = este · **agente** = `github.com/ASPaes/acessofast-agent`.
   **Instalador** (fora do repo): `C:\Users\Usuario\Downloads\AcessoFast-Installer-…\AcessoFast-Installer\`
   (ISCC em `C:\Program Files (x86)\Inno Setup 6\`).
5. **⚠️ Descoberto nesta sessão:** existe uma cópia de `supabase/functions/session-ingest/index.ts`
   **no repo do agente** que está **desatualizada e não é a que roda** (não tem auto-adoção, nem
   `hard_cap_at`/billing B6, nem `meter_external_session`). **A fonte da verdade é a deste repo.**

---

## 2. 📍 Onde os repos estão AGORA

| Repo | Branch atual | Commit | Estado |
|---|---|---|---|
| painel (este) | `feat/agent-version-visibilidade-frota` | `cc2e5f4` | pushed · working tree limpo |
| agente | `feat/agent-version-reporte` | `3eaadc9` | pushed · working tree limpo |

- **`main` intacta nos dois:** painel em `73dbb58`, agente em `6203f3a` — os mesmos SHAs de antes da sessão.
- **Nenhum PR aberto. Nada mergeado.**
- ⚠️ O clone local do agente estava na branch `fase2-senha-efemera`, **25 commits atrás** do `origin/main`
  (o `main.go` de lá nem lia `hard_cap_at`). Foi movido para o `main` atualizado. **Não voltar para aquela branch.**

---

## 3. 🎯 TAREFA — deploy do Passo 1, NESTA ORDEM

### Passo 3.1 — Migration (PRIMEIRO, não negociável)

`supabase/migrations/20260807120000_address_book_agent_version.sql` → aplicar via MCP `apply_migration`.

**Por que primeiro, concretamente:** `last_online` e `agent_version` viajam no **mesmo `UPDATE`** dentro
da `session-ingest`.

- **Function antes da coluna** → o statement falha inteiro, `last_online` para de ser carimbado e
  **a frota inteira aparece Offline no painel.** Sintoma dramático, causa nada óbvia.
- **Painel antes da coluna** → o `select` com `agent_version` vira **400 do PostgREST** e a
  **página de Dispositivos inteira** para de carregar, não só a coluna nova.

Na ordem certa cada etapa é compatível com a anterior — a coluna sozinha não incomoda ninguém.

### Passo 3.2 — Edge function

`deploy_edge_function` da `session-ingest` (`verify_jwt=false` já está no `config.toml`).

### Passo 3.3 — Painel

Merge de `feat/agent-version-visibilidade-frota` na `main` (o Lovable sincroniza a partir daí).

### Passo 3.4 — Agente

Merge de `feat/agent-version-reporte`. O push na `main` dispara o `build-agent.yml` sozinho
(o filtro de paths cobre `main.go`) → ~1 min → artifact `acessofast-agent-windows-x64`
com a versão `AAAA.MM.DD-<sha7>` embutida via ldflags.

### Verificação

```sql
select alias, rustdesk_id, os, agent_version, last_online
from address_book order by last_online desc nulls last limit 20;
```

Uma máquina ligada carimba `agent_version` em **≤ 60s** (no `presence` ocioso).
**Esperado antes do rollout do agente: `agent_version` null em tudo.** Isso **não é bug** — é
exatamente a lista de quem falta atualizar.

---

## 4. ⚠️ Duas branches suas colidem — e mergeiam LIMPO (o git não vai avisar)

1. **`app-acessofast/redesign-fase2`** (+1 commit, 2026-07-31, não mergeada) adiciona
   `isMobileOs(os)` em `dispositivos.tsx` praticamente no mesmo ponto onde a minha branch adiciona
   `plataformaDe(os)`. Mesma lógica (`/android/i`), dois nomes. Ao mergear as duas:
   **absorver `plataformaDe` em `isMobileOs`** (o comentário dela é melhor e já é usada no modal de conexão).

2. **`acessofast-agent/feat/mobile-acesso-desassistido`** (+2 commits, não mergeada) adiciona um passo
   `flutter build appbundle` (.aab para a Play Store) que **não tem o `--dart-define=ACESSOFAST_VERSION`**
   que a minha branch pôs no passo do `.apk`. Como está, **o bundle publicado na Play Store reportaria
   versão `dev`** e todo aparelho instalado por ali apareceria como "desconhecida" — justamente o buraco
   que o Passo 1 existe para fechar. Uma linha resolve, depois que uma das duas mergear.

---

## 5. ✅ Já verificado nesta sessão — não precisa refazer

- **Agente:** `go vet` + cross-compile Windows OK; confirmado que a string de versão **entra no binário** via ldflags.
- **Painel:** `tsc --noEmit` limpo; `npm run build` passou. (Não havia `node_modules`; foi instalado.
  O `routeTree.gen.ts` regerado foi revertido e o `package-lock.json` do npm removido — o projeto usa bun.)
- **Merge-tree** das duas colisões do §4: **sem conflito textual** nos dois casos.
- **`main` não andou** em nenhum dos dois repos desde a base; **nenhum PR aberto**; nada pendente do
  **LuizHansen** (a branch `Luiz` não existe mais no remoto; todas as outras branches remotas estão
  com 0 commits à frente da main).
- Conferido hunk a hunk que as mudanças no working tree eram **só as minhas**.

---

## 6. O que o Passo 1 entrega

- `address_book.agent_version`, gravado pela `session-ingest` **de carona** no update de `last_online`
  que já acontecia a cada sinal → **zero requisição a mais**. Só sobrescreve quando o agente informa
  (agente antigo não apaga o que já se sabia).
- **Sem grant de escrita ao `authenticated`**: os grants de insert/update do `address_book` são
  **por coluna** e enumeram o que o usuário edita; ficar de fora é o que impede o painel de **forjar**
  a versão de um dispositivo (mesmo tratamento do `agent_token_hash`).
- Agente Windows (`-X main.version`) e mobile (`--dart-define`) reportam no formato **`AAAA.MM.DD-<sha7>`**:
  data primeiro e em largura fixa **de propósito** — o painel ordena builds comparando string, sem semver.
  Build local sai `dev` → tratado como desconhecida.
- Coluna **"Agente"** em `dispositivos.tsx` (tabela + cards), comparada **por plataforma**. Windows e
  Android têm cadências de build diferentes; no mesmo balde todo Android ficaria eternamente amarelo
  e a coluna viraria ruído ignorável.

---

## 7. Passos 2 e 3 — desenhados, não implementados

Detalhe completo em **`ATUALIZACAO-FROTA.md`** (raiz) · artifact visual:
https://claude.ai/code/artifact/1ebfa550-fb78-4a3f-bdfe-976c07c802f2

- **Passo 2 — auto-update do agente.** A `session-ingest` responde `{update:{version,url,sha256}}`;
  o agente só age em `presence` (máquina ociosa), baixa, confere, **renomeia** o próprio `.exe` → `.old`
  (no Windows um serviço não *sobrescreve* o binário em uso, mas *renomeia*), grava o novo e reinicia
  via `schtasks`. Versão-alvo em cascata **device → tenant → global** (é isso que dá o rollout escalonado).
- **Dois bloqueios antes de ligar:** (a) o CI só publica *artifact* — exige auth e expira em 30 dias;
  precisa virar Release ou bucket; (b) assinatura Authenticode — o `sha256` vem do mesmo servidor que o
  arquivo, então não protege contra servidor comprometido.
- **Bootstrap inescapável:** o auto-update só existe numa máquina depois de uma última rodada manual do
  instalador — ~50 sessões remotas pelo próprio AcessoFast.
- **Passo 3 (cliente/MSI):** baixa prioridade; boa parte do que parece "atualizar o cliente" é config.

---

## 8. ⏸️ Frente PAUSADA — Fase 3 (controle de acesso)

Design completo em **`FASE3-DESIGN.md`** · artifact:
https://claude.ai/code/artifact/ac9306ca-d639-4a1c-bc3d-56b6114e6d7d

**Estado:** Fase 1 (quota) e Fase 2 (senha efêmera) **deployadas e validadas em produção**.
Fase 3 **desenhada, não implementada** — as 4 validações §7 já foram **todas concluídas em 2026-07-24**:

1. **[era bloqueante] ✅** `allow-remote-config-modification:"N"` **não** bloqueia o `--password` local do
   agente → a base §4.1 é viável como desenhada.
2. **✅** A senha permanente **persiste no reboot**; o agente Fase 2 **não** faz rotate-on-boot (é feature
   da Fase 3) → sem ele, senha vazada segue válida pós-reboot (§3.2 fecha).
3. **✅** RustDesk **não** absorve blip curto: 6s derrubaram a conexão **e** rotacionaram a senha →
   a **janela de carência (§3.1, default 60s) é necessária**.
4. **✅** `approve-mode:password` **permite** conexões simultâneas com a mesma senha → **a senha é bearer;
   quota não é imponível pela senha** (confirma o furo #1). Quota vira uso-justo/faturamento + detecção (§4.4-A).

**Implementar quando retomar** (`FASE3-DESIGN.md` §5–§6): base no `build-client.yml` (rebuild ~48min +
recompilar instalador) · carência 60s + rotate-on-boot + reporte por-`#N`/IP no agente · detecção
piggyback no `session-ingest` · hold de manutenção. Decisões pendentes de confirmação do Luiz (§9):
continuidade vs segurança-primeiro no reboot · carência 60s · hold 15min · quota estratégia **A**.

### ⚠️ Estado da máquina de teste (canary) — NÃO ESQUECER

Desde 2026-07-24 o `custom_.txt` do device de teste (`rustdesk_id 51200651`) está com a
**base §4.1 completa: `approve-mode:"password"` + `allow-remote-config-modification:"N"`**.
**Diverge do build shipado** (`password-click`/`Y`). Backup em `C:\Program Files\AcessoFast\custom_.txt.bak-Y`.

```powershell
# rollback do canary
Copy-Item 'C:\Program Files\AcessoFast\custom_.txt.bak-Y' 'C:\Program Files\AcessoFast\custom_.txt' -Force
Restart-Service AcessoFast,AcessoFastAgent -Force
```

### Dados de referência (device/tenant de teste)

- Device: `id 27ef8ea6-24a0-4642-9429-9bffb70a9d2c`, `rustdesk_id 51200651`,
  tenant **ASP** `ebd17e4e-d158-4164-a235-e8fd53cbf895`.
- Tenant ASP: `max_concurrent_per_tech=null` (ilimitado), `billing_exempt=true`.
- Papéis: `luizhansen751@gmail.com` e `asp@…` = **super_admin** (furam o gate).
  `suporte4@aspsoftwares.com.br` = **admin** → **usar este para testar quota**.
- Secret vive em `private.device_secrets` (upsert 1 linha/device). "Grant" = linha `active` em
  `public.connection_logs`. Gate = `create_access_grant` conta `active` por `technician_id`.
- Furos abertos priorizados: **#1** (senha compartilhada burla quota — bearer, não imponível sob
  OSS + `-k` público) e **#2** (piggyback invisível).

---

## 9. Memórias relacionadas

`acessofast-plano-atualizacao-frota` · `acessofast-agent-repo` · `acessofast-access-control-plan` ·
`supabase-project-refs` · `acessofast-git-lovable` · `validate-partner-before-merge`
