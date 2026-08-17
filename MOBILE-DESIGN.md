# MOBILE-DESIGN — AcessoFast Android (agente embutido)

> **Sessão 2026-07-31.** Estado: **DESIGN / planejamento — nada implementado.**
> Escopo decidido pelo Ryan: **agente embutido** (paridade com o Windows), não a versão "leve".
> Precede qualquer mudança no `build-client.yml`, no fork do RustDesk ou no painel.
>
> Repos envolvidos: **painel** = este repo · **client/agente** = `github.com/ASPaes/acessofast-agent`
> (clonado localmente em `../acessofast-agent-repo` nesta sessão).

---

## 1. Objetivo

Levar o AcessoFast para Android, com o celular funcionando como **endpoint controlado** —
aparecendo no painel de Dispositivos e conectando pelo mesmo botão "Conectar" que já existe.

Não é escopo aqui: maquininha Stone (descartado nesta sessão — ver §8), nem o app do técnico
como controlador (que é subconjunto trivial disto).

---

## 2. O que foi VERIFICADO (não deduzido)

Cada item abaixo foi conferido no código/infra real nesta sessão. É o que já está pronto e não
precisa ser construído.

### 2.1 Backend: 100% pronto, zero trabalho

Todos os endpoints que o agente Windows usa **já estão deployados** no projeto
`plmfyibyrowbgjjyblcl` e **não exigem JWT** (autenticam por `agent_token`/nonce, não por sessão
de usuário). Confirmado via `list_edge_functions`:

| Função | `verify_jwt` | Usada por |
| --- | --- | --- |
| `enroll-device` | `false` | `enroll.go` — matrícula com código da empresa |
| `claim-register` | `false` | `matricula.go` — cria pedido de adoção |
| `claim-status` | `false` | `matricula.go` — poll do pedido, prova o nonce |
| `session-ingest` | `false` | `main.go` — start/heartbeat/end/presence |
| `rotate-device-secret` | `false` | `rotate.go` — reporta senha nova (Fase 2) |
| `adopt-device` | `false` | painel — técnico adota pelo ID |

⇒ **O app Android chama exatamente os mesmos endpoints.** Nenhuma edge function nova,
nenhuma migration, nenhuma mudança de schema.

> ⚠️ Dívida técnica observada (não bloqueia): `enroll-device`, `claim-register` e `claim-status`
> estão deployadas mas **o fonte não está em nenhum dos dois repos** (`entrypoint_path` aponta
> pra `source/index.ts`, deploy direto). Vale versionar antes de mexer nelas.

### 2.2 Schema: já aguenta Android

`address_book` já tem a coluna **`os`** (`string | null`) e o painel já a exibe
(`dispositivos.tsx:810`). Um device Android é só mais uma linha com `os = "Android ..."`.
Nada a migrar.

### 2.3 Branding: já é mobile-aware

O `build-client.yml` já aplica branding **em arquivos mobile do RustDesk**:

- `./flutter/lib/mobile/pages/settings_page.dart` (linhas 324–325)
- `./flutter/lib/mobile/pages/connection_page.dart` (linha 335)

⇒ Os steps de identidade (nome, empresa, URLs, ícones, `removeNewVersionNotif`,
`set server/key/apiserver` no `config.rs`, patch `allowCustom.py`) **valem para os dois alvos**.
Não precisam ser duplicados — o job Android reaproveita.

### 2.4 Rotação de senha: viável, e mais limpa que no Windows

`main_set_permanent_password_with_result` está exposto em **`src/flutter_ffi.rs`** do RustDesk.
⇒ O Dart chama a troca de senha **direto pela bridge**, sem shell-out.

No Windows o agente precisa invocar `AcessoFast.exe --password <nova>` (processo externo, como
SYSTEM). No Android isso vira uma chamada de função no mesmo processo. **Menos peça móvel.**

### 2.5 O build já tem metade do caminho andado

O `build-client.yml` **já declara** as variáveis de Android, herdadas do `flutter-build.yml`
upstream: `ANDROID_FLUTTER_VERSION`, `NDK_VERSION` (`r28c`), `CARGO_NDK_VERSION`,
e o secret `ANDROID_SIGNING_KEY`. Só **falta o job**.

O job `generate-bridge` (linha 146) já existe e é reutilizável — o Android depende dele igual
ao Windows.

---

## 3. As três engrenagens que NÃO atravessam para o Android

O agente Windows (Go) se apoia em três coisas que **não existem no Android**. Este é o coração
do trabalho.

