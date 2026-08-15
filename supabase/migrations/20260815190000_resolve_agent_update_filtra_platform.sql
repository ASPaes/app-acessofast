-- resolve_agent_update: casar o release tambem por PLATAFORMA, nao so por versao.
--
-- O bug: a versao original casava `r.version = <alvo>` e mais nada. Como o alvo
-- global/tenant e apenas uma string de versao, bastava apontar o alvo para um
-- release Android para que TODA maquina Windows do escopo recebesse aquele binario
-- — e o agente aceitaria: a assinatura e o sha256 conferem, porque o release e
-- legitimo, so que da plataforma errada. O resultado seria trocar o .exe do
-- servico Windows por um artefato Android, ou seja, agente morto na frota inteira
-- do escopo. Nada disso aconteceu (hoje o catalogo so tem release Windows), mas o
-- furo se fecha antes do primeiro release mobile ser catalogado, nao depois.
--
-- Por que derivar a plataforma de address_book.os: nao existe coluna de plataforma
-- normalizada. O `os` e texto livre reportado pelo agente ("Windows 10.0.19045",
-- "Android BP2A.250605...", "windows", e 1 device com null). O prefixo e estavel e
-- suficiente para decidir entre os dois valores que agent_releases.platform usa.
--
-- FAIL-CLOSED de proposito: `os` nulo ou irreconhecivel resolve para NULL, o join
-- nao casa e o device simplesmente NAO recebe update. Preferimos uma maquina que
-- deixa de atualizar a uma maquina que recebe o binario de outra plataforma — a
-- primeira se resolve com uma sessao remota, a segunda derruba o agente.
--
-- A PK de agent_releases continua sendo so (version): mudar para (version,
-- platform) quebraria a FK agent_update_policy.target_version -> agent_releases.
-- Consequencia conhecida: a mesma string de versao nao pode existir para as duas
-- plataformas. Hoje nao colide (Windows e mobile saem de commits diferentes, e a
-- versao carrega o sha7), e se um dia colidir o insert falha ALTO, na cara de quem
-- cataloga — nao silenciosamente em producao.
create or replace function public.resolve_agent_update(
  p_device_id       uuid,
  p_current_version text
)
returns table (version text, url text, sha256 text, signature text)
language sql
stable
security definer
set search_path = public
as $$
  with alvo as (
    select
      coalesce(ab.agent_target_version,
               ts.agent_target_version,
               pol.target_version) as version,
      case
        when ab.os ilike 'android%' then 'android'
        when ab.os ilike 'windows%' then 'windows'
      end                          as platform
      from public.address_book ab
      left join public.tenant_settings ts on ts.tenant_id = ab.tenant_id
      cross join public.agent_update_policy pol
     where ab.id = p_device_id
  )
  select r.version, r.url, r.sha256, r.signature
    from public.agent_releases r
    join alvo a
      on r.version  = a.version
     and r.platform = a.platform
   where r.version is distinct from coalesce(p_current_version, '');
$$;

comment on function public.resolve_agent_update(uuid, text) is
  'Resolve o alvo de auto-update (device -> tenant -> global) e devolve o release '
  'da PLATAFORMA do device, ou zero linhas se nao ha o que atualizar. Chamada pela '
  'session-ingest a cada presence.';

-- Reafirma o grant. `create or replace` preserva a ACL da funcao existente, mas
-- deixar explicito e barato e garante o estado final mesmo se a funcao for criada
-- do zero num ambiente novo — onde o ALTER DEFAULT PRIVILEGES daria EXECUTE ao
-- anon (foi o que motivou a 20260812162229).
revoke all on function public.resolve_agent_update(uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_agent_update(uuid, text) to service_role;
