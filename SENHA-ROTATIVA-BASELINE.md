# Aposentar a senha rotativa — Passo 0: linha de base

> Medido em **10/09/2026**, janela de **30 dias** (11/08 a 10/09), sobre dados que já existiam.
> Nada foi alterado em produção para produzir estes números.
>
> Passo 0 do plano **"Aposentar a Senha Rotativa"** (25/08/2026):
> https://claude.ai/code/artifact/224acd19-9f78-4c3b-b52a-8afd330c021c
>
> O plano diz: *"Serve a dois propósitos: quantifica a dor que motivou esta mudança e dá o número
> contra o qual medir o resultado. Sem isso, o Passo 1 vira opinião."* Este arquivo é esse número.
> As consultas estão aqui na íntegra para serem **re-rodadas depois do Passo 1** — é a comparação que
> prova (ou desmente) que a troca resolveu.

---

## O número que importa

**26,4% dos cliques em Conectar não produziram sessão nenhuma.** 168 de 637 grants em 30 dias.

O sinal é exato e não depende de interpretação: `create_access_grant` insere a linha em
`connection_logs` com `last_heartbeat_at` **nulo**, e quem preenche esse campo é o `start`/`heartbeat`
do agente. Linha de grant com `last_heartbeat_at is null` = a senha foi emitida e **nenhuma sessão
abriu naquele device**.

### Separando "a senha falhou" de "o técnico desistiu"

O número acima mistura as duas coisas, e medir o Passo 1 contra um número inflado seria enganar a nós
mesmos. O desempate é a **retentativa**: mesmo técnico, mesmo device, novo Conectar em até 10 minutos.

| | Grants | % do total |
|---|---:|---:|
| Total de grants emitidos pelo painel | 637 | 100% |
| Sem sessão nenhuma | 168 | 26,4% |
| └ **com retentativa em ≤10 min** (falha real) | **95** | **14,9%** |
| └ sem retentativa (desistência ou no-show) | 73 | 11,5% |
| Em device sem agente nenhum (explicação inocente) | 5 | 0,8% |

**14,9% é o piso da dor**, não o teto: 64 das 95 retentativas aconteceram em device com agente
moderno, então não dá para creditar à frota velha. E as 73 sem retentativa não são todas inocentes —
desistir depois de a senha falhar é o pior desfecho possível, não a ausência de um problema.

### Quantos cliques custa um atendimento

| | Atendimentos | % |
|---|---:|---:|
| Total (30 dias) | 325 | 100% |
| Resolvidos com **1 clique** | 161 | 49,5% |
| 2 a 3 cliques | 96 | 29,5% |
| 4 ou mais | 45 | 13,8% |
| **Média de cliques por atendimento** | **1,96** | |
| Pior caso observado | **13 cliques** | |

⚠️ **Ressalva honesta:** a janela do atendimento é de 2h (free) ou 3h (plano/crédito), e reconectar de
propósito dentro dela também conta aqui. Então 1,96 **não é** 96% de falha. O que este número mostra é
que **metade dos atendimentos não se resolve num clique** — e o 13 do pior caso não tem leitura boa.

### Não é uma máquina ruim, nem um cliente ruim

| Empresa | Grants | Sem sessão | % | Devices | Devices afetados |
|---|---:|---:|---:|---:|---:|
| ASP SOFTWARES | 510 | 126 | 24,7% | 80 | **43** |
| Consysa Informática | 58 | 15 | 25,9% | 15 | 6 |
| Delvale Tecnologia | 28 | 14 | **50,0%** | 4 | 2 |
| teste | 21 | 8 | 38,1% | 2 | 2 |
| CTM Comércio de Máquinas | 20 | 5 | 25,0% | 8 | 4 |

Todo tenant entre 24,7% e 50%. Mais da metade dos devices da ASP foi afetada pelo menos uma vez.
**O problema é sistêmico** — é do mecanismo, não de um endpoint específico.

### A série semanal — e por que ela não deixa relaxar

| Semana | Grants | Sem sessão | % |
|---|---:|---:|---:|
| 13/07 | 55 | 48 | 87,3% |
| 20/07 | 128 | 31 | 24,2% |
| 27/07 | 90 | 15 | 16,7% |
| 03/08 | 64 | 9 | 14,1% |
| 10/08 | 89 | 12 | 13,5% |
| 17/08 | 65 | 26 | 40,0% |
| 24/08 | 392 | 103 | 26,3% |
| 31/08 | 57 | 10 | 17,5% |
| **07/09** (parcial) | 44 | 18 | **40,9%** |

Melhorou muito de julho (87%) para o começo de agosto (13,5%) — as correções de senha do repo do
agente aparecem aqui. Mas **nunca chegou perto de zero e voltou a subir**: a semana corrente está em
40,9%, a pior desde 17/08. O pico de volume de 24/08 (392 grants) é a rodada de bootstrap.

### Saúde da credencial (Grupo 3 do plano)

| Métrica | Valor |
|---|---|
| Devices ativos com agente | 167 |
| Com senha publicada no painel | 167 (**0 ausentes**) |
| Origem: agente (`updated_by is null`) | 144 |
| Origem: painel | 23 |
| Idade média da senha | 10,8 dias |
| Idade máxima | 52,3 dias |

`senha_ausente_no_painel = 0` é uma boa notícia e merece ser dita: a máquina de estado da pendência
(`rotate.pending` + retry) **está entregando**. O problema não é senha que nunca chega — é senha que
chega e mesmo assim não abre sessão.

