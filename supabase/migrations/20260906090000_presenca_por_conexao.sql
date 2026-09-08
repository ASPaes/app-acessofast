-- AcessoFast, 06/09/2026: presenca vira ESTADO, nao deducao por horario.
--
-- Como era: o agente carimbava `last_online` a cada 180s e o painel deduzia
-- "online" de `last_online > agora - 7min`. Isso custava 480 invocacoes de edge
-- function por maquina por dia — 75% de todo o consumo do projeto — e mesmo
-- assim entregava um status ruim: maquina desligada continuava "online" ate 7
-- minutos, porque a queda so aparece quando os batimentos param de chegar.
--
-- Como passa a ser: o agente mantem uma conexao HTTP pendurada com o servidor de
-- presenca (na VPS do relay). Enquanto ela esta aberta, a maquina esta viva; a
-- queda e percebida quando a conexao cai. O servidor avisa o Supabase **so na
-- mudanca de estado** — ligou, caiu — e mudanca e rara por natureza.
--
-- POR QUE UMA COLUNA NOVA, e nao continuar com last_online: com reporte por
-- mudanca, uma maquina ligada ha tres dias teria last_online de tres dias atras
-- e a regra da janela a daria como offline. O horario deixa de ser prova de
-- vida, entao o estado precisa ser gravado como estado.
--
-- last_online CONTINUA existindo e sendo carimbado: e o "visto por ultimo" que a
-- tela mostra para maquina offline ("Offline · ha 4 h"), e e o que sustenta o
-- agente antigo, que segue mandando presence por HTTP e nao conhece o servidor
-- novo. Durante a transicao a frota fica misturada — o painel resolve os dois
-- casos com o coalesce da view abaixo.

alter table public.address_book
  add column if not exists presenca_online boolean,
  add column if not exists presenca_desde  timestamptz;

comment on column public.address_book.presenca_online is
  'Estado de conexao reportado pelo servidor de presenca (VPS). NULL = a maquina '
  'nao usa o servidor novo (agente antigo) — nesse caso o painel cai para a regra '
  'de last_online. true/false = fato observado, nao deducao.';

comment on column public.address_book.presenca_desde is
  'Quando o estado atual comecou. Alimenta "online ha 3h" / "offline desde 14:20" '
  'sem precisar de outra tabela de historico.';

-- Indice parcial: a consulta quente do painel e "quem esta online agora", e as
-- offline nao precisam entrar no indice.
create index if not exists address_book_presenca_online_idx
  on public.address_book (tenant_id)
  where presenca_online = true;

-- ---------------------------------------------------------------------------
-- A RPC que o servidor de presenca chama. Recebe o LOTE de mudancas dos ultimos
-- segundos, nao uma chamada por maquina: com a frota inteira reconectando depois
-- de uma queda de rede, uma chamada por maquina viraria uma tempestade.
--
-- Idempotente de proposito: reenviar o mesmo lote (retry do servidor apos timeout)
-- nao corrompe nada, e `presenca_desde` so anda quando o estado REALMENTE muda —
-- senao um retry zeraria o "online ha 3h".
-- ---------------------------------------------------------------------------
create or replace function private.aplicar_presenca(p_lote jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_alteradas integer;
begin
  if p_lote is null or jsonb_typeof(p_lote) <> 'array' then
    return 0;
  end if;

  with entrada as (
    select (e->>'rustdesk_id')::text  as rustdesk_id,
           (e->>'online')::boolean    as online,
           coalesce((e->>'em')::timestamptz, now()) as em
      from jsonb_array_elements(p_lote) e
     where e->>'rustdesk_id' ~ '^[0-9]{6,12}$'
       and e->>'online' is not null
  ), aplicado as (
    update public.address_book ab
       set presenca_online = en.online,
           -- so reposiciona o inicio quando o estado muda de fato
           presenca_desde  = case
                               when ab.presenca_online is distinct from en.online
                               then en.em else ab.presenca_desde
                             end,
           -- online carimba o visto-por-ultimo; offline preserva o ultimo horario
           -- conhecido, que e exatamente o que a tela mostra depois da queda
           last_online     = case when en.online then en.em else ab.last_online end,
           updated_at      = now()
      from entrada en
     where ab.rustdesk_id = en.rustdesk_id
       and (ab.presenca_online is distinct from en.online)
    returning 1
  )
  select count(*) into v_alteradas from aplicado;

  return v_alteradas;
end;
$fn$;

revoke all on function private.aplicar_presenca(jsonb) from public, anon, authenticated;
grant execute on function private.aplicar_presenca(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- O servidor de presenca precisa saber quais tokens sao validos SEM perguntar ao
-- Supabase a cada conexao — senao a economia evapora. Ele sincroniza esta lista
-- a cada poucos minutos e valida em memoria.
--
-- Devolve so o hash, nunca o token: o servidor compara sha256(token) com ele,
-- exatamente como as edge functions ja fazem.
-- ---------------------------------------------------------------------------
create or replace function private.tokens_de_presenca()
returns table (rustdesk_id text, agent_token_hash text)
language sql
security definer
set search_path = ''
as $$
  select ab.rustdesk_id, ab.agent_token_hash
    from public.address_book ab
   where ab.agent_token_hash is not null
     and ab.is_active is distinct from false;
$$;

revoke all on function private.tokens_de_presenca() from public, anon, authenticated;
grant execute on function private.tokens_de_presenca() to service_role;