### 3.1 Detecção de sessão — hoje por *tail* de log

**Windows:** o agente é um processo separado que lê o log do cliente branded e pareia
`#N Connection opened` / `#N Connection closed` (documentado em `main.go`).

**Android:** não há processo separado nem log a seguir — **o app É o cliente**.

**Substituto:** enganchar no ciclo de vida da conexão dentro do próprio app. No Flutter do
RustDesk, o `ServerModel` (`flutter/lib/models/server_model.dart`) mantém a lista de clientes
conectados; entrada/saída dessa lista é o equivalente direto de `opened`/`closed`.

> ✅ **Isto é uma melhoria, não um remendo.** Parsing de log é frágil (rotação de arquivo, `#N`
> preso >24h — o `main.go` tem código só pra isso). O hook direto elimina essa classe de bug.

### 3.2 Aplicação da senha — hoje por CLI

**Windows:** `AcessoFast.exe --password <nova>`.
**Android:** não existe CLI.
**Substituto:** `bind.mainSetPermanentPasswordWithResult(...)` (§2.4). Resolvido.

### 3.3 Armazenamento do token — hoje `C:\ProgramData` com ACL

**Windows:** `agent.token` + `rustdesk_id` em `C:\ProgramData\AcessoFast`, ACL restrita por SID.
**Android:** não existe ACL por SID.
**Substituto:** diretório privado do app (`getApplicationSupportDirectory()`), que no Android já
é isolado por UID — **outro app não lê, por design do SO**. Equivalente ou melhor. Sem root, é
inacessível.

### 3.4 BÔNUS — a identidade (`custom_.txt`) também não atravessa

Descoberto nesta sessão e **não é óbvio**: o `custom_.txt` é lido **em runtime, da pasta do
executável**. Confirmado no fonte do RustDesk (`src/common.rs`):

```rust
std::fs::read_to_string("./custom.txt")     // debug
path.join("../Resources").join("custom.txt") // release
```

O step `Create custom.txt file` (linha 664) grava o arquivo **ao lado do .exe**, depois do build.

**No Android não existe "pasta do executável" onde largar um sidecar.** Um APK é um pacote
selado. ⇒ Se o job Android for copiado do Windows sem tratar isso, o app sai identificado como
**"RustDesk"**, lendo o namespace errado, com o popup de update de volta.

**Substituto (resolvido — o RustDesk já tem o canal certo):** não é preciso inventar patch.
O próprio fonte expõe a via oficial para o Flutter:

```rust
// src/flutter_ffi.rs — fn initialize(app_dir, custom_client_config)
// "core_main's load_custom_client does not work for flutter"
if custom_client_config.is_empty() { crate::load_custom_client(); }
else { crate::read_custom_client(custom_client_config); }
```

```kotlin
// flutter/android/app/src/main/kotlin/com/carriez/flutter_hbb/MainService.kt
FFI.startServer(configPath, "")   // <- upstream passa VAZIO; nós passamos o base64
```

⇒ A injeção é **um `sed` de uma linha** no `MainService.kt`, com âncora exata e guard.

### 3.5 ARMADILHA DENTRO DA ARMADILHA — o `allowCustom.py` também é necessário

Confirmado lendo `src/common.rs` (tag 1.4.9): a verificação RSA **está DENTRO de
`read_custom_client`** — exatamente a função que o caminho do Kotlin chama:

```rust
pub fn read_custom_client(config: &str) {
    let Ok(data) = decode64(config) else { ... };
    const KEY: &str = "5Qbwsde3unUcJBtrx9ZkvUmwFNoExHzpryHuPUdqlWM=";   // <- as 9 linhas
    let Some(pk) = get_rs_pk(KEY) else { ... };                          //    que o
    let Ok(data) = sign::verify(&data, &pk) else { ... };                //    patch remove
```

Sem o patch, o nosso base64 (não assinado pela chave privada do RustDesk) é **recusado** — e
recusado **em silêncio**: `log::error!` + `return`. O build sai **verde** entregando um APK
"RustDesk".

⇒ Por isso o job tem um step de **sanidade que FALHA o build**, em vez de só avisar. Falha
silenciosa nesta etapa é o pior modo de falha do projeto inteiro.

---

## 4. A limitação de produto (não é bug — é o Android)

Já alinhado com o Ryan em conversa, registrado aqui para não se perder:

- **Ver a tela** exige o diálogo de consentimento do MediaProjection. É obrigatório e **não tem
  como suprimir** em app comum.
