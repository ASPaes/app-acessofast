# HANDOFF — AcessoFast (continuar na próxima sessão)

> **Sessão 2026-08-10.** Estado: **Passo 1 da atualização de frota DEPLOYADO** (§3) e as
> **duas branches que colidiam já mergeadas e reconciliadas** (§4). Não há mais nada pendente
> de merge em nenhum dos dois repos.
> O **Passo 2 (auto-update) está com o código pronto e commitado nos dois repos, NÃO deployado** — §7.
> **Retomar em:** o **§7.2**, que lista o que falta para ligar, na ordem. O primeiro item é criar o
> secret da chave de assinatura. A Fase 3 segue **pausada no §8**, com o canary preservado.

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

| Repo | `main` em | Como chegou lá (nesta sessão) |
|---|---|---|
| painel (este) | `6d1b9c4` | `73dbb58` → ff `feat/agent-version-visibilidade-frota` → merge `redesign-fase2` (§4) |
| agente | `3205f1e` | `6203f3a` → ff `feat/agent-version-reporte` → merge `feat/mobile-acesso-desassistido` (§4) |

**Nada pendente de merge:** todas as branches remotas dos dois repos estão com 0 commits à
frente da `main`. As quatro branches mergeadas podem ser apagadas quando quiser.

- ⚠️ O clone local do agente (`C:\ProjetoAcessoFast\acessofast-agent-repo`) já esteve na branch
  `fase2-senha-efemera`, **25 commits atrás** do `origin/main` (o `main.go` de lá nem lia
  `hard_cap_at`). **Não voltar para aquela branch.** Há um `acessofast-agent.exe` untracked
  no clone — sobra do cross-compile de teste, não é pra commitar.

---

## 3. ✅ CONCLUÍDO — deploy do Passo 1 (2026-08-10)

As quatro etapas rodaram na ordem abaixo, cada uma verificada antes da seguinte. Fica registrado
porque **o Passo 2 vai repetir exatamente esta sequência** (migration → function → clientes).

### Passo 3.1 — Migration ✅

`supabase/migrations/20260807120000_address_book_agent_version.sql`, aplicada via `apply_migration`.
Conferido depois: `agent_version text`, nullable, com o `comment` no lugar.

**Por que primeiro, concretamente:** `last_online` e `agent_version` viajam no **mesmo `UPDATE`** dentro
da `session-ingest`.

- **Function antes da coluna** → o statement falha inteiro, `last_online` para de ser carimbado e
  **a frota inteira aparece Offline no painel.** Sintoma dramático, causa nada óbvia.
- **Painel antes da coluna** → o `select` com `agent_version` vira **400 do PostgREST** e a
  **página de Dispositivos inteira** para de carregar, não só a coluna nova.

Na ordem certa cada etapa é compatível com a anterior — a coluna sozinha não incomoda ninguém.

### Passo 3.2 — Edge function ✅

`session-ingest` **v48 → v49**, `verify_jwt=false` preservado.

Antes de sobrescrever, a v48 em produção foi baixada com `get_edge_function` e comparada com a
`main`: **idêntica**. Vale repetir isso sempre — `deploy_edge_function` substitui a função inteira,
então qualquer hotfix aplicado direto pelo dashboard seria descartado em silêncio.

### Passo 3.3 — Painel ✅

`main` do painel em `4ce7ebd` (o Lovable sincroniza a partir daí).

### Passo 3.4 — Agente ✅

`main` do agente em `3eaadc9`. O push disparou o `build-agent.yml` (tocou `main.go` **e** o próprio
workflow, os dois no filtro de paths) → artifact `acessofast-agent-windows-x64` com a versão
`AAAA.MM.DD-<sha7>` embutida via ldflags.
**Não conferido nesta sessão:** o resultado do run. Não há `gh` na máquina e o MCP do GitHub não
expõe workflow runs — olhar em https://github.com/ASPaes/acessofast-agent/actions.

### Verificação ✅

```sql
select alias, rustdesk_id, os, agent_version, last_online
from address_book order by last_online desc nulls last limit 20;
```

