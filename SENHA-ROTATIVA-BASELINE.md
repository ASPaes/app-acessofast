# Aposentar a senha rotativa — Passo 0: linha de base

> **Revisão 2 — 11/09/2026.** A primeira versão deste arquivo publicou **26,4% / 14,9%**.
> Os números estavam inflados por dois vieses que a própria investigação do canário revelou.
> O número acionável é **11,5%**. O método corrigido e o que mudou estão em "Revisões", no fim.
>
> Passo 0 do plano **"Aposentar a Senha Rotativa"** (25/08/2026):
> https://claude.ai/code/artifact/224acd19-9f78-4c3b-b52a-8afd330c021c
>
> O plano diz: *"sem isso, o Passo 1 vira opinião."* Este arquivo é esse número — e, como se verá,
> ele também põe em dúvida a **causa** que o plano assume.

---

## O método, e por que ele foi ficando mais estreito

O sinal bruto é a linha de grant que nunca virou sessão. `create_access_grant` insere em
`connection_logs` com `last_heartbeat_at` nulo, e quem preenche é o `start` do agente.

Melhor que isso: **a plataforma já rotula esses casos**. O cron `close_stale_sessions` marca
`status = 'failed'` no *"clique no painel que nunca virou sessão (agente nunca assumiu)"*. Conferido:
451 `ended` todas com heartbeat, 165 `failed` todas sem — zero discordância. Usamos o rótulo oficial.

Três filtros, cada um removendo uma explicação que **não é** falha de credencial:

| Filtro | Por quê | Efeito |
|---|---|---|
| Só grants **encerrados** (`ended`/`failed`) | Linhas `active` estão em voo e não têm desfecho | tira 21 linhas do denominador |
| Só devices com **`agent_version`** | Sem agente moderno, heartbeat nulo pode ser **telemetria ausente**, não sessão ausente — o técnico pode ter conectado normalmente | população ambígua tem 41,0% contra 22,0% da limpa |
| Só quando a **máquina deu sinal de vida** em ±12h | Máquina desligada não é problema de senha | **43 grants, 100% de falha** — todos removidos |

Esse último filtro é o que mais corrige. Dos 139 grants que falharam na população limpa, **43 (31%)
foram em máquina que não deu sinal nenhum no dia** — não havia o que autenticar.

---

## O número

Janela de **60 dias**, device com agente moderno, máquina comprovadamente viva no período:

| | Grants | % |
|---|---:|---:|
| Grants encerrados, máquina viva | 565 | 100% |
| Falharam (`status = 'failed'`) | 96 | 17,0% |
| └ **com retentativa em ≤10 min — o número acionável** | **65** | **11,5%** |
| └ sem retentativa | 31 | 5,5% |

**11,5%**: um em cada nove cliques em Conectar, numa máquina que estava ligada e com agente
reportando, não abriu sessão e o técnico teve de clicar de novo.

### Para comparação, o que cada filtro removeu

| Recorte | Grants | Falha | Confirmada |
|---|---:|---:|---:|
| Tudo (a primeira versão deste arquivo) | 637 | 26,4% | 14,9% |
| Só agente moderno | 460 | 22,0% | 13,9% |
| Só agente moderno **e máquina viva** | 565¹ | 17,0% | **11,5%** |

¹ janela de 60 dias no último recorte, contra 30 nos outros — daí o total maior.

---

## O achado que põe a causa em dúvida

O plano assume que a falha vem de **senha velha**: o painel entrega uma credencial que o endpoint já
trocou. Se isso fosse verdade, a falha teria de ser **maior logo depois de uma sessão terminar** — é
exatamente aí que a rotação acontece.

É o contrário:

| Tempo desde a sessão anterior no mesmo device | Grants | Falhou | % |
|---|---:|---:|---:|
| até 10 min depois | 211 | 32 | 15,2% |
| 10 min a 2 h depois | 74 | 10 | **13,5%** |
| 2 h a 1 dia depois | 95 | 18 | 18,9% |
| mais de 1 dia depois | 124 | 44 | **35,5%** |
| sem sessão anterior registrada | 104 | 35 | 33,7% |

A falha é **mais que o dobro** quando a máquina não é acessada há mais de um dia, e **mínima** na
janela imediatamente após uma sessão — que é a janela em que a senha acabou de girar.

**O que isso não quer dizer:** que a rotação seja inocente. O filtro de "máquina viva" já removeu o
caso grosseiro de máquina desligada, e mesmo assim o gradiente por tempo persiste. Pode ser
prontidão do cliente RustDesk depois de dias ocioso, pode ser rede, pode ser a senha tendo girado
várias vezes no intervalo (rotate-on-boot a cada reinício).

**O que isso quer dizer:** a causa **não está estabelecida**, e o Passo 1 não pode ser medido como se
estivesse. Se desligar a rotação e os 11,5% não se moverem, isso não prova que o passo foi inútil —
prova que a causa era outra. É melhor entrar sabendo disso.

