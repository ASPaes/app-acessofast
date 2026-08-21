# Integração DoctorSaaS ↔ AcessoFast — o documento de fluxos, linha a linha

Este arquivo confronta o documento funcional *"Doctor SaaS + AcessoFest — Fluxos de
identificação, sincronização e acesso remoto"* (20/08/2026) com o que está implementado
em [`src/routes/conectar.tsx`](../src/routes/conectar.tsx). Serve para responder rápido a
"isso já está pronto?" sem reler o PDF.

O contrato com o DoctorSaaS está na seção **O contrato da API**, no fim deste arquivo.
Não há mais documento externo: os dois lados são nossos, e o manual que existia virou
custo de manutenção sem leitor.

---

## A diferença de arquitetura, que muda a leitura do documento inteiro

O documento de fluxos foi escrito supondo que a interface e a lógica ficariam **dentro do
DoctorSaaS**, consumindo uma API do AcessoFast e outra do DoctorSaaS. Não é o que foi
construído.

O que existe é o inverso, e é mais barato para os dois lados:

- **A tela é nossa.** O DoctorSaaS abre `/conectar?conv=<id>` numa janelinha. Zero API,
  zero token, zero regra de negócio do lado deles.
- **O cadastro do AcessoFast é a fonte da verdade.** Não há consulta ao cadastro do
  DoctorSaaS, porque não há API do lado de lá — e o contrato entregue ao time deles diz
  explicitamente que não precisa haver.

Todas as validações, pendências e ações do documento continuam valendo. O que muda é
**onde** rodam e **de onde** vem o dado da empresa.

---

## V1 — Vínculo (contato ↔ empresa)

| Documento | Aqui |
|---|---|
| `CONTACT_COMPANY_NOT_LINKED` | Primeira abertura da conversa: "Qual cliente é esta conversa?" |
| `SELECT_COMPANY` / `SEARCH_COMPANY` | Busca por nome **ou CNPJ**, ignorando pontuação (`filtrarIgnorandoPontuacao`) |
| `IDENTIFY_BY_CNPJ` | É a mesma busca — digitar o CNPJ filtra a lista |
| `LINK_CONTACT_COMPANY` | Gravado em `doctorsaas_conversation_links`, chaveado por `(tenant_id, conversation_id)` |

O contato não viaja na URL: o que chega é o id opaco da conversa. **CNPJ de propósito não
vai na querystring** — documento em URL acaba em log de servidor e no histórico do
navegador.

### Multiempresa (seção 7 do documento — o caso BRSoft)

Resolvido com a caixa **"Lembrar este cliente nesta conversa"**, marcada por padrão:

- marcada → grava o vínculo, e a conversa nunca mais pergunta;
- desmarcada → a escolha vale só para a sessão atual, **nada é gravado**, e um aviso
  "Só neste atendimento: X" fica visível no topo com um botão "Vincular conversa" para
  promover a permanente quando (e se) o técnico quiser.

É exatamente a recomendação do documento: identificação temporária não altera cadastro.

---

## V2 — Empresa existe no AcessoFast

| Documento | Aqui |
|---|---|
| `COMPANY_NOT_SYNCED` | Não existe como estado: o cadastro do AcessoFast **é** a fonte, e o DoctorSaaS escreve nele |
| `SYNC_COMPANY` | Substituído por **"Cadastrar cliente"** direto na janelinha (nome + CNPJ/CPF) |
| `SYNC_ALL_COMPANIES` | Implementado: ação `sincronizar_clientes` da API |

Cadastrar dali cria a linha em `clients` e já emenda no vínculo da conversa e na lista de
máquinas. Nome repetido cai no cliente existente em vez de erro de unicidade.

Um detalhe que o documento não previa e que o painel já fazia: quando o cliente tem CNPJ,
a lista de máquinas agrupa **matriz e filiais pela raiz do CNPJ** (8 primeiros dígitos).
Os dois sistemas quase sempre divergem sobre qual unidade é "a empresa" — um tem a matriz
cadastrada, o outro tem a filial onde as máquinas realmente estão. A lista mostra o CNPJ
completo de cada unidade para o técnico saber onde está entrando.

---

## V3 — Computador

A seção 11 do documento insiste: "não representar 'computador não encontrado' como um
único erro". É a parte que estava colapsada numa frase só e foi aberta.