A idade média de 10,8 dias com máxima de 52 também informa o Passo 1: na prática **a rotação já não é
por sessão** na maior parte da frota. O comportamento que o Passo 1 quer tornar oficial é, em boa
medida, o que já acontece de fato.

---

## Duas métricas do plano que NÃO são mensuráveis hoje

Achado do próprio Passo 0, e que corrige o plano:

1. **`tempo_ate_primeiro_start`** — o plano marca como "já dá hoje". Não dá. `connection_logs` guarda
   só `last_heartbeat_at`, o **último** batimento, não o primeiro. Não existe registro de quando a
   sessão abriu de fato. Para medir latência é preciso gravar o primeiro batimento (uma coluna
   `first_heartbeat_at`, escrita uma vez pela `session-ingest`) — barato, mas é mudança de servidor,
   não SQL sobre o que existe.

2. **`taxa_aguardando_agente`** — o 409 `aguardando_agente` da `connect-device` só existe nos logs da
   plataforma, e **a janela de consulta é de 24h**. Não há série histórica de 30 dias e nunca haverá,
   retroativamente. Se essa taxa importa para decidir, precisa ser contada no banco a partir de agora.

Nenhuma das duas bloqueia o Passo 1 — o par (26,4% / 14,9%) já é a linha de base. Ficam registradas
para não serem "esquecidas" mais tarde como se tivessem sido medidas.

---

## As consultas, para re-rodar depois do Passo 1

### 1. Falha pós-emissão, e o desempate por retentativa

```sql
with g as (
  select cl.id, cl.rustdesk_id, cl.technician_id, cl.session_start, cl.last_heartbeat_at,
         ab.agent_version is not null   as agente_moderno,
         ab.agent_token_hash is not null as tem_agente
    from public.connection_logs cl
    left join public.address_book ab on ab.id = cl.address_book_id
   where cl.technician_id is not null
     and cl.session_start >= now() - interval '30 days'
),
falhos as (
  select g.*,
         exists (select 1 from g g2
                  where g2.rustdesk_id   = g.rustdesk_id
                    and g2.technician_id = g.technician_id
                    and g2.session_start > g.session_start
                    and g2.session_start < g.session_start + interval '10 minutes') as houve_retentativa
    from g where g.last_heartbeat_at is null
)
select (select count(*) from g)                                     as grants_total,
       (select count(*) from falhos)                                as sem_sessao,
       count(*) filter (where houve_retentativa)                    as com_retentativa_em_10min,
       count(*) filter (where not houve_retentativa)                as sem_retentativa,
       count(*) filter (where houve_retentativa and agente_moderno) as retentativa_em_agente_moderno,
       count(*) filter (where not tem_agente)                       as em_device_sem_agente
from falhos;
```

### 2. Cliques por atendimento

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
select count(*)                                             as atendimentos_30d,
       round(avg(cliques_conectar), 2)                      as media_cliques,
       count(*) filter (where cliques_conectar = 1)         as com_1_clique,
       count(*) filter (where cliques_conectar between 2 and 3) as com_2_a_3,
       count(*) filter (where cliques_conectar >= 4)        as com_4_ou_mais,
       max(cliques_conectar)                                as pior_caso
from por_atend;
```

### 3. Distribuição por empresa

```sql
with g as (
  select cl.rustdesk_id, cl.last_heartbeat_at, t.name as empresa
    from public.connection_logs cl
    join public.tenants t on t.id = cl.tenant_id
   where cl.technician_id is not null
     and cl.session_start >= now() - interval '30 days'
)
select empresa,
       count(*)                                                        as grants,
       count(*) filter (where last_heartbeat_at is null)               as sem_sessao,
       round(100.0 * count(*) filter (where last_heartbeat_at is null) / count(*), 1) as pct,
       count(distinct rustdesk_id)                                     as devices,
       count(distinct rustdesk_id) filter (where last_heartbeat_at is null) as devices_afetados
from g group by 1 order by grants desc;
```

### 4. Série semanal

```sql
select date_trunc('week', cl.session_start)::date as semana,
       count(*) filter (where cl.technician_id is not null) as grants,
       count(*) filter (where cl.technician_id is not null and cl.last_heartbeat_at is null) as sem_sessao,
       round(100.0 * count(*) filter (where cl.technician_id is not null and cl.last_heartbeat_at is null)
             / nullif(count(*) filter (where cl.technician_id is not null), 0), 1) as pct
from public.connection_logs cl
where cl.session_start >= now() - interval '10 weeks'
group by 1 order by 1;
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

### 6. Sessões sem grant (acesso direto pelo `.exe`)

```sql
select count(*) filter (where technician_id is null) as sessoes_sem_grant,
       count(*)                                      as linhas_totais,
       round(100.0 * count(*) filter (where technician_id is null) / count(*), 1) as pct
from public.connection_logs
where session_start >= now() - interval '30 days';
```

Resultado em 10/09: **78 de 715 linhas (10,9%)** são acesso direto sem passar pelo painel. É o
tamanho atual do universo que o Passo 3 (identidade do controlador) vai governar.

---

## O que esta linha de base autoriza

O Passo 1 do plano — desligar a rotação de rotina — deixa de ser preferência e passa a ter alvo:
**levar os 14,9% de falha-com-retentativa para perto de zero, e a média de 1,96 clique para perto de
1,00**. Se depois do Passo 1 esses números não se moverem, a hipótese do plano estava errada e a causa
da falha é outra — e é melhor descobrir isso com número do que com discussão.
