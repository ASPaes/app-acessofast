# Política de anúncios do plano gratuito

Escrito em 19/08/2026, enquanto **não havia nenhum usuário free real** — só a conta
de teste. Essa é a única janela em que essas regras podem ser adotadas sem quebrar
combinado com ninguém: publicar depois, com gente já usando, é mudar as condições
de quem já entrou.

Este documento tem dois leitores. O **técnico no plano gratuito** precisa saber o
que vai aparecer na tela dele e o que nunca vai. O **anunciante** precisa saber o
que é recusado antes de produzir a peça. As duas leituras dependem das mesmas
regras, então elas moram num arquivo só.

---

## 1. O que garantimos a quem usa o plano gratuito

Estas cinco promessas são o contrato. Se alguma precisar mudar, ver §5.

1. **Todo anúncio é rotulado.** Peça de terceiro diz `PUBLICIDADE`; oferta nossa diz
   `DO ACESSOFAST`. Sem rótulo, o técnico leria anúncio como recomendação do
   produto — e é assim que se queima a confiança no painel inteiro.
2. **Nunca durante um atendimento em andamento.** O anúncio aparece no intervalo
   entre pedir a credencial e a sessão abrir, ou na tela de saldo esgotado. Nunca
   por cima de uma sessão viva.
3. **Nunca em tela cheia, nunca bloqueando.** Não existe interstitial com "fechar"
   desabilitado, contagem regressiva ou janela que rouba foco. O slot mora dentro
   de uma tela que o técnico já ia ler.
4. **Teto diário por pessoa.** `ad_policy.viewer_daily_cap` limita quantos anúncios
   um mesmo técnico vê por dia, somando todas as campanhas. O teto por campanha
   protege o orçamento do anunciante; este protege quem usa o produto.
5. **Nada é instalado, nada é executado.** O anúncio é imagem e texto dentro do
   painel. Não baixa arquivo, não roda script de terceiro, não abre instalador.

**O que o anunciante NÃO recebe:** identidade do técnico, nome da empresa dele,
lista de máquinas, ou qualquer dado da operação. O relatório sai agregado
(`ad_stats_*`) — exibições, cliques e CTR. A tabela `ad_impressions` registra quem
viu o quê para aplicar o teto por pessoa e o rodízio, e **nenhuma RPC a expõe**.

---

## 2. O que não aceitamos

Recusa por **categoria**, independente de quem paga:

- Concorrente direto de acesso remoto — não por proteção comercial, mas porque o
  espaço existe dentro de uma ferramenta de trabalho, e anunciar a substituta dela
  ali é confundir o técnico no pior momento.
- Crédito consignado, empréstimo pessoal, "dinheiro rápido", criptomoeda,
  investimento com promessa de retorno.
- Jogo de azar, aposta, sorteio.
- Conteúdo adulto, bebida, tabaco, arma.
- Emagrecimento, tratamento médico, suplemento com promessa de resultado.
- Vaga de emprego e "renda extra" com cadastro obrigatório para ver a oferta.
- Política, campanha eleitoral, causa religiosa.

Recusa por **forma**, mesmo em categoria aceita:

- Peça que imita a interface do AcessoFast — botão falso, aviso de sistema falso,
  "sua sessão expirou", alerta de vírus, contador de tempo.
- Texto que se passa por comunicação nossa, ou que sugere que o AcessoFast
  recomenda o produto.
- Promessa que a peça não pode cumprir na tela de destino ("grátis" que cobra,
  preço que não existe no site).
- Destino que não é o anunciado, redirecionamento em cadeia, ou página que pede
  credencial de qualquer serviço.
- Animação, som, piscar, ou qualquer coisa que dispute atenção com o trabalho em
  curso.

**Quando houver dúvida, recusa.** O custo de recusar uma peça boa é uma conversa
com o anunciante; o custo de aceitar uma ruim é o técnico desconfiar do painel
inteiro — e essa confiança não volta pelo mesmo preço.

---

## 3. Como a moderação funciona

**Hoje:** só existe campanha da casa, e ela entra por SQL. Não há portal do
anunciante, então não há fila de moderação — a decisão é de quem escreve o insert.

**Quando houver portal:** `ad_campaigns.status` é o que separa peça crua de peça
aprovada, e por isso o anunciante **nunca** recebe grant de update nessa coluna. A
migration da Fase 1 já registra isso: a escrita entra como RPC `security definer`
com a máquina de estados dentro, nunca como grant de insert/update na tabela.

Peça aprovada que se revelar problema depois sai por `status`, não por delete: o
histórico de exibição precisa continuar existindo para a medição fechar.

---

## 4. O que já é garantido pelos dados, e não por este texto

Regra escrita que depende de alguém lembrar não é garantia. Estas estão nos dados:

| Regra | Onde vive |
|---|---|
| Oferta de crédito não aparece dentro da tela de oferta de crédito | `ad_campaigns.placements` da campanha da casa contém **só** `free_start` |
| Anunciante não anuncia para si mesmo | `advertiser_tenant_id <> viewer_tenant` na `ad_pick_for_viewer` |
| Teto por pessoa e por campanha | dois predicados na mesma RPC |
| Anúncio só existe em conta com uso gratuito | o slot só monta com `source = 'free'` |
| Painel e janela do DoctorSaaS medidos à parte | `ad_impressions.surface` |

---

## 5. Se alguma promessa precisar mudar

Aviso na tela **antes** de valer, não depois. A regra que torna isso possível é a
mesma que permitiu escrever este documento agora: mudança de condição do plano
gratuito é comunicada com antecedência a quem já está nele.

Duas mudanças que exigiriam mais que aviso:

- **Anúncio fora do painel** (janela nativa desenhada pelo agente na máquina do
  técnico) — não lançar com peça de terceiro sem o instalador assinado. Sem
  assinatura, uma janela de terceiro desenhada por um serviço em SYSTEM é
  indistinguível de adware, e será classificada como tal.
- **Coleta nova para segmentar anúncio** — hoje a seleção usa placement, rodízio e
  tetos, nada sobre a pessoa. Segmentar por comportamento é decisão de privacidade,
  não de produto, e não se resolve com um aviso.

---

## 6. Estado em 19/08/2026

Uma campanha no ar (`casa-credito-v1`, da casa, upsell de crédito). Nenhum
anunciante de terceiro. Inventário medido: **1 a 2 acessos gratuitos por dia**,
2 contas free — uma delas de teste. Ver [ANUNCIOS-POSSIBILIDADES.md](ANUNCIOS-POSSIBILIDADES.md)
para o histórico das opções de superfície.