| Estado do documento | Como a janelinha detecta | Ação oferecida |
|---|---|---|
| `DEVICE_NOT_FOUND` | Pesquisa por ID não acha nada em `address_book` | **Adotar este computador** (`adopt-device`) se ele acabou de ser instalado; senão, mandar o instalador |
| `DEVICE_NOT_LINKED` | Achou o registro com `client_id` nulo | **Vincular a \<cliente\>** — um clique, `update` do `client_id` + `device_group` |
| (não previsto) máquina de outro cliente | `client_id` de outro | Só informa qual. Remanejar é correção de cadastro, feita em Dispositivos |
| (não previsto) máquina desativada | `is_active = false` | Avisa para reativar em Dispositivos |
| `DEVICE_OFFLINE` | Nenhuma máquina vista nos últimos 120s | Avisa que é só ligar + **Atualizar**. **Nunca** oferece instalador |
| `READY_TO_CONNECT` | Há máquina ativa | Lista com bolinha de online e botão Conectar |

`SEND_INSTALLER` é o link de `acessofast.com.br/baixar` mais um **"Copiar instruções"**
que põe na área de transferência o texto pronto para colar no chat, incluindo o pedido do
ID. É o pareamento do fluxo: o cliente instala, informa o ID, o técnico adota pelo ID.

`REFRESH` é o botão **Atualizar**, que revalida máquinas e presença.

A busca aceita **ID do AcessoFast ou nome da máquina** (`alias`), como pede a seção 12.
O recorte por tenant é da RLS, não do filtro: a pesquisa nunca alcança máquina de outro
MSP mesmo que o ID seja digitado inteiro.

---

## Ordem e UX (seções 9 e 12)

A regra "mostre só a próxima pendência" é o desenho da tela, não uma checagem à parte:
cada estado renderiza um bloco e esconde os outros. Não há árvore de erro técnico, e o
único caminho para o instalador é o de máquina inexistente.

O que o documento chama de `CONNECT` continua sendo o mesmo `connect-device` da tela de
Dispositivos — plano, quota, crédito, bloqueio por inadimplência e a escolha entre acesso
gratuito e crédito. A integração não duplicou nenhuma regra de cobrança.

---

## O contrato da API

A direção da integração é **push**: o DoctorSaaS chama o AcessoFast, com uma chave que o
AcessoFast emitiu. Não lemos o banco dele, e ele não guarda credencial nossa de leitura.

### A chave é o vínculo, não só a credencial

`integration_keys` guarda SHA-256 e prefixo — a chave em si é sorteada no navegador de
quem clica em Integrações → Gerar chave, e o servidor nunca vê o texto.

Ela é emitida **por tenant**, e é isso que dispensa qualquer identificador de empresa nas
chamadas: a chave já diz de quem é. Não existe parâmetro de empresa em endpoint nenhum, de
propósito — seria a forma de um assinante escrever no cadastro de outro.

Isso também é o que matou duas coisas de desenhos anteriores: o `conv` composto
`<tenant_id>:<conversation_id>` (muleta para dizer de qual workspace era a conversa) e o
vazamento que ele deixava aberto, de um par válido revelar nome e CNPJ de outro assinante.

### Endpoint

```
POST /functions/v1/doctorsaas
X-AcessoFast-Key: af_ds_...
```

`verify_jwt` PRECISA estar desligado neste deploy. A autenticação é a chave; exigir JWT do
Supabase exigiria uma sessão que o DoctorSaaS não tem nem deve ter.

### `vincular_conversa`

```json
{ "acao": "vincular_conversa", "conv": "<id da conversa>", "criar": true,
  "empresa": { "nome": "…", "cnpj": "…", "telefone": "…" } }
```

`criar` é opcional e vale `true` quando ausente. Com `false` a chamada vira consulta: se
não houver cliente com esse CNPJ, devolve `{"vinculado": false, "motivo": "nao_encontrado"}`
e **não cria nada** — o cadastro passa a ser ação explícita do técnico, na janelinha. Foi
o pedido do DoctorSaaS quando a importação em lote saiu de cena.

Atenção ao que `criar: false` **não** suprime: cliente que já existe continua sendo
renomeado quando a grafia difere, e a conversa continua sendo vinculada. Sem gravar o
vínculo a consulta não serviria para nada — a janelinha voltaria a perguntar.

CNPJ exato → raiz (8 dígitos) → cria o cliente. Depois grava em
`doctorsaas_conversation_links`.

Devolve `{"vinculado": false, "motivo": "varias_unidades"}` quando o grupo tem mais de uma
unidade e nenhuma com o CNPJ exato. É o único caso em que não vinculamos: escolher uma
seria chute, e chute errado manda o técnico para as máquinas da filial errada.

### `sincronizar_clientes` — existe, mas está fora de uso