---

## Saúde da credencial (Grupo 3 do plano)

| Métrica | Valor |
|---|---|
| Devices ativos com agente | 167 |
| Com senha publicada no painel | 167 (**0 ausentes**) |
| Origem: agente (`updated_by is null`) | 144 |
| Origem: painel | 23 |
| Idade média da senha | 10,8 dias |
| Idade máxima | 52,3 dias |

`senha_ausente_no_painel = 0`: a máquina de pendência do `rotate.pending` está entregando. O problema
nunca foi senha que não chega.

E a idade média de 10,8 dias diz algo que vale para o Passo 1: **na prática a rotação já não é por
sessão** na maior parte da frota. O passo oficializa, com controle e canário, boa parte do que já
acontece.

---

## Cliques por atendimento

| Atendimentos em 30 dias | Quantos | % |
|---|---:|---:|
| Resolvidos com 1 clique | 161 | 49,5% |
| 2 a 3 cliques | 96 | 29,5% |
| 4 ou mais | 45 | 13,8% |
| **Média** | **1,96** | |
| Pior caso | **13** | |

⚠️ A janela do atendimento é de 2h (gratuito) ou 3h (plano/crédito), e reconectar de propósito dentro
dela também conta aqui. Então 1,96 **não** é 96% de falha. O que se lê é: **metade dos atendimentos
não se resolve num clique**.

---

## Acesso direto, sem passar pelo painel

**78 de 715 linhas (10,9%)** em 30 dias são sessões sem grant — o técnico abriu o cliente e digitou o
ID. É o tamanho do universo que o Passo 3 (identidade do controlador) vai governar.

---

## Duas métricas do plano que NÃO são mensuráveis

Achado do próprio Passo 0, e que corrige o plano:

1. **`tempo_ate_primeiro_start`** — marcado como "já dá hoje". Não dá. `connection_logs` guarda só
   `last_heartbeat_at`, o **último** batimento; o primeiro nunca foi gravado. Exigiria uma coluna
   `first_heartbeat_at`, escrita uma vez pela `session-ingest`.
2. **`taxa_aguardando_agente`** — o 409 da `connect-device` só existe nos logs da plataforma, cuja
   janela de consulta é de **24h**. Não há série histórica e não haverá retroativamente. Se essa taxa
   importa, precisa ser contada no banco a partir de agora.

---

## As consultas, para re-rodar depois do Passo 1

### 1. O número acionável (o recorte oficial)

```sql
with g as (
  select cl.id, cl.rustdesk_id, cl.technician_id, cl.session_start, cl.status
    from public.connection_logs cl
    join public.address_book ab on ab.id = cl.address_book_id
   where cl.technician_id is not null
     and cl.status in ('ended','failed')
     and cl.session_start >= now() - interval '60 days'
     and ab.agent_version is not null
     and exists (select 1 from public.connection_logs v
                  where v.rustdesk_id = cl.rustdesk_id
                    and v.last_heartbeat_at is not null
                    and v.last_heartbeat_at between cl.session_start - interval '12 hours'
                                                and cl.session_start + interval '12 hours')
)
select count(*)                                        as grants_maquina_viva,
       count(*) filter (where status = 'failed')        as falhou,
       round(100.0 * count(*) filter (where status = 'failed') / count(*), 1) as pct_falha,
       count(*) filter (where status = 'failed' and exists (
         select 1 from g g2
          where g2.rustdesk_id = g.rustdesk_id and g2.technician_id = g.technician_id
            and g2.session_start > g.session_start
            and g2.session_start < g.session_start + interval '10 minutes')) as falha_com_retentativa
from g;
```

### 2. O teste da causa — falha por tempo desde a sessão anterior

```sql
with g as (
  select cl.id, cl.rustdesk_id, cl.session_start, cl.status
    from public.connection_logs cl
    join public.address_book ab on ab.id = cl.address_book_id
   where cl.technician_id is not null and cl.status in ('ended','failed')
     and cl.session_start >= now() - interval '60 days'
     and ab.agent_version is not null
),
com_anterior as (
  select g.*,
         (select max(p.session_end) from public.connection_logs p
           where p.rustdesk_id = g.rustdesk_id and p.session_end is not null
             and p.status = 'ended' and p.session_end < g.session_start) as fim_anterior
    from g
),
faixas as (
  select status,
         case when fim_anterior is null then 5
              when session_start - fim_anterior < interval '10 minutes' then 1
              when session_start - fim_anterior < interval '2 hours'    then 2
              when session_start - fim_anterior < interval '1 day'      then 3
              else 4 end as ord
    from com_anterior
)
select ord, count(*) as grants,
       count(*) filter (where status = 'failed') as falhou,
       round(100.0 * count(*) filter (where status = 'failed') / count(*), 1) as pct
from faixas group by ord order by ord;
```

