# AcessoFast — preview do redesign (FASE 1)

Proposta visual completa e navegável do novo AcessoFast, **isolada do aplicativo real**.
Nada aqui é importado pelo app; nada do app é importado aqui.

---

## Como rodar

A partir da **raiz do repositório** (`app-acessofast/`):

```bash
# desenvolvimento
bunx vite --config redesign-preview/vite.config.ts

# build de produção do preview
bunx vite build --config redesign-preview/vite.config.ts

# servir o build
bunx vite preview --config redesign-preview/vite.config.ts
```

URL local: **http://localhost:5199/**

> Não há `bun install` para este projeto. Ele reaproveita o `node_modules` já
> instalado na raiz (React 19, Radix UI, lucide-react, recharts, Tailwind v4,
> Vite) pela resolução ascendente do Node. Nenhuma dependência nova foi
> adicionada ao `package.json` do app.

### Verificação

```bash
# tipos
bunx tsc -p redesign-preview/tsconfig.json --noEmit

# renderização de todas as telas × papéis × estados (95 casos)
cd redesign-preview && bun scripts/smoke.tsx

# contraste WCAG de todas as combinações de cor (lê tokens.css direto)
cd redesign-preview && bun scripts/contraste.mjs
```

---

## Navegação

O preview usa rotas por hash, com **os mesmos caminhos do app real**:

| Rota               | Tela                                     |
| ------------------ | ---------------------------------------- |
| `#/dashboard`      | Visão geral                              |
| `#/dispositivos`   | Dispositivos (lista / grade / agrupado)  |
| `#/clientes`       | Clientes                                 |
| `#/auditoria`      | Auditoria (por máquina / todas)          |
| `#/usuarios`       | Usuários                                 |
| `#/financeiro`     | Financeiro                               |
| `#/monitoramento`  | Monitoramento                            |
| `#/configuracoes`  | Configurações                            |
| `#/empresas`       | Empresas (super_admin)                   |
| `#/planos`         | Planos (super_admin)                     |
| `#/auth`           | Login                                    |
| `#/definir-senha`  | Definir senha (3 estados)                |
| `#/404` · `#/erro` | Página não encontrada · Erro             |
| `#/design-system`  | Referência do design system (só preview) |

### Painel "Preview" (canto inferior direito)

Existe **apenas no preview**. Permite trocar sem backend:

- **Papel**: super_admin · admin · supervisor · técnico
- **Estado dos dados**: normal · carregando · vazio · erro
- **Faixa de cobrança**: teste ativo · teste expirado · vencendo · pendente · suspenso
- **Densidade**: confortável (52 px) · compacta (44 px)
- **Fundo animado**: ligado (constelação) · desligado (só as manchas)

---

## Estrutura

```
redesign-preview/
├─ index.html
├─ vite.config.ts            # config própria; nenhum plugin do app real
├─ tsconfig.json             # alias @preview/*
├─ package.json              # só documenta scripts (sem deps próprias)
├─ public/logo.png           # favicon
├─ docs/capturas/            # PNGs das telas principais
├─ scripts/
│  ├─ smoke.tsx             # renderiza todas as telas via react-dom/server
│  └─ contraste.mjs         # confere WCAG lendo tokens.css (sai 1 se reprovar)
└─ src/
   ├─ main.tsx  ·  App.tsx
   ├─ assets/logo.png        # logo real (cópia de public/favicon.png do app)
   ├─ styles/
   │  ├─ tokens.css          # ← fonte única de cor/raio/sombra/duração/z-index
   │  └─ app.css             # ponte tokens → utilitários Tailwind v4 + base
   ├─ lib/                   # cx · format (datas, moeda, documento) · router · brand
   ├─ data/
   │  ├─ mock.ts             # TODOS os dados simulados, centralizados
   │  └─ preview-state.tsx   # papel/estado/densidade (só preview)
   ├─ components/
   │  ├─ ui/                 # design system
   │  │  ├─ button.tsx       # Button (5 variantes) · IconButton
   │  │  ├─ badge.tsx        # Badge · StatusBadge · Dot
   │  │  ├─ viz.tsx          # cor categórica de métrica · VizIcon
   │  │  ├─ panel.tsx        # Panel · PanelHeader/Body/Footer · Divider
   │  │  ├─ field.tsx        # Field · Input · Select · Textarea · SearchField
   │  │  │                   # PasswordField · Switch · Checkbox · RadioGroup
   │  │  ├─ overlay.tsx      # Modal · ConfirmDialog · Dropdown · Tooltip · Popover
   │  │  ├─ table.tsx        # TableWrap · Table · THead/TH/TBody/TR/TD · Truncate
   │  │  ├─ states.tsx       # Skeleton · EmptyState · ErrorState · Alert · Progress
   │  │  └─ page.tsx         # PageHeader · Toolbar · Segmented · StatStrip · Section
   │  ├─ domain/device-bits.tsx   # DeviceStatus · DeviceGlyph · MarkerChip · ConsumoBadge
   │  └─ shell/              # sidebar · topbar · billing-banner
   │                         # ambient (manchas + granulado) · particles (constelação)
   │                         # preview-controls (só preview)
   └─ screens/               # uma por tela existente do app
```

