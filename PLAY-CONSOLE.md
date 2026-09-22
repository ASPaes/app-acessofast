# PLAY-CONSOLE — respostas do "Conteúdo do app"

> Escrito em **18/09/2026**, para o app **`br.com.aspsoftwares.acessofast.mobile`**
> (fork do RustDesk com agente embutido — o celular é o **endpoint atendido**, não o painel).
>
> **Regra que vale para o documento inteiro:** cada resposta aqui tem que bater com
> [`/privacidade`](src/routes/privacidade.tsx). O Google compara as duas. Se mudar o que o app
> coleta, mude os dois **no mesmo dia** — divergência entre a política e a Segurança dos dados é
> motivo de recusa, e de suspensão depois de publicado.
>
> Contexto técnico do app: [MOBILE-DESIGN.md](MOBILE-DESIGN.md) · Política de anúncios:
> [ANUNCIOS-POLITICA-CONTEUDO.md](ANUNCIOS-POLITICA-CONTEUDO.md)

---

## 0. O que trava a submissão antes do formulário

Estes três não são perguntas do formulário, mas o formulário não serve de nada sem eles.

| # | Bloqueio | Estado |
| --- | --- | --- |
| 1 | **`targetSdkVersion 33`** (herdado do RustDesk 1.4.9; o `build-client-android.yml` não sobe). App novo com 33 é recusado na hora. | 🔴 aberto |
| 2 | **Keystore de release.** `ANDROID_SIGNING_KEY` está declarado no workflow — confirmar que está preenchido e guardado. Debug-signed não atualiza por cima depois. | 🟡 confirmar |
| 3 | **Declaração de Acessibilidade** (§10 abaixo). Maior risco de recusa deste app. | 🔴 aberto |

⚠️ O `targetSdk` **não é um `sed` de uma linha**: subir ativa regras mais duras de foreground
service e background, que é exatamente do que o app depende para continuar alcançável. Exige
teste em aparelho real. Confirme o nível exigido no próprio Console na hora de submeter.

---

## 1. Política de Privacidade

**URL:** `https://acessofast.com.br/privacidade`

⚠️ **Confirmar o host antes de colar.** A rota foi criada neste painel
([privacidade.tsx](src/routes/privacidade.tsx)). Se o painel não for servido no apex
`acessofast.com.br`, use o host onde ele realmente está. Teste anônimo (janela privada, sem
sessão) antes de colar no Console: a página tem que abrir sem login e sem redirecionar.

Já conferido: responde 200, renderiza no servidor, `robots: index, follow`.

O Console vai pedir **duas** URLs públicas ao todo. A outra é a de exclusão de dados (§6.1):

| Onde | URL | Arquivo |
| --- | --- | --- |
| Política de privacidade (§1) | `/privacidade` | [privacidade.tsx](src/routes/privacidade.tsx) |
| Exclusão de dados (§6.1) | `/exclusao-de-dados` | [exclusao-de-dados.tsx](src/routes/exclusao-de-dados.tsx) |

---

## 2. Acesso ao app (Detalhes do login)

**Resposta: "Algumas funcionalidades são restritas"** — não marque "todas disponíveis".

O aparelho só entra em modo de produção depois de adotado por uma empresa no painel.

### Campos do diálogo "Adicionar detalhes de login"

| Campo | Limite | O que colar |
| --- | --- | --- |
| **Nome** (obrigatório) | 60 | `Demonstracao AcessoFast / AcessoFast demo` |
| **Nome de usuário** | 100 | e-mail da conta de demonstração **do painel web** |
| **Senha** | 100 | senha dessa conta |
| **Outras informações** | **500** | o bloco abaixo |
| Checkbox final | — | **marcar**, se a conta de demo tiver acesso total (ver abaixo) |

⚠️ **O app Android não tem login.** As credenciais acima existem só para o revisor conseguir
ver o painel se quiser; o teste do app em si não depende delas. Por isso o texto livre começa
dizendo exatamente isso — senão o revisor procura uma tela de login que não existe e reprova
por "não conseguimos acessar".

### Texto para "Qualquer outra informação necessária para acessar o app"

