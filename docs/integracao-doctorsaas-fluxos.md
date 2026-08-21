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
{ "acao": "vincular_conversa", "conv": "<id da conversa>",
  "empresa": { "nome": "…", "cnpj": "…", "telefone": "…" } }
```

CNPJ exato → raiz (8 dígitos) → cria o cliente. Depois grava em
`doctorsaas_conversation_links`.

Devolve `{"vinculado": false, "motivo": "varias_unidades"}` quando o grupo tem mais de uma
unidade e nenhuma com o CNPJ exato. É o único caso em que não vinculamos: escolher uma
seria chute, e chute errado manda o técnico para as máquinas da filial errada.

### `sincronizar_clientes`

```json
{ "acao": "sincronizar_clientes", "clientes": [ { "nome": "…", "cnpj": "…" } ] }
```

Teto de 500 por chamada. **Só cria o que falta** — nunca sobrescreve cadastro existente,
porque o nome daqui pode ter sido corrigido à mão e a importação não tem como saber qual
dos dois está certo.

---

## O que o DoctorSaaS pode mandar junto na URL

```
/conectar?conv=<id>&nome=<nome do contato>
```

`nome` e opcional e so pre-preenche o cadastro quando o contato nao tem empresa.
Nunca decide nada — quem manda no cliente do atendimento e o vinculo gravado.

---

## Mandar mensagem de volta para o chat

A janelinha nao alcanca a conversa. O unico canal e o `postMessage` para quem abriu a
janela:

```js
// o AcessoFast dispara
window.opener.postMessage({ tipo: "acessofast:enviar_mensagem", texto }, "*")
```

Do lado do DoctorSaaS, um listener posta esse `texto` na conversa aberta:

```js
window.addEventListener("message", (e) => {
  if (e.data?.tipo === "acessofast:enviar_mensagem") enviarMensagem(e.data.texto)
})
```

Sem o listener nada acontece e o "Copiar instruções" continua sendo a saída — o botão
"Enviar no chat" apenas avisa que a janela não veio de um chat.

O `targetOrigin` é `"*"` porque não sabemos de que domínio a janela foi aberta. O
conteúdo é o texto de instalação; não há segredo trafegando.

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