---

## Direção de design

**Dark-first, azul, sem tema claro.** O painel é ferramenta de plantão: superfícies
azuladas escuras, nunca preto absoluto, nunca branco puro.

### Fundo atmosférico

O fundo **não é uma chapa sólida**. `components/shell/ambient.tsx` empilha três
camadas fixas atrás do conteúdo:

1. **Manchas azuis** — `radial-gradient` grandes e muito diluídos, um brilho
   horizontal abaixo da barra superior e uma vinheta que escurece as bordas.
   São gradientes, **não** `<div>` com `filter: blur()`: o resultado visual é o
   mesmo, sem custo de GPU e sem repintar a cada scroll.
2. **Constelação** (`components/shell/particles.tsx`) — a mesma animação de
   pontos e ligações do login do AcessoFast, agora como textura do painel.
3. **Granulado** de ~3,5%. Não é enfeite: degradês escuros de baixo contraste
   produzem _banding_ (faixas visíveis) em telas de 8 bits, e o ruído quebra
   essas faixas.

Todas são `fixed` + `pointer-events-none`: não entram no fluxo, não capturam
clique e não rolam com o conteúdo. Cobrem **apenas o shell do painel** — a tela
de login tem o fundo próprio dela e não foi alterada.

#### Sobre a constelação

Duas diferenças em relação ao login:

- **Sem interação de mouse.** No login o campo de pontos foge do cursor. Aqui
  não: o painel é ferramenta de trabalho, e um fundo que se mexe junto com o
  ponteiro rouba atenção de quem está lendo uma tabela de 200 linhas.
- **Desfocada.** O canvas é desenhado nítido em um buffer fora de tela e
  composto **uma única vez** com blur no canvas visível.

Ponto e linha são desenhados maiores e mais opacos que no login de propósito:
depois de reduzir a resolução e aplicar o blur, um ponto de 1,6 px some. O que
se vê no fim tem a presença do original — só que fora de foco.

#### Custo — leia antes de mexer no `particles.tsx`

A primeira versão **travava a interface**. O culpado não era a quantidade de
partículas nem a matemática das ligações: era `ctx.filter`, que o canvas 2D
aplica **a cada operação de desenho**. Com ~80 pontos, o laço emitia mais de mil
`stroke()` por quadro e cada um passava por um blur próprio.

|       | operações de desenho por quadro                                      |
| ----- | -------------------------------------------------------------------- |
| antes | ~1.500 `stroke()` filtrados + 80 `fill()` filtrados ≈ **1.580**      |
| agora | 5 `stroke()` + 1 `fill()` nítidos + 1 `drawImage()` filtrado = **7** |

As 5 linhas vêm de agrupar as ligações em 5 faixas de opacidade: em vez de um
`stroke()` por segmento (cada um com o seu alpha), monta-se um caminho por faixa
e traça-se uma vez. A perda de precisão no degradê é invisível depois do blur.

Somam-se a isso: canvas a 50% da resolução (4× menos pixels), 15 fps (é fundo),
pausa quando a aba perde o foco e um quadro estático — sem loop — quando o
sistema pede `prefers-reduced-motion`.

**Para medir na sua máquina**, abra com `?perf=1`:

```
http://localhost:5199/?perf=1#/dashboard
```

Aparece um contador de milissegundos por quadro no canto inferior esquerdo. O
painel de preview também tem **Fundo animado: ligado/desligado**, para comparar
a sensação com e sem a constelação.

#### Sidebar e barra superior translúcidas