Cabe em **462 caracteres**, deixando 43 para a URL do vídeo. O Console exige versão em inglês
de tudo que for necessário para o acesso, e por isso o bloco é bilíngue. **Sem acentos de
propósito** — evita qualquer problema de codificação na ferramenta do revisor.

```
O app e o aparelho atendido, nao o painel. Sem login. 1) Abra o app: mostra ID e senha. 2) No PC, instale o cliente de acessofast.com.br/download. 3) Conecte com esse ID e senha. 4) Aceite o aviso de captura no Android.
EN: The app is the supported device, not the console. No login. 1) Open it: it shows ID and password. 2) On a PC, install the client from the link above. 3) Connect with that ID and password. 4) Accept the Android capture prompt.
Demo: <url>
```

⚠️ Conte de novo depois de trocar `<url>` pelo link real. O limite é rígido e o Console corta.

### Sobre o checkbox final

> *"Os detalhes de login nesta declaração fornecem acesso total a todos os recursos e conteúdos
> deste app, incluindo aqueles que são premium ou pagos."*

**Marcar** — mas só depois de garantir que a conta de demonstração está num plano com acesso
total, não no gratuito. Se ela estiver no gratuito, o revisor bate no teto de 5 acessos/dia e
no anúncio, e a declaração vira falsa.

### Três armadilhas na conta de demonstração

1. **Não pode suspender por cobrança.** O corte por `billing_status` derrubaria a revisão no meio.
   Deixe a empresa de demonstração fora de qualquer regra de suspensão.
2. **Não pode esbarrar em limite de usuários** nem no teto diário de acessos do plano gratuito.
3. **Tem que continuar viva.** O Google reusa essas credenciais em toda atualização, por anos.

⚠️ **Grave o vídeo.** App de acesso remoto que exige um segundo aparelho é recusado com
frequência por "não conseguimos testar". O próprio diálogo avisa, em letra miúda, por que o
vídeo não é opcional na prática:

> *"Se não conseguirmos revisar o app, talvez não seja possível lançar atualizações, e o app
> pode ser removido do Google Play. Os revisores não conseguem criar contas, usar contas
> próprias nem usar testes gratuitos para acessar o app. **Eles também não podem entrar em
> contato com você para mais informações.**"*

Ou seja: o que estiver nesses 500 caracteres é tudo que o revisor vai ter. Não há segunda
chance de explicar.

---

## 3. Anúncios

**Resposta: "Não, meu app não contém anúncios."**

Os anúncios do plano gratuito vivem **só no painel web**, para o técnico. O app Android é o
endpoint atendido e não renderiza o painel. Confirmado no build: nenhum SDK de publicidade,
analytics ou rastreamento (`firebase`, `crashlytics`, `admob`, `sentry`, `adjust`, `amplitude` —
nenhum aparece no workflow nem no código Dart injetado).

⚠️ A declaração é **por app**. Se um dia o painel for embutido em WebView, ou sair um app do
técnico-controlador, esta resposta muda.

---

## 4. Classificação de conteúdo (questionário IARC)

| Pergunta | Resposta |
| --- | --- |
| Categoria | **Utilitário / Produtividade / Comunicação** |
| Violência, sexo, drogas, linguagem imprópria, apostas | **Não** em todas |
| Os usuários podem interagir entre si? | **Sim** |
| Compartilhar localização com outros usuários? | **Não** |
| Permite trocar conteúdo/arquivos entre usuários? | **Sim** |
| Compras digitais no app? | **Não** |

**Por que "Sim" nas duas de interação:** o `custom` do build só ajusta nome e modo de aprovação
(`app-name`, `approve-mode`, `allow-remote-config-modification`,
`allow-logon-screen-password`). **Chat e transferência de arquivo do RustDesk continuam
ligados.** Responder "Não" seria declaração falsa.

### 4.1 Bloco de conteúdo gerado por usuários

Responder "Sim" em interação abre este bloco. As respostas:

| Pergunta | Resposta | Por quê |
| --- | --- | --- |
| Conteúdo gerado por usuários é a principal fonte de conteúdo do app? | **Não** | O conteúdo é a tela do próprio aparelho do usuário. Não há feed, publicação nem acervo de terceiros. |
| Permite partilha pública de nudez? | **Não** | Não há partilha pública de nada. |
| Permite partilha pública de violência explícita real? | **Não** | Idem. |
| Inclui capacidade de **bloquear** usuários ou conteúdo? | **Não** | Não existe lista de bloqueio. O controle é a credencial: sem ela ninguém conecta, e trocá-la corta todo mundo. |
| Inclui capacidade de **denunciar** usuários ou conteúdo? | **Não** | Não há a quem denunciar — a interação é 1:1 entre duas partes já conhecidas. |
| Inclui moderação de conversas por chat? | **Não** | O chat é direto entre as duas pontas, criptografado. Ninguém no meio para moderar — e é assim de propósito. |
| As interações podem ser limitadas apenas a contatos convidados? | **Sim** | Só conecta quem tem a credencial do aparelho, que o dono/empresa controla. Não há descoberta nem interação aberta: é convite por construção. |

⚠️ As três respostas "Não" de bloquear/denunciar/moderar costumam assustar, mas o que pesa na
classificação são as duas de **partilha pública**, e as duas são "Não". Não há praça pública
neste app: há duas pessoas numa sessão autorizada por senha.

Resultado esperado: **Livre / L**.

> **Opção de produto, agora com preço visível:** desligar chat e transferência de arquivo no
> `custom` faz a pergunta de interação virar "Não" e **este bloco inteiro desaparece**. Some
> junto a declaração de troca de arquivos na Segurança dos dados. O custo é o técnico perder o
> chat durante o atendimento no celular. Decisão de produto — mas se for feita, é **antes** de
> responder o IARC, porque a classificação já respondida é chata de refazer.

---

## 5. Público-alvo e conteúdo

| Pergunta | Resposta |
| --- | --- |
| Faixas etárias | **Somente 18 anos ou mais** |
| Seu app pode atrair crianças? | **Não** |
| Ficha da loja é direcionada a crianças? | **Não** |

🔴 **Nunca marque nenhuma faixa abaixo de 18.** Qualquer faixa infantil joga o app na política
**Famílias**, que é incompatível com controle remoto por Acessibilidade — seria recusa certa, e
mudar isso depois é doloroso.

Consequência prática: ícone, capturas e descrição em tom profissional. Nada lúdico. O Google
avalia a ficha da loja nesta pergunta.

---

## 6. Segurança dos dados

### 6.1 Perguntas de abertura

| Pergunta | Resposta |
| --- | --- |
| O app coleta ou compartilha algum dos tipos de dados exigidos? | **Sim** |
| Todos os dados são criptografados em trânsito? | **Sim** |
| Você oferece uma forma de o usuário pedir exclusão dos dados? | **Sim** |
| URL de solicitação de exclusão de dados | `https://acessofast.com.br/exclusao-de-dados` |

⚠️ **O Console pede URL, não e-mail.** Por isso existe a rota
[exclusao-de-dados.tsx](src/routes/exclusao-de-dados.tsx): página pública, sem login, que
descreve o procedimento, o que é apagado, o que é mantido por obrigação fiscal e o prazo. Um
`mailto:` sozinho não é aceito nesse campo. Vale o mesmo aviso de host do §1: confirme onde o
painel está publicado antes de colar.

### 6.2 Tipos de dados a declarar

Para **todos** os itens abaixo: **Coletado: Sim · Compartilhado: Não · Obrigatório (não
opcional) · Finalidade: Funcionalidade do app**.

| Tipo no formulário | O que é, no código |
| --- | --- |
| **IDs do dispositivo ou outros IDs** | `rustdesk_id`, hashes de token e nonce (`agent.dart`) |
| **Informações e desempenho do app** → outros dados | `hostname`, `os`, `agent_version` |
| **Atividade no app** → outras ações | eventos de sessão: início, fim, ID do controlador (`session.dart`) |

**Não declarar** (o app comprovadamente não toca): localização, contatos, fotos, mensagens,
agenda, microfone, câmera, lista de apps instalados, informações financeiras, dados de saúde,
nome, e-mail. O app Android **não tem tela de cadastro** — não pede nome nem e-mail de ninguém.

### 6.3 A decisão difícil: o conteúdo da sessão