- **Controlar** (toque/gesto) exige o Serviço de Acessibilidade ativado **na mão**, uma vez, em
  Configurações.
- Nenhum dos dois **sobrevive a reboot** sozinho.
- Fabricantes agressivos (Xiaomi, Samsung) matam o serviço em segundo plano.

⇒ **Um device Android no painel é ASSISTIDO, não desassistido.** O painel precisa dizer isso ao
técnico *antes* de ele gastar um atendimento (§5.3) — senão vira ticket de suporte.

---

## 5. Arquitetura proposta

### 5.1 Onde o agente mora

**Dart, dentro do app Flutter** — não Rust, não processo separado.

Motivos: (a) é onde estão os eventos de conexão (§3.1); (b) HTTP e storage são triviais em Dart;
(c) o `build-client.yml` já patcheia arquivos Dart por `sed`, mesmo mecanismo do branding;
(d) não exige mexer na bridge Rust↔Dart.

Forma sugerida: **um arquivo novo** `flutter/lib/acessofast/agent.dart`, injetado no CI, com os
hooks chamados de pontos existentes. Arquivo novo > `sed` espalhado: sobrevive a upgrade de tag
do RustDesk muito melhor.

### 5.2 Fluxo de matrícula (o mesmo do Windows)

Reaproveita `claim-register` + `claim-status` + `adopt-device` — **sem inventar fluxo novo**:

1. Cliente instala o APK e abre.
2. App espera o RustDesk ID existir.
3. App gera nonce + token, **persiste** (restart não cria pedido novo), chama `claim-register`.
4. App faz poll em `claim-status` provando o nonce.
5. Técnico digita o ID no painel → `adopt-device` → device criado, **sem senha** (v2: a
   adoção não provisiona mais nada — quem define a senha é sempre o endpoint).
6. App recebe `approved`, grava o token, **publica a senha dele** no painel
   (`acessofastPublishSecretAfterAdoption`) e entra em modo sessão. Enquanto essa
   publicação não chega, o `connect-device` responde `aguardando_agente` e a tela espera.

⇒ **A UI de adoção do painel não muda em nada.** O Android entra pela mesma porta.

### 5.3 Mudanças no painel (este repo)

Pequenas e independentes do APK — podem ser feitas e mergeadas antes:

1. **Ícone/filtro de plataforma** na lista (`dispositivos.tsx`), lendo o `os` que já existe.
2. **Aviso de dispositivo assistido** no modal de conexão, quando `os` for Android: *"o cliente
   precisa aceitar na tela do celular"*. Evita atendimento gasto à toa (§4).
3. Nada de billing, quota ou cripto muda.

---

## 6. Plano de execução

| # | Etapa | Onde | Status |
| --- | --- | --- | --- |
| 1 | Painel: ícone/filtro + aviso de assistido | este repo | ✅ feito (2026-07-31) |
| 2 | Workflow `build-client-android.yml` | repo do agente | ✅ feito |
| 3 | Injeção do `custom` (§3.4 — via `MainService.kt`) | repo do agente | ✅ feito |
| 4 | APK buildando | CI | ✅ **run #2 verde, 31m24s** |
| 4b | APK validado em aparelho real | — | 🟡 **núcleo OK, branding pendente** |
| 5 | `agent.dart`: claim + adoção (§5.2) | repo do agente | 🟡 escrito, a validar |
| 5b | Assistente de permissões (`onboarding.dart`) | repo do agente | ✅ validado no aparelho |
| 6 | `session.dart`: `session-ingest` (§3.1) | repo do agente | 🟡 escrito, a validar |
| 7 | `session.dart`: rotação de senha (§3.2) | repo do agente | 🟡 escrito, a validar |

**Decisão de arquitetura nas etapas 6/7 — observar, não instrumentar.** O
`session.dart` deriva start/end **observando `gFFI.serverModel.clients`** num timer de 3s, em
vez de patchar `addConnection`/`onClientRemove` por `sed`. Motivo: o build parte de uma **tag**
do `rustdesk/rustdesk`, e patch dentro de método do upstream quebra a cada upgrade; `clients` é
API pública do `ServerModel`. É também a mesma filosofia do agente Windows, que deriva estado
de observação (tail de log) em vez de instrumentar o RustDesk.