As duas são **translúcidas**, não opacas: a constelação e as manchas atravessam,
e a moldura do painel parece recortada do próprio fundo. O que as separa não é a
opacidade — é o tingimento levemente mais escuro somado à borda (`border-line`,
não `border-line-subtle`).

A diferença técnica entre as duas está no `backdrop-blur`:

- **Sidebar: sem blur.** Atrás dela só passa a camada ambiente, que já é
  desfocada. Blur ali seria custo de GPU sem ganho visual.
- **Barra superior: com blur.** Não por estilo — a tabela rola por baixo dela.
  Sem o borrão, o texto do conteúdo apareceria fantasma através do cabeçalho.
  `blur-xl` (24 px) sobre 60% de tinta escura reduz uma linha de tabela a um
  borrão sem forma, que é exatamente o necessário.

Os painéis ganharam sombra média e um fio de luz interno na borda
(`ring-inset`), o que faz a elevação ler sem recorrer a vidro fosco.

#### Acabamento dos painéis: por que o vidro é opaco

O painel de preview tem **Acabamento dos painéis: Vidro / Sólido**
(`data-painel` no `<html>`). O modo vidro é o padrão.

A primeira versão do vidro era translúcida de verdade, e a constelação
atravessava os blocos de informação. Atrapalhava a leitura. A tentativa óbvia —
baixar a transparência até as bolinhas sumirem — não funciona, e dá para provar.
Medindo a composição ponto a ponto num viewport de 1920×1080:

| O que atravessa o painel     | Amplitude em RGB |
| ---------------------------- | ---------------- |
| uma bolinha da constelação   | (56, 74, 92)     |
| a mancha azul da atmosfera   | (6, 11, 23)      |

A bolinha é **~4× mais forte** que o degradê que ela acompanha. Como as duas
passam pelo mesmo canal (a opacidade do painel), não existe ponto de corte que
segure uma e deixe passar a outra: a 90% a bolinha ainda chega com 9 níveis
— visível, ainda mais em movimento, que a visão detecta melhor que contraste
estático — enquanto a mancha já caiu para 2, ou seja, invisível. A transparência
deixa de ser um recurso útil nesse ponto.

A solução é fechar o painel numa cor opaca que seja **exatamente a média medida
do que ele já mostrava** (`--af-glass`, `--af-glass-2`, `--af-glass-head`). O
painel continua com a mesma cor; o que some é só a constelação por dentro. O
caráter de vidro passa a vir da física da luz — aresta de cima acesa, brilho de
topo, raio de 18 px e sombra macia — que é como vidro fosco sobre fundo
movimentado se comporta na prática: o que está atrás vira borrão sem detalhe.

Dois efeitos colaterais, ambos bons:

- **Nenhum `backdrop-filter` sobrou na área de conteúdo.** O cabeçalho de tabela
  grudado no topo precisava de `blur(8px)` só para esconder a constelação; agora
  é opaco. Cada `backdrop-filter` recalcularia a cada repintura do fundo — foi
  essa a causa do travamento que apareceu antes.
- **O contraste melhorou.** As superfícies de vidro são mais escuras que
  `--af-surface`, então o texto discreto sobe de 6,07:1 para 6,47:1. E, por
  serem opacas, entraram no `scripts/contraste.mjs` como qualquer outra
  superfície — enquanto eram translúcidas, o contraste dependia do ponto da tela
  e nenhuma verificação automática dava conta.

A faixa de cobrança tinha o mesmo defeito por outra causa: a tinta de estado é
12% de opacidade por definição (`--af-*-soft`), então a constelação passava por
trás do texto do aviso. A tinta passou a ser pintada **sobre** uma base opaca
(`.af-faixa` + `--af-tinta`) — mesma cor final, sem as bolinhas atrás. Vale nos
dois acabamentos: aviso de cobrança precisa ser legível sempre.

> Se as manchas de `ambient.tsx` mudarem, os três `--af-glass*` precisam ser
> remedidos — eles são a média daquela composição, não valores escolhidos a olho.

### Ajustes de paleta (e por quê)

A paleta inicial do briefing foi refinada — o próprio briefing prevê isso para
contraste e consistência. Cada mudança tem um motivo verificável:

| Token                 | De        | Para      | Motivo                                                                                                                                                                                 |
| --------------------- | --------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--af-surface`        | `#0F1726` | `#101E37` | rampa toda no matiz ~219° (o mesmo do azul da marca). A ~45% de saturação os painéis liam como cinza sujo ao lado do brilho azul do fundo                                              |
| `--af-surface-2`      | `#121D30` | `#142543` | idem                                                                                                                                                                                   |
| `--af-surface-raised` | `#172238` | `#192D52` | idem                                                                                                                                                                                   |
| `--af-surface-hover`  | `#1B2942` | `#1C3157` | idem, mas segurado: é a superfície mais clara e é ela que limita o texto discreto                                                                                                      |
| `--af-text-muted`     | `#7F8CA3` | `#909DB3` | com as superfícies mais azuis caía para 4,02:1 sobre modal — abaixo do mínimo AA                                                                                                       |
| `--af-primary`        | `#2F6BFF` | `#2C67FA` | texto branco dava 4,498:1: passava **raspando por baixo** de 4,5:1                                                                                                                     |
| `--af-primary-hover`  | `#4585FF` | `#1D54E0` | o hover clareava e derrubava o texto do botão para 3,47:1 — reprovado justo no estado em que a pessoa vai clicar. Agora escurece, como o painel atual já faz com `hover:bg-primary/90` |

Nada disso foi estimado a olho: `bun scripts/contraste.mjs` lê o `tokens.css`
e calcula todas as combinações de texto × superfície, mais o botão primário em
repouso e em hover. Ele sai com código 1 se alguma ficar abaixo de 4,5:1 — então
mexer numa cor e esquecer de conferir é o único jeito de passar batido.

Quem dita o limite do `--af-text-muted` é a **superfície mais clara** da rampa:
se `--af-surface-hover` ou `--af-surface-raised` subirem um dia, esse token sobe
junto.

### O que mudou de estrutura (não é troca de cor)

| Antes                                                     | Agora                                                                                          |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Tudo dentro de `Card`, inclusive filtros e contadores     | Três camadas: **cabeçalho de página** → **toolbar** → **painel de conteúdo**                   |
| 8 controles espremidos no `CardHeader` de Dispositivos    | Toolbar própria, agrupada por função: **buscar \| filtrar \| visualizar**                      |
| 3 botões de ícone soltos para trocar de visão             | Controle segmentado com `role="radiogroup"`                                                    |
| Contadores online/atendimento/offline num card à parte    | `StatStrip` — faixa dividida, mesma altura da carteira ao lado                                 |
| Cabeçalho de tabela com o mesmo peso do corpo             | Cabeçalho fixo (`sticky`), 11,5 px, caixa alta, superfície secundária                          |
| Cor de estado e cor de métrica misturadas na mesma escala | Dois vocabulários separados: **semântico** (online/erro/aviso) e **categórico** (`--af-viz-*`) |
| Gatilho de recolher a sidebar na barra superior           | Rodapé da sidebar, com rótulo, tooltip e `aria-expanded`                                       |
| Partículas animadas atrás do login                        | Malha estática + dois halos azuis; sem animação permanente                                     |
| Estados vazios como uma linha de texto cinza              | `EmptyState` com ícone, causa e a ação que resolve                                             |

### Regras aplicadas

- **Escala de 4 px** em todo espaçamento; raios de 6/8/12/14/18 px.
- **Numerais tabulares** em toda coluna numérica, ID, duração e métrica.
- **Estado nunca é só cor**: todo indicador tem ponto **e** rótulo textual.
- **Caixa alta** só em labels de categoria (`.af-eyebrow`), nunca em texto corrido.
- **Sombras discretas**: profundidade vem da variação de superfície.
- **Gradiente** apenas em detalhes de 2 px (topo de modal, cartão de login).
- **Animações** de 140 ms (hover), 180 ms (menu), 200 ms (modal), todas
  neutralizadas por `prefers-reduced-motion`.
- **Foco de teclado** sempre visível (`:focus-visible` com anel azul de 2 px).
- **Botão só com ícone** exige `label` obrigatório → vira `aria-label` + `title`.
- **Rolagem horizontal** fica contida no wrapper da tabela; o corpo da página
  nunca rola na horizontal.

---

## Fidelidade ao app atual

Foram preservados, tela a tela: nomes de página, nomes de menu, agrupamentos da
sidebar (Operação / Gestão / Plataforma), colunas, filtros, switches, modos de
visualização, ações, textos de modal, mensagens de erro, papéis e as regras de
visibilidade por papel.

