-- AcessoFast, 27/10/2026: logo da empresa no AcessoFast instalado no computador do cliente.
--
-- O administrador da empresa sobe a logo no painel (Configuracoes). Ela chega sozinha a todos
-- os computadores da empresa: no presence, a session-ingest pergunta a marca_da_maquina, assina
-- a URL e o agente baixa a imagem para uma pasta que o app le. O instalador continua um so para
-- todo mundo: o que decide a logo e a empresa dona da maquina, nao a instalacao.
--
-- QUEM TEM DIREITO. Planos pagos e o teste de 7 dias (decisao do Ryan, 27/10). A regra mora na
-- RPC, e nao so no painel, porque e ela que decide o que vai para a maquina: plano que vence ou
-- conta bloqueada tira a logo da frota sozinha no proximo presence, sem ninguem apagar nada.
--
-- O NOME que aparece no app ("Seu suporte: ...") e o tenant_settings.display_name, coluna que
-- existia desde julho e nunca foi usada. Vazio = nome da empresa.

-- 1. Onde a logo fica -------------------------------------------------------------------------

alter table public.tenant_settings
  add column logo_path text,
  add column logo_atualizada_em timestamptz;

comment on column public.tenant_settings.logo_path is
  'Logo da empresa no app do cliente: caminho no bucket privado logos-empresas (<tenant_id>/<arquivo>). Null = sem logo. Quem entrega e a session-ingest, via marca_da_maquina.';
comment on column public.tenant_settings.logo_atualizada_em is
  'Versao da marca (logo + display_name) entregue as maquinas. Mantida pelo gatilho trg_tenant_settings_marca; o agente compara com a que ja tem e so baixa de novo quando muda.';

-- A versao muda sozinha quando a logo ou o nome mudam. Feito em gatilho, e nao pelo painel,
-- para que um update por qualquer caminho (painel, SQL, suporte) chegue as maquinas.
create or replace function private.marca_atualizada()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.logo_path is distinct from old.logo_path
     or new.display_name is distinct from old.display_name then
    new.logo_atualizada_em := now();
  end if;
  return new;
end;
$fn$;

revoke all on function private.marca_atualizada() from public, anon, authenticated;

create trigger trg_tenant_settings_marca
  before update of logo_path, display_name
  on public.tenant_settings
  for each row execute function private.marca_atualizada();

-- 2. Bucket ------------------------------------------------------------------------------------
--
-- PRIVADO, como o ad-creatives: a maquina so recebe URL assinada de vida curta. PNG e JPG ate
-- 1 MB — o mesmo limite que o painel mostra e que o agente confere de novo antes de gravar.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('logos-empresas', 'logos-empresas', false, 1048576, array['image/png', 'image/jpeg'])
  on conflict (id) do nothing;

-- Cada empresa so enxerga e so envia dentro da propria pasta (<tenant_id>/...). Enviar e coisa
-- de administrador, a mesma regra do tenant_settings_update; ler e de qualquer usuario da
-- empresa, para a pre-visualizacao. Toda logo nova sobe com nome novo, entao nao ha politica
-- de sobrescrever; a antiga fica no bucket, sem uso (arquivo pequeno, raro).
create policy logos_empresas_ler on storage.objects
  for select to authenticated
  using (
    bucket_id = 'logos-empresas'
    and (
      private.is_super_admin()
      or (storage.foldername(name))[1] = private.current_tenant_id()::text
    )
  );

create policy logos_empresas_enviar on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'logos-empresas'
    and (
      private.is_super_admin()
      or (private.current_app_role() = 'admin'::public.user_role
          and (storage.foldername(name))[1] = private.current_tenant_id()::text)
    )
  );

-- 3. O que vai para a maquina -----------------------------------------------------------------
--
-- Uma linha quando a empresa dona da maquina tem logo E tem direito a ela; nenhuma linha nos
-- outros casos, e a session-ingest manda a maquina tirar a logo que tiver.
create or replace function public.marca_da_maquina(p_device_id uuid)
returns table (nome text, logo_path text, versao text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(nullif(btrim(ts.display_name), ''), t.name),
         ts.logo_path,
         to_char(coalesce(ts.logo_atualizada_em, ts.updated_at) at time zone 'UTC',
                 'YYYYMMDD"T"HH24MISSUS')
    from public.address_book ab
    join public.tenants t on t.id = ab.tenant_id
    join public.tenant_settings ts on ts.tenant_id = ab.tenant_id
   where ab.id = p_device_id
     and ts.logo_path is not null
     and t.is_active
     and t.billing_mode = 'plan'
     and t.billing_status in ('active', 'trialing', 'dunning');
$fn$;

revoke all on function public.marca_da_maquina(uuid) from public, anon, authenticated;
grant execute on function public.marca_da_maquina(uuid) to service_role;

comment on function public.marca_da_maquina(uuid) is
  'Logo da empresa para o app do computador: nome, caminho no bucket logos-empresas e versao. So para plano pago ou em teste; sem linha = a maquina tira a logo. Chamada pela session-ingest no presence.';