Decisão de 21/08/2026: **não importamos nem exportamos a base do DoctorSaaS**. A
resolução acontece por atendimento, com o CNPJ que chega na conexão solicitada. O
endpoint continua no ar e testado, para o dia em que alguém quiser a carga em lote; o
que está descrito abaixo é o comportamento dele, não um passo do fluxo atual.


```json
{ "acao": "sincronizar_clientes", "clientes": [ { "nome": "…", "cnpj": "…" } ] }
```

Teto de 500 por chamada. Casamento **só por CNPJ exato** — nome nunca casa nada.

**O DoctorSaaS manda no nome** (decisão de 21/08/2026). Cliente que já existe e chega com
grafia diferente é renomeado; o nome de lá é o que vale. O telefone não segue a mesma
regra: só preenchemos o que está vazio, porque número corrigido à mão aqui costuma ser o
que atende.

Cliente **desativado** no AcessoFast depende de configuração da empresa, em Integrações →
Importação de clientes (`integration_settings.reactivate_on_sync`):

- **Desligado** (padrão): não volta — nem recriado nem renomeado, e sai na resposta como
  `cliente_inativo`. Quem opera pelo painel manda.
- **Ligado**: a sincronização reativa quem reaparecer na lista de lá, e conta em
  `reativados`. Quem opera pelo DoctorSaaS manda.

Não dá para escolher por quem usa: as duas leituras são legítimas e dependem de onde o
cadastro é mantido de verdade. O padrão é o conservador porque linha ausente vale padrão —
ninguém precisa configurar nada para o comportamento continuar o de hoje.

**O telefone fica de fora da regra do nome**, e não por descuido: no DoctorSaaS vários
contatos podem estar sob o mesmo CNPJ, então o número que chega é um deles, não "o"
telefone da empresa. Só preenchemos quando o nosso está vazio.

O tropeço real dessa decisão é o índice `clients_tenant_name_uk`, que é único em
`(tenant_id, lower(trim(name)))` entre clientes ativos. Renomear para um nome que outro
cliente ativo já tem viola o índice. Por isso as correções vão **uma a uma** — `UPDATE`
não tem `ON CONFLICT`, e em bloco uma colisão levaria as outras junto. A inserção tenta em
bloco primeiro e só cai para linha a linha quando o bloco falha.

Resposta:

```json
{ "ok": true, "recebidos": 500, "criados": 12, "atualizados": 31, "reativados": 0,
  "inalterados": 455, "recusados": [ { "cnpj": "…", "motivo": "nome_em_uso" } ] }
```

`nome_em_uso` é o caso acima: a grafia que veio já pertence a outro cliente ativo. Não é
pane, é dois cadastros discordando — e a resposta diz qual CNPJ para alguém resolver.

O mesmo vale no `vincular_conversa`: quando o CNPJ bate exato e o nome difere, corrigimos
na hora, sem esperar o próximo lote. Se a correção colidir, ela é ignorada e o vínculo
acontece assim mesmo — ficar sem vincular por causa de grafia devolveria o técnico para a
escolha manual, que é o problema maior.

---

## O que o DoctorSaaS pode mandar junto na URL

```
/conectar?conv=<id>&nome=<nome do contato>&cnpj=<cnpj do cliente>
```

**`cnpj` resolve o cliente.** A janelinha roda na sessão do próprio técnico, então o RLS
já recorta o cadastro dele — dar o CNPJ na URL é o suficiente para ela achar o cliente
sozinha, sem chamada de API nenhuma. Aceita com ou sem pontuação; guardamos só os
dígitos, e 14 ou 11 (CPF).

`nome` nunca resolve nada — só pré-preenche o cadastro. Quem manda no cliente do
atendimento continua sendo o vínculo gravado.

### A ordem em que a janelinha resolve

1. **Vínculo gravado** para esta conversa. Ganha de tudo: é escolha explícita de técnico.
2. **`cnpj` da URL** — CNPJ exato, depois a raiz de 8 dígitos. Mesma regra do servidor.
   Não grava nada: vale para este atendimento, e o técnico promove a vínculo permanente
   se quiser.
3. **Escolha manual**, com o que sabemos em destaque: "o DoctorSaaS diz que esta conversa
   é X · CNPJ" mais um botão de cadastrar já preenchido.

Várias unidades do mesmo grupo e nenhuma com o CNPJ exato caem no passo 3 de propósito —
chutar filial manda o técnico para as máquinas da unidade errada.

### Por que isto dispensa a chamada de API no caminho feliz