Tela, toques, chat e arquivos trafegam entre os dois aparelhos durante o atendimento.

**Recomendação: declarar como NÃO coletado.** Fundamento: o conteúdo é criptografado entre as
duas pontas, o relay de vocês só repassa sem conseguir ler, e nada é gravado ou armazenado do
lado do AcessoFast. Essa é a posição padrão de app de acesso remoto, e é a mesma coisa que a
seção 4 da política já diz publicamente.

🔴 **Isso só é verdade se o relay não registrar nada além de metadado de conexão.** Confirme
antes de marcar. Se o relay guardar qualquer coisa do conteúdo, **a declaração e a política
mudam juntas** — e essa é a divergência que derruba app publicado, não app em análise.

### 6.4 O que fica de fora por ser do painel, não do app

`connection_logs` guarda `technician_email` e `technician_ip` — o IP de **quem atende**, não de
quem é atendido. É coletado pelo painel web, não pelo app Android, então não entra nesta
declaração. **Mas está declarado na política** (seção 6), que cobre os três produtos.

---

## 7. Apps governamentais

**Resposta: Não.**

Produto comercial da ASP Desenvolvimento de Softwares Ltda. Ter cliente do setor público não
muda a resposta — a pergunta é se o app foi desenvolvido **em nome de** um órgão público.

---

## 8. Recursos financeiros

**Resposta: "Meu app não fornece nenhum recurso financeiro."**

Nada de empréstimo, investimento, cripto, gestão de dinheiro ou pagamento dentro do app. A
assinatura é vendida no painel web, fora do app — por isso também **não** entra Google Play
Billing.

⚠️ Muda se o app Android um dia vender plano. Aí Play Billing passa a ser obrigatório.

---

## 9. Saúde

**Resposta: Não** em todas as perguntas.

Sem funcionalidade de saúde, pesquisa clínica, saúde mental, medicamento ou telemedicina. A
integração DoctorSaaS é do **painel**, resolvida por parâmetro de URL para um cliente
específico — não transforma este app em app de saúde.

---

## 10. O que o Console vai pedir e não está na lista original

### 10.1 Declaração da API de Acessibilidade 🔴

O maior risco de recusa deste app. Controle remoto é uso **permitido** da API, mas exige
justificativa escrita e divulgação em destaque dentro do app.

- **Não marque `isAccessibilityTool`.** Essa flag é para ferramenta destinada a pessoas com
  deficiência. Declarar errado é recusa conhecida.
- Justificativa a usar: *"O serviço reproduz os toques e a digitação do técnico durante uma
  sessão de suporte remoto autorizada pelo usuário. Não lê conteúdo de tela para nenhuma outra
  finalidade, não registra digitação fora da sessão e não envia dados a terceiros."*
- Isso é exatamente o que a seção 5 da política diz. Mantenha idêntico.

### 10.2 Divulgação em destaque (prominent disclosure)

Aviso **dentro do app**, antes de a captura ou o controle começarem, explicando o que vai
acontecer e pedindo aceite. O `onboarding.dart` já conduz permissões — verificar se o texto
cobre a exigência de divulgação, não só a mecânica de ativar.

### 10.3 Tipos de serviço em primeiro plano

Em API 34+ é preciso declarar cada tipo (`mediaProjection`, etc.) **com vídeo** demonstrando o
uso. Some ao vídeo do §2 e resolva os dois de uma vez.

### 10.4 Verificação da organização

Conta de organização com D-U-N-S exige verificação de identidade da empresa. Os dados têm que
bater exatamente com os da política:

```
ASP Desenvolvimento de Softwares Ltda
CNPJ 07.507.463/0001-93
Rua Frei Rogério, 320, Centro, Lages/SC, CEP 88502-199
```

### 10.5 `applicationId` congela agora

`br.com.aspsoftwares.acessofast.mobile`. Depois de publicado, **nunca mais muda** — mudar é
outro app, do zero, sem os usuários. Última chance de revisar.

---

## 11. Pontas soltas conhecidas (não bloqueiam a submissão)

1. **`log_retention_days` não tem tela.** A política diz que a empresa pode definir prazo
   diferente para os registros de atendimento — verdade no banco (coluna aceita 1 a 3650), mas
   hoje só muda por SQL. Hoje as 11 empresas estão no default de 180 dias.