Pós-deploy: **86 devices, 58 online, 0 com `agent_version`** — e o `last_online` continuou sendo
carimbado com menos de 1s de atraso, que é a prova de que a v49 não regrediu a presença.

Uma máquina ligada carimba `agent_version` em **≤ 60s** (no `presence` ocioso), mas só depois de
receber o agente novo. **`agent_version` null em tudo não é bug** — é exatamente a lista de quem
falta atualizar, e ela só encolhe com o bootstrap manual descrito no §7.

---

## 4. ✅ RESOLVIDO — as duas branches que mergeavam LIMPO sem estar certas

Ambas mergeadas em 2026-08-10 **com reconciliação manual**. O git não apontou conflito em
nenhuma das duas — era esse o risco, e é por isso que ficam registradas aqui.

1. **`app-acessofast/redesign-fase2`** → painel `6d1b9c4`.
   Duas funções nascidas em paralelo faziam a **mesma pergunta com retornos diferentes**:
   `isMobileOs(os) -> boolean` (ícone da lista, aviso do modal) e
   `plataformaDe(os) -> "android"|"windows"` (balde da coluna Agente). Agora `plataformaDe`
   **delega** a `isMobileOs`, que virou o único lugar onde a regra mora.
   Ficou o teste `/android/i` no lugar do `startsWith("android")`: o agente mobile grava
   `os = "Android <versao>"` (`_osString` em `mobile/agent.dart`), então os dois casam nos dados
   reais e a regex é só mais tolerante. `tsc --noEmit` limpo e `vite build` OK depois.
   **Se tivessem ficado as duas cópias**, elas divergiriam em silêncio no pior formato: a lista
   mostrando ícone de celular enquanto a coluna Agente compara o aparelho contra builds de
   Windows, marcando de desatualizado quem está em dia.

2. **`acessofast-agent/feat/mobile-acesso-desassistido`** → agente `3205f1e`.
   O step `flutter build appbundle` não tinha o `--dart-define=ACESSOFAST_VERSION`, então o
   bundle da Play Store sairia `dev` (o `session.dart` lê com
   `String.fromEnvironment(..., defaultValue: 'dev')`).
   Resolvido com um detalhe a mais do que "uma linha": o `AGENT_VERSION` era variável **local**
   do shell do step do APK, invisível no step do AAB. O APK agora exporta via `GITHUB_ENV` e o
   AAB reutiliza — recalcular lá seria uma segunda cópia do formato, livre pra divergir, e com
   data diferente num build que cruzasse a meia-noite UTC. O AAB **falha explicitamente** se o
   valor vier vazio.
   ⚠️ **Ainda não exercitado:** o `.aab` só é gerado com o input `gerar_aab` marcado num
   `workflow_dispatch` do `build-client-android.yml` (~48 min). Nenhum run foi feito nesta
   sessão, e não há flutter/dart local — o Dart mergeado **não foi compilado**.

---

## 5. ✅ Já verificado — não precisa refazer

Da sessão de 2026-08-07 (pré-deploy):

- **Agente:** `go vet` + cross-compile Windows OK; confirmado que a string de versão **entra no binário** via ldflags.
- **Painel:** `tsc --noEmit` limpo; `npm run build` passou. (Não havia `node_modules`; foi instalado.
  O `routeTree.gen.ts` regerado foi revertido e o `package-lock.json` do npm removido — o projeto usa bun.)
- Conferido hunk a hunk que as mudanças no working tree eram **só as minhas**.

Da sessão do deploy (2026-08-10):

- Os merges do Passo 1 foram **fast-forward** — `origin/main` não tinha andado em nenhum repo.
- Produção conferida depois de cada etapa (coluna, v49, presença carimbando, baseline 86/58/0).
- **Auditoria de trabalho de terceiros** (`git log --remotes --not origin/main`, que varre todas
  as branches remotas): antes dos merges do §4 existiam **3 commits fora da `main` nos dois repos
  somados, todos autorados por ASPaes** — os do §4. **Todos os 30 commits do LuizHansen no painel
  e os 9 no agente já estavam na `main`**, então não havia nada dele em risco. Nenhum PR aberto
  em nenhum dos dois repos.
