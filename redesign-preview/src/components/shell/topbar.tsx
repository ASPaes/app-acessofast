import * as React from "react";
import { ChevronDown, ChevronRight, LogOut } from "lucide-react";
import { cx } from "@preview/lib/cx";
import type { Rota } from "@preview/lib/router";
import { StatusBadge } from "@preview/components/ui/badge";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from "@preview/components/ui/overlay";
import { usePreview } from "@preview/data/preview-state";
import { ROTULO_PAPEL, USUARIO_ATUAL, VPS } from "@preview/data/mock";

const TITULOS: Partial<Record<Rota, string>> = {
  "/dashboard": "Visão geral",
  "/dispositivos": "Dispositivos",
  "/clientes": "Clientes",
  "/auditoria": "Auditoria",
  "/usuarios": "Usuários",
  "/financeiro": "Financeiro",
  "/monitoramento": "Monitoramento",
  "/configuracoes": "Configurações",
  "/empresas": "Empresas",
  "/planos": "Planos",
  "/design-system": "Design system",
};

export function Topbar({ rota }: { rota: Rota }) {
  const { escopo, isSuper, papel } = usePreview();
  const titulo = TITULOS[rota] ?? "";

  return (
    <header
      className={cx(
        "sticky top-0 z-[var(--af-z-sticky)] flex h-[var(--af-topbar-h)] shrink-0 items-center gap-3",
        // Translúcida, como a sidebar. Aqui o `backdrop-blur` é obrigatório —
        // não pelo estilo, mas porque a tabela rola por baixo desta barra: sem
        // o borrão, o texto do conteúdo apareceria através do cabeçalho.
        "border-b border-line bg-bg/60 px-4 backdrop-blur-xl sm:px-6",
      )}
    >
      <nav aria-label="Você está em" className="flex min-w-0 items-center gap-1.5 text-[13px]">
        <span className="hidden truncate text-muted sm:inline">{escopo}</span>
        <ChevronRight aria-hidden className="hidden size-3.5 shrink-0 text-muted sm:inline" />
        <span className="truncate font-medium text-ink">{titulo}</span>
      </nav>

      <div className="ml-auto flex items-center gap-3">
        {isSuper && <SaudeRelay />}
        <span aria-hidden className="hidden h-5 w-px bg-line-subtle sm:block" />
        <MenuUsuario papel={ROTULO_PAPEL[papel]} />
      </div>
    </header>
  );
}

/** Pílula de saúde do relay — só para super_admin, igual ao HealthPill atual. */
function SaudeRelay() {
  const ok = VPS.capturado_ha_s <= 60;
  return ok ? (
    <StatusBadge tone="success" pulse>
      Servidor operacional
    </StatusBadge>
  ) : (
    <StatusBadge tone="warning">{`Coletor parado há ${VPS.capturado_ha_s}s`}</StatusBadge>
  );
}

function iniciais(nome: string) {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1]![0] : "")).toUpperCase();
}

function MenuUsuario({ papel }: { papel: string }) {
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button
          type="button"
          className={cx(
            "flex h-9 items-center gap-2.5 rounded-md px-1.5 pr-2",
            "transition-colors duration-[var(--af-dur-hover)] hover:bg-surface-hover",
            "data-[state=open]:bg-surface-hover",
          )}
        >
          <span
            aria-hidden
            className="grid size-7 shrink-0 place-items-center rounded-md bg-primary-soft text-[11px] font-semibold text-primary-light"
          >
            {iniciais(USUARIO_ATUAL.nome)}
          </span>
          <span className="hidden min-w-0 flex-col items-start leading-tight sm:flex">
            <span className="max-w-[150px] truncate text-[12.5px] font-medium text-ink">
              {USUARIO_ATUAL.nome}
            </span>
            <span className="text-[10.5px] text-muted">{papel}</span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted" strokeWidth={1.75} aria-hidden />
          <span className="sr-only">Abrir menu da conta</span>
        </button>
      </DropdownTrigger>
      <DropdownContent>
        <DropdownLabel>Conta</DropdownLabel>
        <div className="px-2.5 pb-2">
          <p className="truncate text-[13px] text-ink">{USUARIO_ATUAL.nome}</p>
          <p className="truncate text-[12px] text-muted">{USUARIO_ATUAL.email}</p>
        </div>
        <DropdownSeparator />
        <DropdownItem destructive icon={<LogOut />}>
          Sair
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}
