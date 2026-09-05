-- AcessoFast, 05/09/2026: uma maquina instalada e NUNCA adotada custava 5.760
-- chamadas por dia, para sempre.
--
-- O caso e normal: um parceiro instala o agente em 50 maquinas e leva semanas pra
-- adotar, ou nunca adota. E escolha da empresa. O produto e que nao comportava
-- isso — o agente perguntava "ja me aprovaram?" de 15 em 15 segundos, sem teto,
-- indefinidamente. Em 05/09/2026 eram 50 maquinas nesse estado, uma delas pedindo
-- desde 21/07 (45 dias), somando ~96 mil chamadas/dia. Era o maior item da conta.
--
-- Consertar isso no AGENTE nao resolve: essas maquinas rodam binario anterior a
-- 12/08/2026, quando o auto-update entrou. Elas ignoram o manifesto que o servidor
-- manda (19.937 vezes por dia) porque nao tem o codigo que le esse campo. Nunca
-- vao se atualizar. O conserto tem que valer para binarios que ja existem.
--
-- A unica alavanca que o servidor tem sobre um agente antigo esta no laco da
-- matricula, e ela existe em TODAS as versoes:
--
--     case "approved", "consumed":
--         ...grava a credencial...
--         return      // sai do laco e nunca mais pergunta
--
-- Entao: passadas 48h sem adocao, o servidor responde 'consumed'. O agente encerra
-- a matricula e passa a mandar so o sinal de presenca (3 em 3 min). De 5.760 para
-- ~480 chamadas/dia — 92% a menos, sem tocar em nenhuma maquina.

alter table private.device_claims
  add column if not exists quiesced_at timestamptz;

comment on column private.device_claims.quiesced_at is
  'Quando o servidor mandou o agente parar de perguntar (matricula orfa ha mais de 48h). '
  'O pedido segue waiting e adotavel: isto NAO e uma recusa, e um silenciamento.';

create or replace function public.claim_poll(p_rustdesk_id text, p_nonce_hash text)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid; v_status text; v_exp timestamptz; v_quiesced timestamptz;
  v_desde timestamptz;
begin
  if p_rustdesk_id !~ '^[0-9]{6,12}$' then return 'unknown'; end if;

  select id, status, expires_at, quiesced_at
    into v_id, v_status, v_exp, v_quiesced
    from private.device_claims
   where rustdesk_id = p_rustdesk_id and nonce_hash = p_nonce_hash
   order by created_at desc limit 1;
  if v_id is null then return 'unknown'; end if;

  -- (1) Ja aquietado: segue dizendo 'consumed'. Cobre o agente que voltou a
  -- perguntar por ter reiniciado antes de conseguir gravar a credencial.
  if v_quiesced is not null then return 'consumed'; end if;

  -- (2) Adocao de verdade ganha de tudo. Vinha depois da expiracao no original;
  -- a guarda de expires_at aqui preserva aquele comportamento (approved vencido
  -- continua caindo no ramo (4) e virando 'expired').
  if v_status = 'approved' and v_exp >= now() then
    update private.device_claims set status='consumed', consumed_at=now()
     where id=v_id and status='approved';
    return 'approved';
  end if;

  -- (3) QUIESCE.
  --
  -- A idade e a da TENTATIVA, ancorada no nonce_hash — nao no claim atual e nao no
  -- rustdesk_id. As duas alternativas erram, cada uma pro seu lado:
  --
  --   • pelo claim atual: o agente re-registra a cada expiracao (de hora em hora),
  --     o relogio zerava junto e nada aquietaria nunca.
  --   • pelo rustdesk_id: uma maquina REINSTALADA hoje, com pedidos velhos no
  --     historico, seria silenciada no primeiro poll — matando uma matricula
  --     legitima em andamento diante do operador.
  --
  -- O nonce vive no enroll.state da maquina: sobrevive ao restart e ao
  -- re-registro (mesma tentativa), e uma reinstalacao gera um novo (relogio novo).
  if v_status in ('waiting','expired') then
    select min(c.created_at) into v_desde
      from private.device_claims c
     where c.rustdesk_id = p_rustdesk_id
       and c.nonce_hash  = p_nonce_hash;

    if v_desde is not null and v_desde < now() - interval '48 hours' then
      -- status segue 'waiting' e a validade e esticada DE PROPOSITO: e o que faz
      -- redeem_claim (que exige waiting E nao vencido) continuar achando o pedido
      -- quando o parceiro adotar, daqui a um mes. A maquina volta a funcionar
      -- sozinha — o token que ela guardou agora e o mesmo que a adocao registra.
      -- Silenciar nao pode custar a adocao futura; seria trocar um problema por outro.
      update private.device_claims
         set quiesced_at = now(),
             expires_at  = greatest(expires_at, now() + interval '1 year')
       where id = v_id;
      return 'consumed';
    end if;
  end if;

  -- (4) Expiracao normal: o agente re-registra e a tentativa continua.
  if v_status in ('waiting','approved') and v_exp < now() then
    update private.device_claims set status='expired' where id=v_id;
    return 'expired';
  end if;

  return v_status;
end;
$fn$;

revoke all on function public.claim_poll(text, text) from public, anon, authenticated;
grant execute on function public.claim_poll(text, text) to service_role;