- ⚠️ **Correção de um handoff anterior:** ele afirmava que *"a branch `Luiz` não existe mais no
  remoto"*. **Existe** (`b67ba30`, no painel). Não muda a conclusão — o tip dela é ancestral da
  `main`, ou seja, está inteiramente contida e não tem nada exclusivo. Mas não repetir a frase.

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

## 7. Passo 2 — CÓDIGO PRONTO, não deployado · Passo 3 não implementado

Detalhe do desenho em **`ATUALIZACAO-FROTA.md`** (raiz) · artifact visual:
https://claude.ai/code/artifact/1ebfa550-fb78-4a3f-bdfe-976c07c802f2

### 7.1 O que já está commitado (2026-08-12)

| Onde | Commit | O quê |
|---|---|---|
| painel | `b83adbe` | migration `20260812120000_agent_auto_update.sql` + `session-ingest` responde `update` |
| agente | `f92d8aa` | `update.go`, `tools/sign-manifest`, Release assinado no `build-agent.yml` |

**Os dois bloqueios do desenho original foram resolvidos:**

- **(a) Hospedagem** — os três repos são **públicos**, então um GitHub Release baixa anonimamente,
  não expira e não custa nada. O `build-agent.yml` publica um Release por build da `main`.
  O *artifact* continua existindo, para o fluxo manual do instalador.
- **(b) Assinatura** — **sem Authenticode.** O par `(version, sha256)` é assinado com **Ed25519**;
  a privada vive só num GitHub Actions secret e a pública é constante no fonte do agente. Comprometer
  o banco **ou** o Release não basta para forjar um update aceito. Resolve a ameaça que importa sem
  certificado (~US$200-400/ano + validação demorada).
  A **URL fica fora** da assinatura de propósito: se a assinatura cobre o hash, trocar a URL não serve
  de nada — e deixá-la de fora permite mudar de hospedagem sem reassinar release antigo.

### 7.2 ⚠️ O que FALTA para ligar — nesta ordem

1. **Criar o secret `AGENT_UPDATE_SIGNING_KEY`** no repo do agente (Settings → Secrets → Actions).
   A privada foi gerada em 2026-08-12 e **nunca foi impressa nem commitada** — está só no arquivo
   de scratchpad daquela sessão. **Se ele já sumiu, gerar um par novo e trocar a `updatePubKeyB64`
   em `update.go`.** Pública atual: `IADLOND+FJeXkthXym/2AoPr6/336ITnC3TvOD1hGQs=`.
   Sem o secret o passo de Release é **pulado com warning** — não quebra o build.
2. **Aplicar a migration** e **deployar a `session-ingest`** (nesta ordem, mesma razão do §3).
3. **Rodar o `build-agent.yml`** e catalogar o release: o SQL de `insert into agent_releases` sai
   pronto no **resumo do job**.
4. **Canary:** `update address_book set agent_target_version = '<v>' where rustdesk_id = '<id>'`.
   Conferir a coluna Agente no painel **antes** de tocar em tenant ou global.

### 7.3 O que NÃO foi exercitado

- **A troca de binário e o restart nunca rodaram em máquina real.** É o trecho de maior risco do
  Passo 2: entre renomear o `.exe` e gravar o novo há uma janela em que o serviço fica sem binário.
  Há restauração explícita do `.old`, mas isso é código não exercitado — testar no canary primeiro.
- O `agendaRestart` **não agenda na virada do dia** (o formato de `/sd` do `schtasks` segue o locale
  do Windows e errar isso agendaria para a data errada em silêncio). Nesse caso ele só adia: o próximo
  `presence` tenta de novo. Falhar aqui não é grave — o binário novo **já está no lugar** e sobe no
  próximo boot.
- A edge function **não foi type-checada** contra os tipos do Deno (não instalado); só a sintaxe.

### 7.4 Ainda vale

- **Bootstrap inescapável:** o auto-update só existe numa máquina depois de uma última rodada manual
  do instalador — ~50 sessões remotas pelo próprio AcessoFast. **Essa rodada agora deve levar o agente
  COM auto-update**, senão será preciso repetir as 50 máquinas depois.
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