**Invariante da rotação (copiada do `rotate.go` — não inverter):** o painel nunca pode conhecer
uma senha que ainda não está no aparelho. Aplica primeiro
(`bind.mainSetPermanentPasswordWithResult`), reporta depois. Falha ao aplicar ⇒ senha antiga
fica nos dois lados (consistente, sem lockout). Falha ao reportar ⇒ pendência persistida e
laço de retry; nesse intervalo o painel serve a senha velha e o técnico pode falhar uma vez —
auto-recuperável, e preferível a travar o acesso.

O `session.dart` também força o modo de verificação para **senha permanente**. Sem isso o app
fica na "senha de uso único" que ele mesmo sorteia (§ nota de senha abaixo) e o painel nunca
casaria com o aparelho — era o que faltava para o botão **"Conectar"** funcionar em Android.

**Histórico do build (para quem retomar):**
- Etapa 2 saiu como **workflow separado** (`build-client-android.yml`), não como job dentro do
  `build-client.yml`: o build Windows já funciona e não deve ser tocado, e iterar Android não
  precisa pagar os ~48min do Windows.
- **Run #1 falhou** em `:app:validateSigningRelease` — `key.properties` é lido de
  `rootProject` (`flutter/android/`), mas o `file(storeFile)` do `signingConfigs` é avaliado no
  módulo `app/`. Caminho relativo resolvia pra `flutter/android/app/`. Corrigido com
  `$GITHUB_WORKSPACE` (absoluto).
- **Run #2 verde em 31m24s.** Cache do vcpkg quente ajudou; `cache-on-failure: true` no
  rust-cache foi adicionado para que falhas futuras não recompilem o Rust do zero.

⚠️ **A etapa 4b é o que realmente prova a §3.4/§3.5.** O build só garante que o base64 entrou
no `MainService.kt`; que o `read_custom_client` *aplicou* a identidade em runtime, só o
aparelho diz.

### ✅ VALIDADO EM APARELHO REAL — 2026-07-31

**Conexão desktop → Android FUNCIONA.** Testado com aparelho Samsung, device
`1 981 018 173`, conectando pelo AcessoFast desktop com o ID + senha exibidos no app.
⇒ **A pergunta original do Ryan ("dá pra acessar o mobile pelo desktop atual?") está
respondida: SIM.**

Também validado por consequência: o app chegou a ter ID e status "Pronto", o que **só é
possível se ele registrou no relay próprio** — sem o `sed` do `config.rs` ele nunca obteria ID.
Soberania confirmada sem precisar inspecionar config (a tela de Servidor ID/Relay vem vazia por
design: ela mostra override do usuário, não o valor compilado).

**Pendente:** nome e ícone ainda saem "RustDesk" (correção `2fcb60d` ainda não buildada).
Observação útil: subir o serviço de compartilhamento **não** mudou o título — ou seja, injetar
só no `MainService.kt` não bastava mesmo, o que sustenta a correção do §3.4 (caminho de
abertura).

### ⚠️ ADOÇÃO PELO PAINEL AINDA NÃO FUNCIONA — e está correto

"Adicionar dispositivo" → `adopt-device` → `no_pending_claim`. Esperado: o `adopt-device`
procura um **claim** que o agente cria (`matricula.go` no Windows). O Android não tem agente
ainda — é a **etapa 5**. Não é bug.

> Alternativa disponível se quiser destravar o painel antes do `agent.dart`: a
> `register-device` (deployada, §2.1) cria device + senha **sem claim**. Seria o caminho
> "leve" descartado no início — vale como ponte, não como destino.

### 🔴 ATRITO DE INSTALAÇÃO (achado de produto, 2026-07-31)

Instalar o APK fora da loja exigiu **três** liberações manuais, nesta ordem:

1. **Fontes desconhecidas**
2. **Google Play Protect** bloqueou o app ("pode pedir acesso a dados sensíveis") → precisa
   "Instalar mesmo assim" ou desativar a análise
3. **Configurações restritas** (Android 13+): a Acessibilidade fica bloqueada para app
   sideloaded → Configurações → Aplicativos → app → ⋮ → "Permitir configurações restritas"

**Todo cliente vai passar pelas três.** Consequências:
- A instalação **não é auto-serviço**: na prática o técnico conduz a primeira instalação.
- Isso **reprecifica o `targetSdkVersion 33`** (§7.6). App vindo da Play Store não sofre
  nenhuma das três. O targetSdk deixa de ser dívida técnica e vira o que separa "cliente
  instala sozinho" de "técnico instala junto".

### 📌 Senha: o Android usa "senha de uso único"