### 3. Quanto da falha é máquina desligada

```sql
with g as (
  select cl.id, cl.rustdesk_id, cl.session_start, cl.status
    from public.connection_logs cl
    join public.address_book ab on ab.id = cl.address_book_id
   where cl.technician_id is not null and cl.status in ('ended','failed')
     and cl.session_start >= now() - interval '60 days'
     and ab.agent_version is not null
)
select exists (select 1 from public.connection_logs v
                where v.rustdesk_id = g.rustdesk_id and v.last_heartbeat_at is not null
                  and v.last_heartbeat_at between g.session_start - interval '12 hours'
                                              and g.session_start + interval '12 hours') as deu_sinal,
       count(*) as grants,
       count(*) filter (where status = 'failed') as falhou,
       round(100.0 * count(*) filter (where status = 'failed') / count(*), 1) as pct
from g group by 1 order by 2 desc;
```

### 4. Cliques por atendimento

```sql
with por_atend as (
  select a.id,
         (select count(*) from public.connection_logs cl
           where cl.rustdesk_id = a.rustdesk_id
             and cl.technician_id is not null
             and cl.session_start >= a.started_at
             and cl.session_start <  a.window_expires_at) as cliques_conectar
    from public.atendimentos a
   where a.started_at >= now() - interval '30 days'
)
select count(*) as atendimentos, round(avg(cliques_conectar), 2) as media_cliques,
       count(*) filter (where cliques_conectar = 1) as com_1_clique,
       count(*) filter (where cliques_conectar between 2 and 3) as com_2_a_3,
       count(*) filter (where cliques_conectar >= 4) as com_4_ou_mais,
       max(cliques_conectar) as pior_caso
from por_atend;
```

### 5. Saúde da credencial

```sql
select count(*)                                          as devices_com_agente,
       count(ds.device_id)                               as com_senha_publicada,
       count(*) - count(ds.device_id)                    as senha_ausente_no_painel,
       count(*) filter (where ds.updated_by is null)     as origem_agente,
       count(*) filter (where ds.updated_by is not null) as origem_painel,
       round(avg(extract(epoch from (now() - ds.updated_at)) / 86400)::numeric, 1) as idade_media_dias,
       round(max(extract(epoch from (now() - ds.updated_at)) / 86400)::numeric, 1) as idade_maxima_dias
from public.address_book ab
left join private.device_secrets ds on ds.device_id = ab.id
where ab.is_active and ab.agent_token_hash is not null;
```

### 6. Acesso direto (sessões sem grant)

```sql
select count(*) filter (where technician_id is null) as sessoes_sem_grant,
       count(*)                                      as linhas,
       round(100.0 * count(*) filter (where technician_id is null) / count(*), 1) as pct
from public.connection_logs
where session_start >= now() - interval '30 days';
```

---

## O que esta linha de base autoriza — e o que ela não autoriza

**Autoriza:** entrar no Passo 1 com um alvo declarado — levar os **11,5%** para perto de zero e a
média de **1,96 clique** para perto de 1,00 — e com canário por máquina, medindo o grupo de teste
contra o resto da frota.

**Não autoriza:** tratar a rotação como causa provada. O gradiente por tempo desde a última sessão
aponta para prontidão da máquina, não para credencial velha. O Passo 1 continua valendo pela
fragilidade operacional que remove (a pendência, a carência, o rotate-on-boot) e por ser
pré-requisito do Passo 2 — mas o ganho neste número específico é **hipótese, não previsão**.

---

## Revisões

**Revisão 2 (11/09/2026)** — investigando a `BOMBONIERI03` para escolher canários, apareceram dois
vieses na Revisão 1:

1. **Telemetria ausente contada como falha.** Devices sem `agent_version` não reportam sessão de
   forma confiável; heartbeat nulo neles pode significar que ninguém reportou, não que ninguém
   conectou. Essa população tem 41,0% de "falha" contra 22,0% da limpa — diferença grande demais
   para ser real.
2. **Máquina desligada contada como falha de senha.** 43 grants em máquina sem nenhum sinal de vida
   em ±12h, todos com 100% de falha. Não havia o que autenticar.

Também trocamos o sinal `last_heartbeat_at is null` pelo rótulo oficial `status = 'failed'`, que a
plataforma já calcula no cron `close_stale_sessions`, e passamos a excluir linhas `active` (em voo).

Resultado: **26,4% → 17,0%** de falha, e **14,9% → 11,5%** de falha acionável. A direção da conclusão
não mudou; a magnitude e a causa provável, sim.

**Revisão 1 (10/09/2026)** — primeira medição, sobre `last_heartbeat_at is null`, sem filtrar
população nem disponibilidade. Publicava 26,4% / 14,9%.