No fluxo desenhado pelo DoctorSaaS, a consulta prévia tem os dois ramos terminando no
mesmo lugar: existe → abre a janelinha; não existe → abre a janelinha, que oferece
cadastrar. A consulta não muda o que acontece depois. Com o CNPJ na URL a janelinha
decide sozinha, na mesma latência, sem chave e sem round-trip.

`vincular_conversa` com `criar: false` continua valendo para quem quiser a resposta do
lado de lá — por exemplo, para mostrar um selo "cliente no AcessoFast" na tela deles.

---

## Mandar mensagem de volta para o chat

A janelinha nao alcanca a conversa. O unico canal e o `postMessage` para quem abriu a
janela:

```js
// o AcessoFast dispara
window.opener.postMessage({ tipo: "acessofast:enviar_mensagem", texto }, "*")
```

Do lado do DoctorSaaS, um listener **escreve** esse `texto` no campo de mensagem da
conversa aberta. Quem envia é o operador:

```js
window.addEventListener("message", (e) => {
  if (e.source !== janelaQueAbri) return                       // é a nossa janelinha
  if (e.origin !== "https://app.acessofast.com.br") return     // e veio do painel
  if (e.data?.tipo !== "acessofast:enviar_mensagem") return
  preencherCampoDeMensagem(e.data.texto)
})
```

As duas primeiras linhas não são opcionais. `postMessage` pode partir de qualquer página
que tenha referência à janela deles, e `window.open` entrega `window.opener` de graça —
sem a checagem, um site qualquer manda WhatsApp para o cliente em nome da empresa.

**Escrever e não enviar** foi decisão conjunta com o time do DoctorSaaS. O texto é de
instalação, mas um sistema de fora disparando mensagem sem ninguém ler é o tipo de coisa
que só se descobre depois de sair errada, e a diferença de tempo é um Enter. Por isso o
botão aqui se chama **Escrever no chat** e confirma com "Feito", não com "Enviado" — nós
não temos como saber se saiu.

Sem o listener nada acontece e o "Copiar instruções" continua sendo a saída — o botão
apenas avisa quando a janela não veio de um chat.

O `targetOrigin` do nosso lado é `"*"` porque não sabemos de que domínio a janela foi
aberta, e o conteúdo é público. Quem tem segredo a proteger na direção contrária é o
listener, e é lá que a checagem mora.

---

## Atendimento sem empresa

Nem todo contato do DoctorSaaS tem empresa vinculada — parte do time trabalha com números
avulsos. A janelinha oferece duas saídas, e a diferença entre elas é o que fica gravado:

**Não é empresa** — cadastra um cliente só com o nome, sem CNPJ. O vínculo da conversa
passa a existir normalmente e ela é lembrada nas próximas vezes. Sem CNPJ não há
agrupamento de filiais, e é só isso que se perde.

**Ver todas as máquinas** — não grava nada. Lista todas as máquinas ativas do tenant com
busca por apelido, ID ou cliente, online primeiro, com teto de 40 na tela para a janela de
520px não travar. Vale só para o atendimento atual: na próxima abertura a conversa
pergunta de novo, que é o certo para um número avulso.

---

## Cadastrar computador pela janelinha

Não existe "criar máquina": o agente precisa estar instalado e ter se anunciado. O que o
botão faz é **adotar** esse anúncio (`adopt-device`) já vinculado ao cliente da conversa,
com apelido opcional. Por isso o campo é o ID que aparece na tela do cliente.

O botão "Abrir download" saiu: o texto copiado já leva o link, e abrir a página de
download na máquina do **técnico** não ajuda quem precisa instalar e está do outro lado da
conversa.

---

## O timing do popup

O `window.open` precisa ser síncrono no clique, sem `await` antes, ou o navegador bloqueia.
Então o DoctorSaaS não consegue chamar a API e *depois* abrir a janela.

A janelinha lida com os dois casos: lê o vínculo e, não achando, espera 300 ms + 600 ms
antes de cair na escolha manual. Se o DoctorSaaS chamar ao abrir a conversa, a espera nunca
acontece; se chamar no clique, ela cobre a corrida.

---

## O que a chave ainda não resolve

O vínculo é entre **sistemas**, não entre contas. Nada garante que o técnico logado no
DoctorSaaS é o mesmo logado no AcessoFast — quem decide o que a janelinha enxerga continua
sendo a sessão do AcessoFast naquele navegador.

Consequência prática: não dá para responder "qual atendente do DoctorSaaS disparou este
acesso remoto". O `created_by` do vínculo e o log de sessão só enxergam o lado de cá. Não é
buraco de segurança — é buraco de rastreabilidade, e vale saber que existe antes de alguém
pedir esse relatório.
