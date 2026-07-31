# Anúncios no plano gratuito — possibilidades

_31/07/2026. Escrito depois de validar o código real do agente
([ASPaes/acessofast-agent](https://github.com/ASPaes/acessofast-agent)) e do build do cliente.
Objetivo: escolher **onde** o anúncio aparece, porque essa escolha define custo, risco e prazo._

---

## Resumo em cinco linhas

- O **inventário, a moderação e a métrica já estão prontos** e servem a qualquer opção.
- O que falta decidir é a **superfície de exibição**: painel web, cliente `.exe`, ou nenhuma.
- O agente **não pode** exibir o anúncio: é serviço Windows (sessão 0) e é cego para conexões de saída.
- O cliente `.exe` **pode**, mas custa caro e carrega risco real de ser classificado como adware.
- **Recomendação: começar pelo painel.** Valida se anunciante paga antes de gastar no caminho caro.

---

## 1. O que já existe e não se perde

Commit `45e499a`, branch `anuncios-plano-gratuito`. Nada disso muda conforme a opção escolhida:

| Peça | O que faz |
|---|---|
| `ad_campaigns` | catálogo, janela, teto diário, estados e transições |
| `ad_impressions` | exibição e clique, por espectador |
| Bucket `ad-creatives` | arte privada, URL assinada na hora, isolada por tenant |
| Gatilhos | só a plataforma aprova; mexer na arte aprovada devolve à fila |
| `ad_pick_for_tenant` | elegibilidade, rodízio e teto — **independe da superfície** |
| `/anuncios` | autoatendimento do anunciante |
| Aba Anúncios no Financeiro | fila de moderação com a arte à vista |

**O que precisa mudar em qualquer cenário:** a edge function `ad-serve` autentica hoje por
`rustdesk_id` + `agent_token`. Isso foi um erro meu de inferência — ver restrição 3 abaixo.

---

## 2. As três restrições que o código impõe

Não são opiniões; saíram da leitura do repositório do agente.

**O agente não desenha na tela.** `main.go` roda via `svc.Run` — serviço Windows, sessão 0,
isolada do desktop interativo desde o Vista. Exibir algo exigiria um binário auxiliar lançado
com `CreateProcessAsUser` na sessão do usuário.

**O agente é cego para conexões de saída.** Ele detecta sessão fazendo tail de
`log\server\AcessoFast_rCURRENT.log`, e o comentário no código é explícito: essa é a única
pasta onde o motor escreve `#N Connection opened/closed`, e corresponde a **quem recebe** a
sessão. O lado que controla não gera esses eventos. Ou seja: o agente **não tem sinal** de que
o técnico está prestes a conectar.

**O cliente não lê o token do agente.** `enroll.go` tranca `C:\ProgramData\AcessoFast` com
`icacls` só para SYSTEM e Administradores, de propósito — quem lê o token forja evento de
sessão e corrompe a cobrança. O cliente Flutter roda como usuário comum e não alcança o arquivo.

**Consequência direta:** o momento "antes de iniciar a conexão" não existe no agente, e a
autenticação que escrevi não serve para o cliente. As opções abaixo partem daí.

---

## 3. As opções

### Opção A — Painel web

O anúncio aparece no painel, no fluxo de conectar, antes de a sessão abrir.

**Como funciona.** O painel já é quem chama `connect-device` e já sabe quando a conta é
gratuita (a resposta traz `source: free`). Entre o clique em Conectar e a abertura da sessão,
entra o anúncio. Autenticação: o JWT que o usuário já tem.

- **Cobre:** sessões iniciadas pelo painel — o caminho principal do técnico.
- **Não cobre:** acesso direto pelo `.exe`, sem passar pelo painel.
- **Custo:** pequeno. Um componente e o ajuste de autenticação na `ad-serve`.
- **Risco de antivírus:** nenhum. É página web.
- **Manutenção:** nenhuma. Não depende de versão do RustDesk.

O corte das 2h também cabe aqui, com uma ressalva: o painel precisa estar aberto para mostrar.
Se o técnico fechou a aba, o momento passa em branco.

---

### Opção B — Cliente `.exe` (patch no RustDesk)

O anúncio aparece dentro do próprio cliente, nos dois momentos do desenho original.

**Como funciona.** `build-client.yml` clona o `rustdesk/rustdesk` numa tag e aplica patches.
Entraria um widget Flutter novo na tela de conexão, mais o disparo no fim de sessão por corte.

- **Cobre:** os dois momentos, tanto no painel quanto no acesso direto.
- **Custo:** alto, e **recorrente**. O único patch Rust de vocês hoje é o `peer_id` — uma linha,
  com guarda que aborta o build se a âncora sumir. Um overlay em tela cheia é widget, download
  de imagem, timer e estado, mantidos como patch textual contra um upstream que se move. Cada
  bump de versão do RustDesk vira risco de quebra.
- **Risco de antivírus:** **alto.** Tela cheia com fechar bloqueado por 20s é a descrição de
  manual de adware. O instalador **ainda não é assinado**, e o SmartScreen já está listado como
  bloqueador no [checklist de publicação](CHECKLIST-publicar-exe.md). Reputação de binário
  queimada demora a voltar.
- **Bloqueio pendente:** falta uma credencial que o processo do usuário consiga ler. Criar uma
  enfraquece o modelo hoje protegido pelo `icacls`.

**Pré-requisito inegociável:** assinar o certificado antes.

---

### Opção C — Agente com auxiliar na sessão do usuário

Serviço busca o anúncio, um binário auxiliar exibe.

**Vale registrar por que isto não resolve.** Mesmo pagando o custo do auxiliar e do
`CreateProcessAsUser`, o agente continua **cego para conexões de saída** (restrição 2). Ele só
enxergaria sessões chegando — ou seja, só conseguiria exibir anúncio **na máquina atendida**,
que é justamente o que decidimos não fazer: o cliente final do MSP não contratou nada.

- **Cobre:** nada do que queremos.
- **Risco de antivírus:** o maior dos três.
- **Veredito:** descartada, salvo se aparecer um sinal de saída no log do cliente que hoje eu
  não identifiquei — precisaria de investigação específica.

---

### Opção D — Não exibir anúncio

Monetizar o gratuito por outro caminho: marca no painel, teto menor de atendimentos, upsell no
momento do corte das 2h.

- **Custo:** o menor. Parte já existe (o corte já acontece).
- **Risco:** nenhum.
- **Perde:** a receita de anunciante, que é o objetivo original.

Está aqui como linha de base honesta: se o anunciante não pagar o suficiente, a Opção B nunca
se paga, e é bom saber disso antes.

---

## 4. Comparação

| | A — Painel | B — Cliente `.exe` | C — Agente + auxiliar | D — Sem anúncio |
|---|---|---|---|---|
| Antes de conectar | sim (via painel) | sim | **não** | — |
| Corte das 2h | parcial | sim | não | upsell |
| Acesso direto pelo `.exe` | não | sim | não | — |
| Custo inicial | baixo | alto | alto | mínimo |
| Custo recorrente | nenhum | por versão do RustDesk | idem | nenhum |
| Risco de antivírus | nenhum | alto | máximo | nenhum |
| Exige certificado antes | não | **sim** | **sim** | não |
| Reusa o que já está pronto | sim | sim | sim | parte |

---

## 5. Recomendação

**Fase 1 — Opção A.** Interstitial no painel. Barato, sem risco, e coloca campanha de
anunciante rodando de verdade. É o que responde a pergunta que ainda não tem resposta:
**anunciante paga por esse inventário?**

**Fase 2 — decidir com dado.** Com receita medida e o certificado assinado, aí sim avaliar a
Opção B para cobrir o acesso direto. Se a receita da Fase 1 não justificar, você economizou o
patch no cliente e a briga com antivírus.

O que **não** recomendo é começar pela B: ela é a mais cara, a mais arriscada, depende de
assinatura de certificado que ainda não existe, e é a que mais demora a dizer se o negócio
funciona.

---

## 6. Decisões que faltam, independentes da opção

**Cobrança do anunciante.** Hoje registramos exibição e clique, mas não há preço, fatura nem
saldo. Antes de vender: pacote por período, CPM, ou cortesia para cliente de plano?

**Teto por espectador.** O `daily_cap` é por campanha. Falta "quantos anúncios um técnico vê
por dia" — é isso que protege a experiência de quem usa o gratuito.

**Termos de uso.** O plano gratuito precisa dizer, por escrito e antes do aceite, que exibe
anúncio. Mudar isso para quem já usa, sem aviso, chega como quebra de combinado.

**Conteúdo aceitável.** A moderação existe, mas não há política escrita do que se recusa.
Sem critério, a recusa vira arbitrária e o anunciante não sabe como corrigir.
