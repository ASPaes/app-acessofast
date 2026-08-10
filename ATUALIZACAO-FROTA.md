# Atualização da frota — fluxo de ponta a ponta

> Problema de origem: ~50 endpoints em produção. Cada instalador novo torna os anteriores
> obsoletos, e reinstalar máquina a máquina é inviável.
>
> Leitura prévia: `HANDOFF.md`. Repos envolvidos: **painel** = este · **agente** =
> `github.com/ASPaes/acessofast-agent`.

---

## 1. Os três artefatos (por que não existe "um" update)

| Artefato | Onde nasce | Custo do build | Muda com que frequência |
|---|---|---|---|
| `acessofast-agent.exe` | `build-agent.yml` (repo do agente) | ~1 min | Toda semana — é onde vive Fase 2/3 |
| Configs do cliente (`custom.txt`, `.toml`) | — | — | Eventual (**não exige reinstalar nada**) |
| `AcessoFast.exe` / `.msi` (RustDesk branded) | `build-client.yml` | ~48 min | Raro |
| APK Android | `build-client-android.yml` (`workflow_dispatch`, pede a tag do RustDesk) | longo | Raro |

O retrabalho que dói é o **agente**: binário único, sem instalador próprio, já roda como SYSTEM.
É o caso mais simples possível de auto-update — e é por isso que ele vem primeiro.

---

## 2. Passo 1 (feito) — deploy: a ordem NÃO é negociável

O Passo 1 é a coluna `agent_version`. As três peças precisam subir **nesta ordem**, porque
duas das inversões possíveis quebram produção de forma bem visível:

### 2.1 Migration primeiro — sempre

```
supabase/migrations/20260807120000_address_book_agent_version.sql
```

Aplicar via MCP `supabase-acessofast` (project ref `plmfyibyrowbgjjyblcl`), CLI (`supabase db push`)
ou dashboard. **Não assuma que o arquivo no repo se aplica sozinho** — o schema vivo já está à
frente das migrations locais, sinal de que muita coisa foi aplicada por fora.

Por que primeiro, concretamente:

- **Se a edge function subir antes da coluna:** o `update({ last_online, agent_version })` passa a
  falhar em *todo* sinal de agente. `last_online` para de ser carimbado → **a frota inteira aparece
  Offline no painel** (o `presence` ainda devolve 500 explícito). Sintoma dramático, causa nada óbvia.
- **Se o painel subir antes da coluna:** o `select(..., agent_version, ...)` vira erro 400 do
  PostgREST para a query inteira → **a página de Dispositivos para de carregar**, não só a coluna nova.

Na ordem certa, cada etapa é compatível com a anterior: a coluna sozinha não incomoda ninguém.

### 2.2 Edge function + painel

- `supabase/functions/session-ingest/index.ts` → deploy da function.
- Painel → push na branch conectada; o Lovable sincroniza e publica.

⚠️ A cópia de `session-ingest/index.ts` que existe no **repo do agente** está desatualizada e **não é
a que roda**. A fonte da verdade é a deste repo.

Nesse ponto a coluna "Agente" já aparece — com todas as máquinas em **"desconhecida"**. Isso é o
resultado esperado, não uma falha: é literalmente a lista de quem falta atualizar.

### 2.3 Agente

Push no `main` do repo do agente → `build-agent.yml` dispara sozinho (o filtro de paths cobre
`main.go` e o próprio workflow) → em ~1 min sai o artifact `acessofast-agent-windows-x64`, com a
versão `AAAA.MM.DD-<sha7>` embutida via ldflags.

Cada máquina que receber esse binário passa a se declarar em ≤ 60s (no `presence` ocioso).

---

## 3. O fluxo de hoje (semi-manual) — e o bootstrap

Enquanto o Passo 2 não existe, atualizar continua sendo:

```
commit → build-agent.yml → baixar o artifact → trocar o .exe no payload\
       → recompilar o instalador (.iss, Inno Setup) → rodar em cada máquina
```

Com uma diferença que já vale bastante: **agora dá pra saber em quais máquinas rodar.** A coluna
"Agente" mostra a data do build e pinta de amarelo quem está atrás da própria plataforma.

**O bootstrap é inescapável.** O auto-update só existe numa máquina depois que ela recebe, uma última
vez pela via manual, um agente que saiba se atualizar. São ~50 sessões remotas pelo próprio
AcessoFast — não 50 visitas presenciais. Essa é a última rodada manual; depois dela, nunca mais.

---

