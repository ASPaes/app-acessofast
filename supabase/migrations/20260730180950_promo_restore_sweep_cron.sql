-- AcessoFast — agendamento do promo-restore-sweep
--
-- POR QUE EXISTE
-- Quando um voucher da desconto por N meses num plano mensal, quem devolve o
-- preco cheio na assinatura e a asaas-webhook-prod, na hora em que a N-esima
-- cobranca e paga. Se aquele PUT no Asaas falhar (5xx, timeout, instabilidade),
-- a janela fica 'active' com payments_counted >= N e ninguem mexe nela ate a
-- cobranca seguinte — ou seja, o cliente ganharia um mes extra de desconto.
-- Este tick varre essas janelas de hora em hora e refaz o PUT.
--
-- No caminho feliz nao faz nada: sai na primeira checagem sem abrir conexao.

create or replace function private.promo_restore_sweep_tick()
returns void
language plpgsql
volatile
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_key text;
begin
  -- Nada pendente e o caso normal: a webhook ja restaurou na hora. Sair aqui
  -- evita acordar a edge function 24x por dia a toa.
  if not exists (select 1 from public.promo_windows_due_restore(1)) then
    return;
  end if;

  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name = 'service_role_key'
   limit 1;

  -- Sem o segredo o job nao tem como se autenticar. Avisa e sai em silencio em
  -- vez de disparar um 401 por hora.
  if v_key is null or btrim(v_key) = '' then
    raise warning 'promo_restore_sweep_tick: ha janela pendente mas o segredo service_role_key nao esta no Vault';
    return;
  end if;

  perform net.http_post(
    url     := 'https://plmfyibyrowbgjjyblcl.supabase.co/functions/v1/promo-restore-sweep',
    headers := jsonb_build_object(
                 'content-type',  'application/json',
                 'Authorization', 'Bearer ' || v_key
               ),
    body    := '{}'::jsonb
  );
end;
$$;

revoke all on function private.promo_restore_sweep_tick() from public, anon, authenticated;

select cron.schedule(
  'acessofast_promo_restore_sweep',
  '47 * * * *',
  $job$select private.promo_restore_sweep_tick();$job$
);
