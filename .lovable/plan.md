
# Reconstrução visual e estrutural do AcessoFast

Refaço o markup (TSX/JSX) de todas as telas reais e do shell da aplicação seguindo o novo conceito visual (minimalismo técnico-operacional, paleta escura #0D1117 / azul #3B82F6, tipografia Geist + Geist Mono, densidade alta, sem gradientes/glow/glass). **Nenhuma rota, tabela, RPC, Edge Function, hook, query, callback, permissão ou integração é alterada** — só estrutura visual e composição de componentes.

## Escopo (só telas existentes)

Login, Dashboard, Dispositivos, Auditoria, Usuários, Monitoramento, Configurações, Empresas. Não crio Sessões, Clientes, Técnicos, Arquivos, Conversas, Segurança, Suporte, etc. — essas pertencem só ao mockup.

## Ordem de execução

1. **Tokens globais** em `src/styles.css`: sobrescrevo as variáveis oklch atuais pelos hex da paleta (fundo, sidebar, superfícies, bordas, textos, azul, verde, amarelo, vermelho), remoção de sombras decorativas. Carrego Geist + Geist Mono via `<link>` no `__root.tsx` head, registro `--font-sans`/`--font-mono` em `@theme`.
2. **Componentes visuais compartilhados** novos em `src/components/ui-shell/`:
   - `PageHeader`, `SectionHeader`, `MetricStrip` + `MetricItem` (faixa horizontal com divisores), `Toolbar`, `SearchField`, `FilterSelect`, `StatusDot`, `SegmentedControl`, `EmptyState`, `LoadingState`, `ModalShell` (wrapper sobre `Dialog`), `DataTableShell`.
   - Todos puramente visuais, recebendo dados/callbacks já existentes.
3. **Sidebar** (`src/components/app-sidebar.tsx`) reconstruída: 224/64 px, fundo `#0A0E14`, item ativo com barra azul lateral 2px + bg azul 10%, grupos Operação/Gestão/Plataforma preservados exatamente como hoje, rodapé só com toggle recolher/expandir. Tooltips no estado recolhido.
4. **Topbar** (`src/components/app-shell.tsx`): 56px, contexto/página à esquerda (derivado do pathname), `UserMenu` real à direita com papel discreto. Removo o subtítulo decorativo "mission control".
5. **Login** (`src/routes/auth.tsx`): layout duas colunas 42/58 no desktop, coluna esquerda `#0A0E14` com logo + ASP Softwares + título/descrição atuais + linha técnica de RLS (sem card), coluna direita com painel 400–430px centralizado. Mobile: coluna única, logo acima. Preservo integralmente form, validações, `signIn`, redirect, mensagens de erro, estado de loading; nenhum provider novo.
6. **Dashboard** (`src/routes/_authenticated/dashboard.tsx`): substituo os 4 StatCards por `MetricStrip` compacta (Usuários/Dispositivos/Sessões ativas/Sessões 24h — respeitando `isTech` que oculta Usuários). Grid 65/35 embaixo: coluna principal com "Monitoramento do relay" numa única seção com CPU/Memória/Disco separados por divisores verticais; coluna secundária com lista compacta de status (API, Banco, Coletor VPS, Realtime) sem cards individuais. Preservo `useQuery` de `me`, `stats`, `vpsMetrics` e o canal realtime.
7. **Dispositivos** (`src/routes/_authenticated/dispositivos.tsx`): `PageHeader` com contagem + botão "Adicionar dispositivo", `Toolbar` única (busca + filtro empresa p/ super_admin + switch "Mostrar inativos"). Tabela densa com colunas reais, IDs em mono, StatusDot, ações como ícones ghost (Conectar, Editar, Inativar/Reativar). Modais Conectar e Adicionar reestruturados com `ModalShell` preservando todos os campos/callbacks/RPC `set_device_active` e Edge Function `connect-device`.
8. **Auditoria** (`src/routes/_authenticated/auditoria.tsx`): `SegmentedControl` "Por máquina | Todas as sessões" no lugar dos dois botões. Tabelas reestruturadas, linha expandida em superfície elevada, datas/IP em mono.
9. **Usuários** (`src/routes/_authenticated/usuarios.tsx`): `PageHeader` com botão "Convidar membro", seção "Membros" com toolbar (filtro empresa + busca na mesma linha), tabela densa. Preservo `InviteMemberDialog`, `ResendInviteButton`, RPC `set_user_active`, AlertDialog de desativar com o texto literal já definido.
10. **Monitoramento** (`src/routes/_authenticated/monitoramento.tsx`): substituo 4 cards por faixa técnica única CPU/Memória/Disco/Rede com divisores verticais, mostrando só dados reais e último horário de coleta.
11. **Configurações** (`src/routes/_authenticated/configuracoes.tsx`): aviso "Em construção" como linha discreta, seção "Recursos habilitados" com título/aux/divisor/EmptyState — sem inventar switches.
12. **Empresas** (`src/routes/_authenticated/empresas.tsx`): `PageHeader` com "Provisionar novo tenant", tabela "Empresas cadastradas" com colunas reais (Empresa, Membros, Dispositivos, Assentos, Status, Criada em). `ProvisionTenantDialog` reestilizado sem novos campos.
13. **Botões/campos/tabelas/modais/status/ícones**: ajusto variantes shadcn (`Button`, `Input`, `Select`, `Dialog`, `Table`, `Badge`) via `src/components/ui/*` para respeitar as alturas, raios 7–8px, cores, foco sem glow, ícones Lucide 16–18px monocromáticos. Sem translateY/scale/bounce nos hovers.
14. **Responsividade**: sidebar colapsa, topbar preservada, tabelas com scroll horizontal (não viram cards), modais full-width no mobile, login em coluna única.
15. **Validação**: `bunx tsgo --noEmit`, abrir cada rota no preview via Playwright com sessão Supabase injetada, tirar screenshot e conferir estrutura (faixa em vez de 4 cards, sidebar nova, sem gradientes, tabelas densas, azul só em ações principais/ativo/foco/links).

## Preservação funcional (checklist explícito)

Rotas, `_authenticated/route.tsx`, `supabase.auth`, RLS, realtime `vps_metrics`, queries `["me"]`/`["profiles"]`/`["tenants"]`/`["devices"]`/`["dashboard-stats"]`/`["vps-metrics"]`/`["audit-*"]`, Edge Functions `invite-user` v12 / `connect-device` v5 / `provision-device-secret` / `register-device`, RPCs `set_device_active` / `set_user_active` / `has_role`, filtros `.eq("tenant_id")` explícitos para não-super_admin, roleLabel com `head: "Supervisor"`, texto literal do AlertDialog de desativar usuário, ProvisionTenantDialog sem novos campos.

## Detalhes técnicos

- **Fontes**: `<link rel="preconnect">` + `<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">` no head do `__root.tsx`. Não uso `@import` de URL em `styles.css` (Tailwind v4 Lightning CSS).
- **Tema**: mantenho a estrutura `@theme inline` + `:root` mas troco os valores oklch pelos hex da paleta (convertidos ou usados diretos em `--background: #0D1117` etc. — Tailwind v4 aceita hex em tokens). Adiciono `--font-sans: "Geist", ...` e `--font-mono: "Geist Mono", ...`. Removo bloco `.dark` conflitante (o app é dark-first já).
- **Componentes shell** vivem em `src/components/ui-shell/` para não colidir com `src/components/ui/` (shadcn).
- **Sem novas dependências**, sem novas migrations, sem novas Edge Functions, sem novos secrets.
- **Sem novos itens de menu**, sem novos botões-fantasma, sem métricas fabricadas, sem gráficos sem dado real.

## Arquivos que serão alterados

- `src/styles.css` (tokens + fontes registradas)
- `src/routes/__root.tsx` (links de fonte no head)
- `src/components/app-shell.tsx` (topbar)
- `src/components/app-sidebar.tsx` (sidebar)
- `src/components/user-menu.tsx` (papel discreto)
- `src/components/provision-tenant-dialog.tsx` (ModalShell)
- `src/routes/auth.tsx` (login 2 colunas)
- `src/routes/_authenticated/dashboard.tsx`
- `src/routes/_authenticated/dispositivos.tsx`
- `src/routes/_authenticated/auditoria.tsx`
- `src/routes/_authenticated/usuarios.tsx`
- `src/routes/_authenticated/monitoramento.tsx`
- `src/routes/_authenticated/configuracoes.tsx`
- `src/routes/_authenticated/empresas.tsx`
- Ajustes pontuais em `src/components/ui/button.tsx`, `input.tsx`, `select.tsx`, `dialog.tsx`, `table.tsx`, `badge.tsx` (variantes/tamanhos/raios) — sem quebrar API.

## Arquivos novos (só visuais)

- `src/components/ui-shell/page-header.tsx`
- `src/components/ui-shell/section-header.tsx`
- `src/components/ui-shell/metric-strip.tsx`
- `src/components/ui-shell/toolbar.tsx`
- `src/components/ui-shell/status-dot.tsx`
- `src/components/ui-shell/segmented-control.tsx`
- `src/components/ui-shell/empty-state.tsx`
- `src/components/ui-shell/modal-shell.tsx`

## Entrega

Ao final: lista dos TSX/JSX estruturalmente alterados, componentes visuais criados, páginas reconstruídas, e confirmação por screenshot de que a estrutura mudou (faixa compacta no lugar dos 4 cards, sidebar/topbar novas, tabelas densas, sem gradientes/glow, azul restrito a ação principal/ativo/foco/links).
