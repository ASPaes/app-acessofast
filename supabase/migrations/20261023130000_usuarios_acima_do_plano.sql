-- AcessoFast, 23/10/2026: a empresa pode contratar um plano MENOR que o numero de
-- usuarios ativos (decisao do Ryan: nao se recusa a venda). Enquanto houver mais
-- usuarios ativos que o plano permite, NINGUEM da empresa conecta, e o admin cai numa
-- tela obrigatoria no painel para escolher quem bloquear. Bloquear e
-- profiles.is_active = false: nada e apagado, e o usuario volta se houver vaga.
--
-- O QUE JA EXISTIA E SEGUE VALENDO: trg_enforce_seat_limit recusa ATIVAR usuario sem
-- vaga (seat_limit_exceeded). Depois do ajuste, ninguem volta sem vaga.
--
-- FORA DA REGRA: super_admin (acesso geral), igual ao bloqueio por pagamento. A sessao
-- que ja estava aberta nao cai: o corte e avaliado na abertura (regra de 15/09).
--
-- A CONTAGEM e a mesma da create-renewal-prod e do painel: profiles ativos da empresa,
-- sem super_admin, contra tenants.seat_limit (que a assign_plan grava ao contratar).
--
-- COMO AS TRES FUNCOES MUDAM: a copia delas no repo ja nao bate com o banco (md5
-- conferido em 23/10/2026). Em vez de reescrever ~15 mil caracteres a mao, o bloco do
-- fim pega a definicao PUBLICADA e insere a checagem logo depois da de conta suspensa.
-- Se o ponto de insercao nao aparecer exatamente uma vez, aborta e nada muda. Rodar de
-- novo nao duplica: a funcao que ja tem a checagem e pulada.

create or replace function private.usuarios_acima_do_plano(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $fn$
  select coalesce(
           (select count(*) from public.profiles p
             where p.tenant_id = t.id
               and p.is_active
               and p.role <> 'super_admin'::public.user_role) > t.seat_limit,
           false)
    from public.tenants t
   where t.id = p_tenant
$fn$;

-- So as funcoes do proprio banco chamam (elas rodam como dono). O painel calcula a
-- mesma coisa com seat_limit e a contagem de usuarios que ele ja le.
revoke all on function private.usuarios_acima_do_plano(uuid) from public, anon, authenticated;

do $do$
declare
  v_alvo record;
  v_def  text;
begin
  for v_alvo in
    select * from (values
      -- painel e app, etapa 1 (so leitura)
      ('public.billing_eligibility(uuid,uuid)',
       E'blocked_reason := ''billing_blocked''; return next; return;\n  end if;',
       E'\n\n  -- Mais usuarios ativos que o plano permite (contratou plano menor): ninguem\n'
       || E'  -- conecta ate o admin escolher quem bloquear. Ver 20261023130000.\n'
       || E'  if private.usuarios_acima_do_plano(v_tenant) then\n'
       || E'    blocked_reason := ''usuarios_acima_do_plano''; return next; return;\n'
       || E'  end if;'),
      -- painel e app, etapa 2 (gate + emissao)
      ('public.create_access_grant(uuid,uuid,text,text,text)',
       E'detail = format(''conta bloqueada (%s)'', v_status);\n  end if;',
       E'\n\n  if v_role is distinct from ''super_admin''::public.user_role\n'
       || E'     and private.usuarios_acima_do_plano(v_tenant) then\n'
       || E'    raise exception ''usuarios_acima_do_plano''\n'
       || E'      using errcode = ''P0001'', detail = ''mais usuarios ativos que o plano permite'';\n'
       || E'  end if;'),
      -- acesso direto (session-ingest): blocked -> o agente corta na hora
      ('public.meter_external_session(text,uuid,text)',
       E'blocked := true; reason := ''billing_blocked''; return next; return;\n  end if;',
       E'\n\n  if private.usuarios_acima_do_plano(v_tenant) then\n'
       || E'    blocked := true; reason := ''usuarios_acima_do_plano''; return next; return;\n'
       || E'  end if;')
    ) as x(func, ancora, bloco)
  loop
    v_def := pg_get_functiondef(v_alvo.func::regprocedure);

    if position('usuarios_acima_do_plano' in v_def) > 0 then
      raise notice '% ja tem a checagem; pulando', v_alvo.func;
      continue;
    end if;

    if (length(v_def) - length(replace(v_def, v_alvo.ancora, ''))) / length(v_alvo.ancora) <> 1 then
      raise exception 'ponto de insercao nao encontrado (ou repetido) em %', v_alvo.func;
    end if;

    execute replace(v_def, v_alvo.ancora, v_alvo.ancora || v_alvo.bloco);
  end loop;
end
$do$;

-- Conferencia: as tres com a checagem.
select p.proname, position('usuarios_acima_do_plano' in p.prosrc) > 0 as tem_checagem
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('billing_eligibility', 'create_access_grant', 'meter_external_session');
