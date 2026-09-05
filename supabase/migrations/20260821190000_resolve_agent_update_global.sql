-- Alvo de auto-update para maquina que ainda NAO esta no address_book.
--
-- POR QUE EXISTE
-- O auto-update do agente pega carona no evento 'presence' do session-ingest, e o
-- resolve_agent_update() parte de address_book.id. Maquina nao adotada nao tem
-- linha la: recebe 404 e, portanto, nunca recebe update. Sao exatamente as 57
-- maquinas presas no laco de matricula — as que MAIS precisam da correcao, e as
-- unicas que o caminho normal nao alcanca.
--
-- Isso as tornava permanentemente inalcancaveis: para corrigir o agente delas
-- seria preciso ir na maquina. Com esta funcao o servidor consegue entregar a
-- correcao pelo mesmo canal que ja existe.
--
-- SEGURANCA
-- Entregar o bloco de update sem autenticar o chamador NAO afrouxa nada: o agente
-- so aplica release cuja assinatura Ed25519 do par (version, sha256) confere com a
-- chave publica embutida nele (update.go, verificaAssinatura), e ainda confere o
-- sha256 do binario baixado. A ancora de confianca e a assinatura, nao o
-- transporte. A URL aponta para release publica do GitHub — nao ha segredo aqui.
--
-- DIFERENCA PARA resolve_agent_update()
-- So o alvo GLOBAL (agent_update_policy). Sem device nao ha override por
-- dispositivo nem por tenant — e nem faria sentido: nao sabemos de quem ela e.

create or replace function public.resolve_agent_update_global(
  p_rustdesk_id     text,
  p_current_version text
)
returns table(version text, url text, sha256 text, signature text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with alvo as (
    select
      pol.target_version as version,
      -- A plataforma vem do claim que a maquina registrou na matricula, que e a
      -- unica coisa que sabemos sobre ela. Sem claim, assume windows: e a frota
      -- inteira hoje, e mandar o alvo errado apenas faz o agente ignorar (a
      -- assinatura nao confere com outro binario).
      coalesce(
        (
          select case
                   when c.os ilike 'android%' then 'android'
                   when c.os ilike 'windows%' then 'windows'
                 end
            from private.device_claims c
           where c.rustdesk_id = p_rustdesk_id
             and c.os is not null
           order by c.created_at desc
           limit 1
        ),
        'windows'
      ) as platform
    from public.agent_update_policy pol
    limit 1
  )
  select r.version, r.url, r.sha256, r.signature
    from public.agent_releases r
    join alvo a
      on r.version  = a.version
     and r.platform = a.platform
   where r.version is distinct from coalesce(p_current_version, '');
$function$;

comment on function public.resolve_agent_update_global(text, text) is
  'Alvo de auto-update (global) para maquina fora do address_book. Chamada so pelo session-ingest no caminho device_not_registered.';

-- Quem chama e a edge function, com service_role. Ninguem mais precisa.
revoke all on function public.resolve_agent_update_global(text, text) from public, anon, authenticated;
grant execute on function public.resolve_agent_update_global(text, text) to service_role;