O app exibe **"Senha de uso único"**, que rotaciona sozinha — padrão do RustDesk Android. No
fluxo AcessoFast quem serve a senha é o painel (permanente + rotação da Fase 2). Reconciliar
isso é parte da **etapa 7**, não um ajuste de configuração.

---

## 7. Decisões em aberto (precisam do Ryan)

1. **Assinatura do APK.** O upstream usa `signingConfigs.debug` ("temporary use debug sign
   config"). Debug-signed **não atualiza por cima** de release-signed depois — a escolha é
   praticamente irreversível para a base instalada. O secret `ANDROID_SIGNING_KEY` já está
   declarado no workflow: **está preenchido?** Se não, gerar keystore e guardar **antes** do
   primeiro APK sair pra cliente.
2. **Distribuição.** APK direto (site/link) ou Play Store? A Play Store tem política dura para
   apps de acesso remoto + Acessibilidade — pode ser recusa. APK direto não tem esse risco, mas
   não atualiza sozinho.
3. **Arquiteturas.** `arm64` só (cobre ~toda a base atual) ou também `armv7`/`x86_64`? Cada
   arquitetura extra é mais um ciclo de build.
   → *Job escrito com `arm64-v8a` só; as outras estão comentadas e parametrizadas.*
4. **Versão mínima do Android.** Define o alcance e alguns comportamentos de background.
   → *Upstream: `minSdkVersion 22` (Android 5.1).*

5. ~~**`applicationId`**~~ — ✅ **DECIDIDO 2026-07-31 (Ryan):**
   **`br.com.aspsoftwares.acessofast.mobile`**. O upstream usa `com.carriez.flutter_hbb`, que
   colidiria com o RustDesk oficial no mesmo aparelho. O sufixo `.mobile` foi escolha do Ryan
   para identificação — sem necessidade técnica (o client desktop não tem `applicationId`).
   ⚠️ Uma vez publicado na Play Store, **nunca mais muda**: mudar seria outro app, do zero,
   sem os usuários. Até o primeiro APK sair pra cliente, ainda dá pra trocar.

6. **`targetSdkVersion 33` bloqueia a Play Store.** O `build.gradle` do RustDesk 1.4.9 tem
   `targetSdkVersion 33` (Android 13, de 2022). A Play Store exige que apps novos e
   atualizações mirem um nível de API recente — 33 está **bem abaixo** do aceito hoje, então
   a submissão seria recusada de cara.
   ⚠️ **Isto não é um `sed` de uma linha.** Subir o `targetSdk` ativa regras mais duras de
   *foreground service* e background do Android, justamente o que o app precisa pra continuar
   rodando. Tem risco de quebrar comportamento e exige teste em aparelho real.
   ⇒ **Não bloqueia o APK direto** (§7.2 plano B). Bloqueia só a via Play Store. Confirmar o
   nível exigido no Play Console na hora de submeter.

---

## 8. Fora de escopo (decidido nesta sessão)

**Maquininhas Stone: descartado.** Não por burocracia — por trava técnica de fábrica:
o terminal de produção não aceita sideload (é ele que baixa o app, do sistema da Stone), e o APK
precisa ser assinado com o **JKS que a Stone fornece** na homologação. Além disso, a homologação
proíbe justamente as permissões que o acesso remoto exige (captura de tela e acessibilidade).
Retomar só se a Stone confirmar por escrito que homologa esse tipo de app.

---

## 9. Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| `custom` não injetado no Android (§3.4) | App sai como "RustDesk", namespace errado | Step dedicado **antes** do cargo + sanidade que falha o build |
| Build Android quebra em tag nova do RustDesk | Trava upgrades | Fixar a tag; `agent.dart` como arquivo novo, não `sed` espalhado |
| OEM mata o serviço em background | Device "some" do painel | Documentar exceção de bateria no onboarding |
| Play Store recusa o app | Sem canal de distribuição | Decidir §7.2 cedo; APK direto como plano B |
| Debug-signing na primeira release | Base instalada não atualiza | Resolver §7.1 **antes** da etapa 4 |

---

## 10. Referências

- Agente Windows (a portar): `../acessofast-agent-repo/{main,enroll,matricula,rotate}.go`
- Build atual: `../acessofast-agent-repo/.github/workflows/build-client.yml`
- Job Android upstream (base do port): `rustdesk/rustdesk` tag `1.4.9`,
  `.github/workflows/flutter-build.yml` linhas **911–1203**
- Painel: [dispositivos.tsx](src/routes/_authenticated/dispositivos.tsx)
- Contexto anterior: `HANDOFF.md`, `FASE3-DESIGN.md`