## 4. Passo 2 — como o auto-update vai funcionar

### 4.1 O canal (já existe)

O agente já faz POST autenticado à `session-ingest` a cada 60s (`presence`) ou 20s (`heartbeat`), e
**já lê a resposta** — é assim que o `hard_cap_at` do billing chega nele. Não precisa de porta aberta,
VPN nem RMM. Falta só mais um campo na resposta.

```jsonc
// requisição (já é assim hoje, com o agent_version do Passo 1)
{ "rustdesk_id": "…", "agent_token": "…", "event": "presence", "agent_version": "2026.08.07-a1b2c3d" }

// resposta — 'update' só aparece quando há versão-alvo mais nova que a do device
{ "ok": true, "action": "presence",
  "update": { "version": "2026.08.14-9f2c1a0",
              "url": "https://…/acessofast-agent.exe",
              "sha256": "…" } }
```

### 4.2 Quem decide a versão-alvo

Uma tabela `agent_releases` (`version`, `url`, `sha256`, `notes`) mais um alvo resolvido em cascata:

```
address_book.agent_target_version  (device)   ← vence
  └─ tenant                                    ← depois
       └─ global                               ← default
```

**É essa cascata que dá o rollout escalonado**: fixa numa máquina → observa a coluna "Agente" →
libera para um tenant → libera global. Sem isso, um agente ruim vai para 50 máquinas de uma vez,
elas ficam cegas, e você perde justamente a telemetria que usaria para descobrir o que houve.

### 4.3 O que o agente faz ao receber `update`

1. **Só age em `presence`** (máquina ociosa). Nunca no meio de um atendimento.
2. Baixa para `C:\ProgramData\AcessoFast\update\` e confere o `sha256`.
3. **Renomeia** `acessofast-agent.exe` → `.old`. Esse é o pulo do gato: no Windows um serviço não
   consegue *sobrescrever* o próprio `.exe` em execução, mas **consegue renomeá-lo** — o caminho
   original fica livre para receber o binário novo.
4. Escreve o novo no caminho original.
5. Agenda o restart via `schtasks` (o serviço não se reinicia sozinho enquanto está parando).
6. Sobe na versão nova e se declara no `presence` seguinte — que é como você confirma que deu certo.

Sem segundo serviço, sem instalador, sem interação do usuário na ponta.

### 4.4 Duas coisas que precisam existir antes de ligar isso

- **Onde o binário mora.** Hoje o CI só publica um *artifact*: exige autenticação e expira em 30 dias
  — o agente não consegue baixar. Precisa virar GitHub Release ou bucket público.
- **Assinatura.** Conferir só o `sha256` protege contra download corrompido, não contra o servidor
  comprometido — o hash vem do mesmo lugar que o arquivo. Como isso é software de **acesso remoto**
  em máquinas de cliente, o canal de update é o alvo mais valioso do produto inteiro: um update
  forjado é controle total de 50 máquinas. Assinar o agente e validar Authenticode antes da troca é
  o que fecha isso de verdade (e mata o aviso do SmartScreen de quebra).

### 4.5 Sobre rollback — sendo honesto

Guardar o `.old` cobre o caso de o binário novo subir e se comportar mal. **Não cobre** o caso pior:
o agente novo não sobe. Aí ele não pede nada ao servidor, e reverter o alvo no painel não alcança
aquela máquina — só sessão remota resolve.

Ou seja: o rollback real é o **rollout escalonado**, não o `.old`. Um agente quebrado descoberto na
primeira máquina custa uma sessão remota; descoberto em produção inteira custa 50.

---

## 5. Passo 3 — cliente e Android

- **Configs primeiro.** Boa parte do que parece "atualizar o cliente" é config (`approve-mode`,
  `allow-remote-config-modification`, o `custom_.txt`), e já foi provado que dá pra aplicar
  localmente sem reinstalar nada. O agente roda como SYSTEM e já executa `AcessoFast.exe --password`.
- **Binário do cliente:** o build já produz `AcessoFast.msi` → `msiexec /qn` pelo mesmo canal.
  Mesmo mecanismo do Passo 2, só um comando diferente. Prioridade baixa: o cliente muda pouco.
- **Android:** o APK é `workflow_dispatch` e pede a tag do RustDesk — é um build deliberado, não
  contínuo. Por isso o painel compara versões **por plataforma**: no mesmo balde que o Windows, todo
  aparelho Android ficaria permanentemente amarelo e a coluna viraria ruído ignorável.
