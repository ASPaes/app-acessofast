# Botão "Conectar" — DoctorSaaS ↔ AcessoFast

Documento para o time do DoctorSaaS.

---

## Em uma frase

O técnico clica em **Conectar** dentro da conversa e abre uma janelinha do AcessoFast
já com as máquinas daquele cliente, pronta para acessar remotamente.

---

## O que vocês precisam fazer

**Uma coisa só: um botão que abre uma URL numa janela.**

Vocês **não** precisam de:

- chamar API nenhuma
- token, login ou OAuth
- saber o que é plano, crédito ou cobrança
- tratar erro de "sem saldo", "conta bloqueada", etc.
- lidar com o protocolo `acessofast://`

Tudo isso já está pronto e funcionando do lado do AcessoFast. Vocês só abrem a janela.

---

## O código

Troque `PAINEL` pelo endereço do painel do AcessoFast:

```js
const PAINEL = "https://COLOQUE-AQUI-O-ENDERECO-DO-PAINEL";

function abrirAcessoFast(conversationId) {
  window.open(
    `${PAINEL}/conectar?conv=${encodeURIComponent(conversationId)}`,
    "acessofast",
    "width=520,height=640",
  );
}
```

E o botão, no cabeçalho da conversa:

```jsx
<button type="button" onClick={() => abrirAcessoFast(conversa.id)}>
  Conectar
</button>
```

Pronto. É isso.

---

## O identificador da conversa (`conv`)

Pode ser **qualquer identificador que vocês já tenham** para a conversa. Não precisa ser
CNPJ, não precisa ser número, não precisamos combinar formato.

Só precisa de duas coisas:

1. **Não mudar entre sessões.** Se o técnico fechar e abrir o chat amanhã, tem que ser o mesmo.
2. **Até 200 caracteres.**

UUID, id do banco, slug — qualquer um serve.

---

## 3 cuidados que evitam dor de cabeça

### 1. Chame `window.open` direto no clique

O navegador só permite abrir janela como resposta imediata a um clique. Se tiver
qualquer `await` antes, ele **bloqueia como popup**.

```js
// ERRADO — o navegador bloqueia
onClick={async () => {
  await salvarAlgo();
  window.open(url, "acessofast", "width=520,height=640");
}}

// CERTO — abre primeiro, faz o resto depois
onClick={() => {
  window.open(url, "acessofast", "width=520,height=640");
  salvarAlgo();
}}
```

### 2. Não use `<iframe>`

Não dá para embutir a tela dentro da página do DoctorSaaS. O login do AcessoFast fica
guardado no navegador, e quando o site está dentro de um iframe de outro domínio o
navegador **isola esse armazenamento**. O técnico apareceria como deslogado, mesmo
estando logado.

Tem que ser **janela separada**. Guia nova também funciona, mas a janelinha é melhor
porque o técnico continua vendo a conversa atrás.

### 3. Mantenha o nome `"acessofast"` na janela

Aquele segundo parâmetro do `window.open` é o nome da janela. Mantendo o mesmo nome,
clicar de novo **reaproveita a mesma janelinha** em vez de encher a tela de janelas.

---

## O que o técnico vai ver

**Primeira vez naquela conversa:**

```
clica Conectar → "Qual cliente é esta conversa?" → escolhe → lista de PCs → conecta
```

**Da segunda vez em diante, na mesma conversa:**

```
clica Conectar → lista de PCs → conecta
```

A tela de escolher cliente **some para sempre** naquela conversa. O AcessoFast grava o
vínculo na primeira vez.

Cada conversa é lembrada separadamente. Com o tempo, quase ninguém mais vê a tela de
busca — ela vira exceção, só para cliente novo.

Se alguém vincular o cliente errado, existe um botão **"Trocar cliente"** na própria
tela para corrigir.

Quando a conexão é disparada, a janelinha **fecha sozinha**.

---

## Pré-requisitos (do lado do técnico)

- Estar **logado nos dois portais**, no mesmo navegador.
- Ter o **cliente AcessoFast instalado** na máquina dele. É o programa que registra o
  `acessofast://` no Windows — sem ele, nada abre. A tela avisa quando isso acontece.

---

## Como testar

Não precisa esperar o botão ficar pronto. Cole o endereço direto no navegador:

```
https://COLOQUE-AQUI-O-ENDERECO-DO-PAINEL/conectar?conv=teste-123
```

Estando logado no painel do AcessoFast, deve aparecer a tela de escolher o cliente.
Se aparecer, a integração inteira já funciona — o botão é só o atalho.

---

## Prompt para colar na IA (Lovable, Cursor, Copilot, Claude)

Se forem gerar o botão com IA, este prompt basta:

```
No cabeçalho da conversa do chat, adicione um botão "Conectar".

Ao clicar, ele deve abrir uma janela popup com esta URL:
  https://COLOQUE-AQUI-O-ENDERECO-DO-PAINEL/conectar?conv=<ID_DA_CONVERSA>

Onde <ID_DA_CONVERSA> é o identificador estável da conversa aberta,
passado com encodeURIComponent.

Use exatamente:
  window.open(url, "acessofast", "width=520,height=640")

Regras importantes:
- Chame window.open DIRETAMENTE dentro do onClick, sem nenhum await antes,
  senão o navegador bloqueia o popup.
- NÃO use iframe nem modal embutido: precisa ser janela separada, senão a
  sessão do outro sistema não é reconhecida.
- Mantenha o nome "acessofast" na janela, para reaproveitar a mesma janela
  em cliques seguintes.
- Não faça nenhuma chamada de API. O botão só abre a URL.
```

---

## Comandos

Não há dependência para instalar nem serviço para configurar. O fluxo normal de vocês:

```bash
git checkout -b feat/botao-conectar-acessofast
# implementar o botão
git add .
git commit -m "feat: botao Conectar abre o AcessoFast na conversa"
git push -u origin feat/botao-conectar-acessofast
```

---

## Se algo der errado

| O que aparece | O que é |
|---|---|
| "Você precisa estar logado no painel do AcessoFast" | O técnico não está logado no AcessoFast **naquele navegador**. Ou vocês usaram iframe (veja o cuidado 2). |
| "Esta janela precisa ser aberta pelo botão Conectar" | A URL foi aberta sem o `?conv=`. |
| A janela não abre | Popup bloqueado — quase sempre é o `await` antes do `window.open` (cuidado 1). |
| Aparece a busca de cliente toda vez | O `conv` está mudando a cada abertura. Ele precisa ser estável. |
| A máquina não aparece na lista | A máquina não está vinculada a nenhum cliente no cadastro do AcessoFast. É ajuste de cadastro do nosso lado, não da integração. |
| Clica em "Abrir conexão" e nada acontece | O cliente AcessoFast não está instalado na máquina do técnico. |

---

## Resumo

| Quem | O que faz |
|---|---|
| **DoctorSaaS** | Um botão que abre `/conectar?conv=<id>` numa janela. Nada além disso. |
| **AcessoFast** | Lista as máquinas, valida plano/quota/saldo, cobra e abre a conexão. Já pronto. |
