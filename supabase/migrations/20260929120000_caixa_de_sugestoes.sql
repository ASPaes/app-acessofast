-- AcessoFast, 29/09/2026: CAIXA DE SUGESTOES.
--
-- Qualquer usuario de uma empresa (admin, supervisor, tecnico) manda sugestao pelo
-- painel; a ASP (super_admin) le, muda o status e responde. Quem mandou acompanha o
-- status e a resposta na propria caixa.
--
-- QUEM VE O QUE: cada pessoa ve so as sugestoes que ELA mandou — sugestao e opiniao
-- pessoal, e o tecnico nao deveria ter o que escreveu lido pelo chefe por um caminho
-- que ele nao esperava. super_admin ve todas.
--
-- QUEM GRAVA O QUE: o cliente so insere. autor, empresa, status e resposta sao
-- decididos pelo gatilho, e nao pelo que veio do navegador — assim a politica de
-- INSERT nao precisa conferir campo por campo, e ninguem abre sugestao ja "feita" ou
-- em nome de outra empresa. UPDATE e DELETE sao so do super_admin.
--
-- LIMITE: 10 por pessoa por dia. Nao e contra ataque (a conta ja e autenticada), e
-- contra o duplo clique e o script mal feito encherem a caixa.

create table if not exists public.sugestoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  autor_id uuid not null references public.profiles (id) on delete cascade,
  categoria text not null default 'melhoria'
    check (categoria in ('melhoria', 'novo_recurso', 'problema', 'outro')),
  titulo text not null check (char_length(btrim(titulo)) between 3 and 120),
  descricao text not null check (char_length(btrim(descricao)) between 10 and 4000),
  status text not null default 'nova'
    check (status in ('nova', 'em_analise', 'planejada', 'feita', 'descartada')),
  resposta text check (resposta is null or char_length(resposta) <= 4000),
  respondida_em timestamptz,
  respondida_por uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sugestoes_autor_idx on public.sugestoes (autor_id, created_at desc);
create index if not exists sugestoes_status_idx on public.sugestoes (status, created_at desc);

-- ---------------------------------------------------------------------------
-- Gatilho: quem insere nao escolhe autor, empresa, status nem resposta; quem
-- responde fica registrado.
-- ---------------------------------------------------------------------------
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

drop trigger if exists sugestoes_guard on public.sugestoes;
create trigger sugestoes_guard
  before insert or update on public.sugestoes
  for each row execute function private.sugestoes_guard();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.sugestoes enable row level security;

drop policy if exists sugestoes_select on public.sugestoes;
create policy sugestoes_select on public.sugestoes
  for select to authenticated
  using (private.is_super_admin() or autor_id = auth.uid());

-- O gatilho sobrescreve autor e empresa; a politica confere de novo por garantia.
drop policy if exists sugestoes_insert on public.sugestoes;
create policy sugestoes_insert on public.sugestoes
  for insert to authenticated
  with check (autor_id = auth.uid() and tenant_id = private.current_tenant_id());

drop policy if exists sugestoes_update on public.sugestoes;
create policy sugestoes_update on public.sugestoes
  for update to authenticated
  using (private.is_super_admin())
  with check (private.is_super_admin());

drop policy if exists sugestoes_delete on public.sugestoes;
create policy sugestoes_delete on public.sugestoes
  for delete to authenticated
  using (private.is_super_admin());

grant select, insert, update, delete on public.sugestoes to authenticated;