2. **Exclusão de conta é manual por trás da página.** A URL declarada é pública e descreve o
   procedimento, mas a execução é humana: existe a RPC `delete_tenant` e nenhum caminho
   self-service. Alguém precisa ser dono desse fluxo — a página promete resposta em 15 dias, e
   agora essa promessa está declarada ao Google.
3. **`suporte@` virou canal de LGPD.** Quem atende essa caixa precisa reconhecer pedido de
   titular, senão o prazo vence tratado como chamado comum.
4. **Leaked Password Protection está desligada** no Supabase Auth. Não contradiz nada que a
   política afirme, e não bloqueia a Play — mas é um clique.

---

## 12. Recursos gráficos da ficha da loja

### 12.1 Prontos

Gerados em 21/09/2026 a partir da marca real do produto — não são arte nova, são a mesma
identidade que já roda no cliente Windows (`acessofast-agent-repo/branding/`).

| Arquivo | Formato | Observação |
| --- | --- | --- |
| `play-store/icone-512.png` | 512×512, PNG 32 bits, 138 KB | Zero pixels transparentes (a Play exige) |
| `play-store/recurso-grafico-1024x500.png` | 1024×500, PNG, 174 KB | Nada essencial nas margens: a Play recorta em algumas superfícies |

**De onde saiu:** `branding/logo.png` tem a marca em 775×576 **com fundo transparente**, então o
ícone foi montado em 512 nativo — não é ampliação do `icon.png` de 256. O fundo navy foi
amostrado do ícone atual (`rgb(0,9,32)`) para a ficha da loja bater com o que o cliente já
mostra no Windows.

> ⚠️ O que **não** é da marca: a palavra "AcessoFast" no recurso gráfico está composta em Segoe
> UI Bold, porque não existe wordmark oficial em nenhum dos repos — só o símbolo. Se existir um
> arquivo de marca com a tipografia certa, vale trocar.

### 12.2 Capturas de tela — não dá para gerar, e não é limitação de ferramenta

A Play exige que as capturas sejam **do app rodando de verdade**. Imagem montada que simula uma
interface é deturpação da ficha da loja: o revisor compara com o APK, e isso derruba a
submissão — e, se passar, derruba o app depois.

**A boa notícia é que o app roda.** O cabeçalho do [MOBILE-DESIGN.md](MOBILE-DESIGN.md) está
desatualizado — diz "nada implementado", mas o mesmo arquivo registra mais abaixo:

- linha 237: `APK buildando — ✅ run #2 verde, 31m24s`
- linha 277: `✅ VALIDADO EM APARELHO REAL — 2026-07-31`
- linha 279: `Conexão desktop → Android FUNCIONA. Testado com aparelho Samsung`

Ou seja: existe APK e existe aparelho onde ele já rodou. As capturas saem de lá.

### 12.3 Quais telas capturar

Três bastam, e cada uma serve a um propósito diferente na revisão:

1. **Tela inicial com ID e senha** — é o que o usuário vê ao abrir, e é o que o roteiro do §2
   manda o revisor usar.
2. **Assistente de permissões** (`onboarding.dart`, já validado no aparelho) — mostra que
   Acessibilidade e captura de tela são pedidas com explicação e aceite. Reforça a declaração
   do §10.1 e a divulgação em destaque do §10.2.
3. **Sessão ativa**, com o indicador do Android na barra de notificações visível — prova que o
   acesso é sinalizado, não silencioso.

### 12.4 Antes de subir

- **Aparelho de teste, nunca de cliente.** A captura fica pública para sempre; o ID que aparece
  na tela é de um aparelho real.
- **Borre a senha** exibida na tela inicial. Ela rotaciona, mas não há motivo para publicá-la.
- Vertical (9:16), PNG ou JPEG, sem transparência. O número mínimo de capturas e os limites de
  lado o próprio Console informa no campo — confirme lá, não aqui.
- `adb exec-out screencap -p > tela1.png` sai mais limpo que a captura pelo botão do aparelho
  (sem barra de gestos capturada torta, sem notificação de "captura salva").
