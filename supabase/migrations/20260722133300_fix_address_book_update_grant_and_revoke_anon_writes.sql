-- Bugs 1 e 2: painel edita address_book via .update() como authenticated.
-- A policy address_book_update JA existe e esta correta; faltava o GRANT de tabela.
grant update on public.address_book to authenticated;

-- Seguranca: migrations de hoje concederam escrita total a anon nestas tabelas.
-- RLS ja bloqueia (nenhuma policy para anon), mas o grant nao deve existir.
-- leads NAO e tocada (INSERT publico do site comercial e intencional).
revoke all on public.clients        from anon;
revoke all on public.asaas_events   from anon;
revoke all on public.plans          from anon;
revoke all on public.signup_intents from anon;
