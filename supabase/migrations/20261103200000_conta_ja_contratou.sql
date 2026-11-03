-- AcessoFast, 03/11/2026: a Feax Informatica pagou o Team anual por Pix, fora da
-- plataforma. Contratacao assim fica em signup_intents, mas nao cria cliente no Asaas, e
-- a faixa do topo e o Financeiro usavam "sem cliente no Asaas" para dizer que a conta
-- nunca contratou: mandariam contratar quem ja pagou o ano e chamariam o vencimento de
-- bloqueio.
--
-- "Ja contratou" passa a ser a mesma regra do valor contratado (private.valores_contratados:
-- contratacao paga em producao). Cada usuario so consulta a propria empresa e a resposta
-- e so sim ou nao, entao vale para qualquer papel: o tecnico tambem ve a faixa, mas nao
-- le signup_intents nem valor_contratado.
--
-- Aplicada em 03/11/2026 via apply_migration (conta_ja_contratou).

create or replace function public.conta_ja_contratou()
returns boolean
language sql
stable
security definer
set search_path to ''
as $fn$
  select exists (
    select 1
      from private.valores_contratados() v
     where v.tenant_id = private.current_tenant_id()
  )
$fn$;

revoke all on function public.conta_ja_contratou() from public, anon;
grant execute on function public.conta_ja_contratou() to authenticated;
