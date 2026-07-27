-- =====================================================================
-- Billing B6 — Acesso direto medido (.exe fora do portal): schema aditivo.
-- =====================================================================
-- Sessão direta (via senha de uso único / Aceitar, detectada pelo agente)
-- não tem técnico identificado — só rustdesk_id + IP do peer. Preparamos
-- `atendimentos` p/ registrar essas sessões:
--   • technician_id  -> NULLABLE (sessão direta não tem profile de técnico)
--   • origin         -> 'panel' | 'direct' (default 'panel'; linhas atuais = painel)
--   • peer_ip        -> IP do peer conectante (auditoria da sessão direta)
-- Índice de reconexão UNIFICADA por rustdesk_id (independe de técnico/origem).
-- Puramente aditivo: não altera dados existentes nem o create_access_grant
-- (isso vem na próxima migration, junto da RPC meter_external_session).
-- =====================================================================

alter table public.atendimentos
  alter column technician_id drop not null;

alter table public.atendimentos
  add column if not exists origin text not null default 'panel'
    check (origin in ('panel', 'direct'));

alter table public.atendimentos
  add column if not exists peer_ip inet;

comment on column public.atendimentos.technician_id is
  'Técnico (profile) que iniciou pelo PAINEL. NULL em sessão direta (.exe) — sem identidade de técnico.';
comment on column public.atendimentos.origin is
  'panel = iniciado pelo portal (connect-device); direct = acesso direto pelo .exe medido via session-ingest (B6).';
comment on column public.atendimentos.peer_ip is
  'IP do peer conectante, capturado do log do RustDesk (opened from <IP>). Auditoria da sessão direta.';

-- Reconexão unificada (B6 decisão 3): casa atendimento aberto por rustdesk_id na
-- janela, independente de técnico/origem. Complementa idx_atendimentos_reconnect.
create index if not exists idx_atendimentos_reconnect_rid
  on public.atendimentos (rustdesk_id)
  where ended_at is null;
