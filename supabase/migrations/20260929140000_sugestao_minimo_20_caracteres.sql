-- AcessoFast, 29/09/2026: sugestao precisa de pelo menos 20 caracteres na descricao.
--
-- Pedido do usuario: evitar que a caixa vire canal de recado ("oi"). A tela ja exige
-- o minimo; aqui o banco exige tambem, para quem chama a API direto.
--
-- POR QUE NO GATILHO, E NAO NO CHECK DA COLUNA: ja existe sugestao gravada com menos
-- de 20 caracteres. Um CHECK novo (mesmo NOT VALID) e conferido de novo em todo
-- UPDATE da linha, e a ASP ficaria sem conseguir responder nem mudar o status dela.
-- No gatilho, o minimo vale so para envio NOVO. O CHECK de 10 continua como piso.

create or replace function private.sugestoes_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
begin
  if tg_op = 'INSERT' then
    -- Backend (service_role, sem auth.uid()) grava o que mandou.
    if v_uid is null then
      return new;
    end if;

    v_tenant := private.current_tenant_id();
    if v_tenant is null then
      raise exception 'Sugestao so pode ser enviada por usuario de uma empresa.'
        using errcode = '42501';
    end if;

    if char_length(btrim(coalesce(new.descricao, ''))) < 20 then
      raise exception 'Escreva pelo menos 20 caracteres na sugestao.'
        using errcode = '23514';
    end if;

    if (
      select count(*) from public.sugestoes s
      where s.autor_id = v_uid and s.created_at > now() - interval '1 day'
    ) >= 10 then
      raise exception 'Limite de 10 sugestoes por dia atingido. Tente de novo amanha.'
        using errcode = 'P0001';
    end if;

    new.autor_id := v_uid;
    new.tenant_id := v_tenant;
    new.titulo := btrim(new.titulo);
    new.descricao := btrim(new.descricao);
    new.status := 'nova';
    new.resposta := null;
    new.respondida_em := null;
    new.respondida_por := null;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- UPDATE (a politica ja limita ao super_admin). Autor e empresa nao mudam.
  new.autor_id := old.autor_id;
  new.tenant_id := old.tenant_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  new.resposta := nullif(btrim(new.resposta), '');
  if new.resposta is distinct from old.resposta then
    new.respondida_em := case when new.resposta is null then null else now() end;
    new.respondida_por := case when new.resposta is null then null else v_uid end;
  end if;
  return new;
end;
$fn$;
