# HANDOFF — AcessoFast (continuar amanhã)

> **Sessão 2026-07-23/24.** Estado: **Fase 1 (quota) e Fase 2 (senha efêmera) DEPLOYADAS e VALIDADAS em produção.** Fase 3 (fechar a brecha) **desenhada, não implementada**.
> **Retomar em:** validações **§7 #1–#4** do `FASE3-DESIGN.md` (a #1 é bloqueante). Depois: diff do `build-client.yml` + patch do agente.
> Substitui o handoff anterior (deploy do `rotate-device-secret`, já concluído). O `CONTEXT.md` está desatualizado — ignore.

---

## ⚠️ Regras de ambiente — LER PRIMEIRO
1. **PRIMEIRO comando: `get_project_url`.** Tem que ser **`plmfyibyrowbgjjyblcl`**. Se vier `ygevmtqzainzcjrqxenr` (é o `Supa_Hiper`, projeto DIFERENTE) → **PARE**.
2. Usar o MCP **`supabase-acessofast`** (correto). **NÃO** usar `claude.ai Supa Hiper`.
3. Schema vivo está à frente das migrations locais; fonte de verdade = `src/integrations/supabase/types.ts`. Deploy de edge function via MCP.
4. Repos: **painel** = este repo · **agente** = `github.com/ASPaes/acessofast-agent` (Go; `main` tem a Fase 2). **Projeto do instalador** (fora do repo): `C:\Users\Usuario\Downloads\AcessoFast-Installer-20260719T163857Z-1-001\AcessoFast-Installer\`.

## ✅ O que ficou pronto nesta sessão
- **`rotate-device-secret` DEPLOYADO** (v1, `verify_jwt=false`). RPC `set_device_secret` confere.
- **Agente Fase 2** baixado do CI (artifact `acessofast-agent-windows-x64`, run `30014641491`), trocado no `payload\` (backup em `acessofast-agent.exe.sunday-bak`), e **instalador recompilado** → `...\Output\AcessoFastSetup.exe` (não assinado; SmartScreen → "Executar assim mesmo").
- **Fase 2 VALIDADA** em prod: `private.device_secrets.updated_at` ~0,75s após o fim da sessão, `updated_by=null` (=escrito pelo agente).
- **Fase 1 VALIDADA**: com `max_concurrent_per_tech=1`, a 2ª conexão simultânea do admin `suporte4` deu `429 quota_exceeded`; **restaurado pra `null`** depois.
- **Design da Fase 3** escrito: **`FASE3-DESIGN.md`** (raiz) + artifact web: https://claude.ai/code/artifact/ac9306ca-d639-4a1c-bc3d-56b6114e6d7d

## ⚠️ Estado da máquina de teste (canary)
- Desde 2026-07-24 o `custom_.txt` do device de teste (rustdesk_id `51200651`) está com a **base §4.1 completa: `approve-mode:"password"` + `allow-remote-config-modification:"N"`** (canary). Diverge do build shipado (`password-click`/`Y`). Backup em `C:\Program Files\AcessoFast\custom_.txt.bak-Y`. Rollback: `Copy-Item '...\custom_.txt.bak-Y' '...\custom_.txt' -Force; Restart-Service AcessoFast,AcessoFastAgent -Force`.

## Dados de referência (device/tenant de teste)
- Device: `id 27ef8ea6-24a0-4642-9429-9bffb70a9d2c`, `rustdesk_id 51200651`, tenant **ASP** `ebd17e4e-d158-4164-a235-e8fd53cbf895`.
- Tenant ASP: `max_concurrent_per_tech=null` (ilimitado), `billing_exempt=true`.
- Papéis: `luizhansen751@gmail.com` e `asp@…` = **super_admin** (furam o gate). `suporte4@aspsoftwares.com.br` = **admin** → **usar este pra testar quota**.
- Secret vive em `private.device_secrets` (upsert 1 linha/device). "Grant" = linha `active` em `public.connection_logs`. Gate = `create_access_grant` conta `active` por `technician_id`.

---

## 🎯 TAREFA DE AMANHÃ — validações §7 (destravam a Fase 3)
Rodar na máquina de teste (o device está lá). A **#1 é BLOQUEANTE** — decide se a "base" da Fase 3 é viável como desenhada.

1. **[BLOQUEANTE] ✅ VALIDADO 2026-07-24** — `allow-remote-config-modification:"N"` **NÃO** bloqueia o `AcessoFast.exe --password` local do agente. **A base da Fase 3 (§4.1) é viável.**
   → Método usado: flip local do `custom_.txt` (`override-settings`, mesmo mecanismo do CI) → `N`, restart dos serviços, `--password` como SYSTEM via `Register-ScheduledTask`. Confirmado pelos dois lados: (a) conexão de controlador autenticou com a senha setada sob N; (b) rotação real do agente gravou `private.device_secrets` (`updated_at` 10:20 BRT, `updated_by=null`) sob N. `approve-mode` ficou `password-click` (não mexido). Script: `scratchpad/fase3-teste1-flip-N.ps1` (+ `-step4-fix.ps1`).
2. **✅ VALIDADO 2026-07-24** — a senha permanente **persiste no reboot** (idêntica antes/depois) e o painel serve ela direto ao técnico. `device_secrets` **não** rotacionou no boot (`updated_at` inalterado através do reboot, `updated_by=null`) — confirma que o agente Fase 2 ainda não faz rotate-on-boot (feature da Fase 3). ⇒ **R2a real:** senha sobrevive ao reboot → sem rotate-on-boot, uma senha vazada segue válida pós-reboot (§3.2 fecha isso).
3. **✅ VALIDADO 2026-07-24** — RustDesk **NÃO** absorve blip curto: um blip de **6s derrubou a conexão E rotacionou a senha** (`device_secrets` 10:51:45, `updated_by=null`, ~0,09s após o `end`). ⇒ **R1 dispara em quedas curtas → a janela de carência (§3.1, default 60s) é necessária.**
4. **✅ VALIDADO 2026-07-24** — `approve-mode:password` **permite** múltiplas conexões simultâneas com a mesma senha (2 controladores/contas entraram juntos, mesmo IP). ⇒ **a senha é bearer; quota NÃO é imponível pela senha nem em `password` mode** (confirma furo #1). Quota fica como uso-justo/faturamento + detecção (§4.4-A). Base §4.1 completa (`approve-mode:password` + `N`) aplicada no canary via `scratchpad/fase3-base-completa-password-N.ps1`.

**Eu (Claude) verifico no banco** em cada passo (via MCP): `device_secrets.updated_at`/`updated_by`, `connection_logs` (grants/externo), contagem de `active`.

## Depois das validações → implementar (ver `FASE3-DESIGN.md` §5–§6)
1. **Base (§4.1):** diff do `custom` no `build-client.yml` → `approve-mode:"password"`, `allow-remote-config-modification:"N"`, + settings a travar (enumerar lendo o arquivo). Rebuild client (~48min) + recompilar instalador.
2. **Agente (§4.2/§3.2/§4.5):** janela de carência **60s** no último close + **rotate-on-boot** (exceto sob hold) + **reporte por-`#N` + IP do peer**.
3. **Detecção piggyback (§4.5):** correlação grants×conexões×IP no `session-ingest`.
4. **Hold de manutenção (§4.3):** botão no painel + campo `hold_until`.

## Decisões (defaults recomendados — Luiz confirma; `FASE3-DESIGN.md` §9)
- Reboot do endpoint: **continuidade** (carência + hold) vs. segurança-primeiro (rotar sempre no boot). Default: **continuidade**.
- Carência **60s** · Hold **15min** · Quota: **A (detectar)** agora, **OTP (C)** no futuro.
- Estratégia de quota A/B/C ficou **em aberto** — o Luiz redirecionou pra mapear resiliência antes; confirmar A ao retomar.

## Referências
- **Design:** `FASE3-DESIGN.md` · artifact: https://claude.ai/code/artifact/ac9306ca-d639-4a1c-bc3d-56b6114e6d7d
- **Memórias:** `acessofast-access-control-plan`, `acessofast-installer-build-flow`, `supabase-project-refs`.
- **Repo agente:** github.com/ASPaes/acessofast-agent · **Instalador:** `...\AcessoFast-Installer\` (ISCC em `C:\Program Files (x86)\Inno Setup 6\`).
- Furos abertos priorizados: **#1** (senha compartilhada burla quota — bearer, não imponível sob OSS+`-k` público) e **#2** (piggyback invisível).