**Nada foi inventado**: nenhuma página, métrica, gráfico, coluna ou ação nova.
Os dados de `src/data/mock.ts` espelham os campos que o painel já lê hoje
(`address_book`, `clients`, `tenants`, `profiles`, `connection_logs`,
`credit_ledger`, `plans`, `credit_packages`, `vps_metrics`, `v_agent_health`,
`v_sessions_summary`, `v_external_access`).

Única página adicional: `#/design-system`, que é **material de apoio do preview**
e não faz parte do produto.

### Dois vocabulários de cor

Um erro comum é misturar os dois numa escala só. Aqui eles são separados:

- **Semântico** (`badge.tsx`) — comunica **estado**: online é verde, em
  atendimento é âmbar, offline é cinza, erro é vermelho. Sempre com ponto **e**
  rótulo, nunca só cor.
- **Categórico** (`viz.tsx`, tokens `--af-viz-*`) — apenas **identifica** a
  métrica: usuários azul, dispositivos verde, sessões ativas âmbar, sessões 24h
  violeta, CPU/grátis hoje ciano, créditos verde-limão. É o que o painel atual
  já faz, e é o que permite reencontrar "Disco" ou "Créditos" na visão
  periférica antes de ler o rótulo.

#### Como os seis tons foram escolhidos

Não por gosto. O que decide se a codificação por cor funciona é a **menor**
distância perceptual entre dois tons quaisquer do conjunto — é nesse par que a
pessoa erra, e um par ruim estraga o conjunto inteiro. Medido em **CIEDE2000**,
não ΔE76: ΔE76 superestima diferença na região azul e subestima na amarela,
exatamente as duas pontas deste caso.

A paleta herdada do painel atual (que usa as cores de fábrica do Tailwind) tinha
três pares abaixo do limiar de confusão de ~15 para um ícone de 16 px:

| Par                            | Antes | Depois | O que mudou                     |
| ------------------------------ | ----- | ------ | ------------------------------- |
| Sessões ativas × Créditos      | 4,4   | 26,9   | créditos: amarelo → verde-limão |
| Usuários × Grátis hoje         | 8,0   | 29,8   | grátis hoje: azul-céu → ciano   |
| Usuários × Sessões 24h         | 14,4  | 19,9   | sessões 24h: violeta mais claro |
| **menor do conjunto**          | **4,4** | **19,8** | (o par mais próximo hoje é dispositivos × créditos) |

Créditos ficou **verde-limão e não rosa** por um motivo de significado, não de
estética: o rosa que a otimização também aceitava fica a ΔE00 10,9 do vermelho
de erro. Num painel de cobrança, um ícone de Créditos que lê como alarme é
armadilha. O verde-limão fica a 69,9 do vermelho e ainda casa com "saldo".

`bun scripts/contraste.mjs` agora verifica as duas coisas: contraste de cada tom
contra a superfície (eles também aparecem como texto pequeno) **e** a separação
mínima entre tons. Contraste sozinho não pegaria o problema — âmbar e amarelo
tinham 10:1 e 9:1 contra o fundo e ainda assim eram indistinguíveis entre si.

Uma métrica tem **uma** cor em todas as telas. "Sessões ativas" era âmbar na
Visão geral e violeta em Dispositivos; ficou âmbar nas duas. Métrica com duas
cores obriga a ler o rótulo, que é justamente o que a cor deveria evitar.

O "Em atendimento" permanece **âmbar**, como no painel atual: a versão azul foi
testada e descartada porque competia com a marca e com o botão Conectar. Pelo
mesmo motivo o **Conectar** é azul sólido (`primary`), inclusive repetido linha
a linha — é o botão que o técnico procura sem ler.

### Decisões que mudam posição de elemento (para sua avaliação)

1. O gatilho de recolher a sidebar saiu da barra superior para o rodapé da
   sidebar. Continua visível, rotulado e acessível por teclado.
2. **O selo "ao vivo" do cabeçalho da Visão geral foi retirado, a pedido.**
   Registro aqui porque esse selo **existe no painel atual** e a regra 25 diz
   para não remover informação das telas — foi pedido explicitamente, então é
   decisão consciente e não descuido. O selo "ao vivo · há Ns" do painel do
   relay continua: aquele informa se o coletor está respondendo, é estado e não
   enfeite.
3. Nada mais. Cores de estado e o botão Conectar seguem o padrão atual.

Todas são reversíveis em um ponto único do código.

### Zebrado das listas

