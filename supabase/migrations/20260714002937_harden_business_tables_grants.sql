-- ALTO: tira agent_token_hash do alcance de escrita do authenticated (segredo de auth do agente).
-- Remove INSERT/UPDATE de tabela e re-concede em TODAS as colunas MENOS agent_token_hash.
-- service_role (provisionamento futuro) nao e afetado; policies nao sao tocadas.
revoke insert, update on public.address_book from authenticated;
grant insert (id, tenant_id, rustdesk_id, alias, device_group, os, last_online, created_by, created_at, updated_at),
      update (id, tenant_id, rustdesk_id, alias, device_group, os, last_online, created_by, created_at, updated_at)
  on public.address_book to authenticated;

-- MEDIO: remove privilegios que o PostgREST nao usa (defesa em profundidade).
revoke truncate, references, trigger on
  public.address_book, public.leads, public.tenant_features, public.tenant_settings
  from authenticated;

-- MEDIO: anon so precisa de INSERT no leads (captacao publica). RLS ja nega o resto.
revoke select, update, delete, truncate, references, trigger on public.leads from anon;