Linhas alternadas em todas as tabelas do painel, de uma regra só em
`app.css` — nenhuma tela precisa saber que o zebrado existe.

**Intensidade: 2,5% de branco.** Não foi escolhida a olho; três exigências
puxam para lados opostos e a terceira é que define o teto:

| Alfa | Δ faixa vs linha | Texto discreto na faixa | Δ hover vs faixa |
| ---- | ---------------- | ----------------------- | ---------------- |
| 1,5% | ~3,4 (some)      | 5,85:1                  | ~7               |
| **2,5%** | **~5,6 (lê bem)** | **5,67:1**          | **~6**           |
| 3,5% | ~8,0             | 5,53:1                  | ~2 (hover some)  |

A partir de ~3,5% o hover deixa de ser mais forte que a faixa e o "estou nesta
linha" desaparece justo nas pares. Por ser branco translúcido, funciona igual
nos acabamentos vidro e sólido. Há cerca de um degrau de folga se você quiser a
faixa mais marcada.

#### A parte que quase deu errado: camadas de cascata

A primeira versão da regra ficou solta no arquivo, e eu documentei um raciocínio
de especificidade que estava **errado**:

```
tbody tr:nth-child(even)   -> (0,1,2)
.hover\:bg-…:hover         -> (0,2,0)
```

Especificidade só é comparada **dentro da mesma camada**. O Tailwind v4 declara
`@layer theme, base, components, utilities` e põe toda utilidade em `utilities`;
regra fora de camada ganha de qualquer camada, por mais específica que a outra
seja. Solta, a faixa vencia o hover.

Corrigido movendo a regra para dentro de `@layer base`: `base` vem antes de
`utilities`, então hover e estados de seleção ganham por ordem de camada, sem
`!important` e sem depender de ordem de importação.

#### Linha expansível (Auditoria)

A linha de detalhe é um `<tr>` irmão, então entra na contagem do `nth-child` e
deslocaria a faixa, deixando duas listras coladas na emenda. Ela recebe
`af-linha-detalhe` e compartilha o fundo da linha aberta: o par lê como **um**
bloco e a alternação segue correta depois dele. Verificado linha a linha no DOM.

### A única mudança que encosta numa consulta — precisa do seu aval

A Visão geral terminava a 743px de uma janela de 985px: **242px de fundo vazio**,
um quarto da altura útil, logo abaixo do único bloco que responde "o que está
acontecendo agora". A causa é o `.limit(6)` da consulta de dispositivos
recentes — a tela tem espaço para mais do conteúdo que ela existe para mostrar.

O preview usa **10 linhas** e a sobra cai para 34px. Aplicar isso na FASE 2
significa trocar `.limit(6)` por `.limit(10)` em
`src/routes/_authenticated/dashboard.tsx`. É tamanho de página, não regra de
negócio: mesma tabela, mesma ordenação, mesmo endpoint, mesmo "Ver todos". Ainda
assim é a única alteração proposta que sai do CSS/markup e toca em busca de
dados — então fica separada aqui, e não entra sem você mandar.

Se preferir manter 6, o vazio volta. As alternativas que testei mentalmente
(esticar o painel até o rodapé, centralizar o conteúdo) só trocam fundo vazio
por painel vazio.

### Altura da faixa de status (Dispositivos)

A faixa de "Online / Em atendimento / Offline" tinha 127px de altura para três
linhas de texto. O padding não era o culpado principal: a faixa é
`items-stretch`, e a célula "Sessões ativas" — apertada demais — quebrava o
rótulo em duas linhas, esticando **todas** as outras junto. A altura do bloco
era ditada pela célula mais estreita.

Corrigido nos dois eixos: padding menor (`py-3.5` → `py-3`), número de 22px para
20px, e largura mínima da célula de 148px para **184px**, que é o ponto em que
"SESSÕES ATIVAS" para de quebrar. Resultado medido: **127px → 87px** (−31%),
estável de 884px a 1904px de largura, sem rolagem horizontal. Abaixo de 760px a
faixa quebra em duas fileiras, que é o comportamento correto.

---

## Isolamento

- Nenhum arquivo do app real foi criado, alterado ou removido.
- Fora de `src/`: não entra no `tsconfig.json` do app, não entra no `@source`
  do Tailwind real, não é varrido pelo TanStack Router.
- Sem Supabase, sem API, sem banco, sem relay, sem credenciais, sem `.env`.
- Sem dependências novas. Sem deploy. Sem merge.
