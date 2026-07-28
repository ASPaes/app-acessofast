import * as React from "react";
import {
  Activity,
  Building2,
  History,
  LayoutDashboard,
  MonitorSmartphone,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  SlidersHorizontal,
  Store,
  Users,
  Wallet,
} from "lucide-react";
import { cx } from "@preview/lib/cx";
import type { Rota } from "@preview/lib/router";
import { Link } from "@preview/lib/router";
import { Tooltip } from "@preview/components/ui/overlay";
import { LOGO_ACESSOFAST } from "@preview/lib/brand";
import { usePreview } from "@preview/data/preview-state";

type Item = { titulo: string; rota: Rota; Icone: typeof LayoutDashboard };

// Mesmos itens, mesmos rótulos e mesmos agrupamentos da sidebar atual.
const OPERACAO: Item[] = [
  { titulo: "Visão geral", rota: "/dashboard", Icone: LayoutDashboard },
  { titulo: "Dispositivos", rota: "/dispositivos", Icone: MonitorSmartphone },
  { titulo: "Clientes", rota: "/clientes", Icone: Store },
  { titulo: "Auditoria", rota: "/auditoria", Icone: History },
];

const GESTAO: Item[] = [
  { titulo: "Usuários", rota: "/usuarios", Icone: Users },
  { titulo: "Financeiro", rota: "/financeiro", Icone: Wallet },
  { titulo: "Monitoramento", rota: "/monitoramento", Icone: Activity },
  { titulo: "Configurações", rota: "/configuracoes", Icone: Settings },
];

const PLATAFORMA: Item[] = [
  { titulo: "Empresas", rota: "/empresas", Icone: Building2 },
  { titulo: "Planos", rota: "/planos", Icone: SlidersHorizontal },
];

export function Sidebar({
  rota,
  recolhida,
  onToggle,
}: {
  rota: Rota;
  recolhida: boolean;
  onToggle: () => void;
}) {
  const { isSuper } = usePreview();

  return (
    <nav
      aria-label="Navegação principal"
      style={{ width: recolhida ? "var(--af-sidebar-w-collapsed)" : "var(--af-sidebar-w)" }}
      className={cx(
        // `relative` é o que permite a sidebar ficar acima da camada ambiente.
        "relative z-[var(--af-z-sidebar)] flex shrink-0 flex-col",
        // Translúcida: a constelação e as manchas atravessam, então a navegação
        // parece recortada do próprio fundo. O que a separa não é opacidade —
        // é o tingimento levemente mais escuro, o degradê azul e a borda.
        // Não leva `backdrop-blur`: só a camada ambiente passa por trás dela, e
        // essa camada já é desfocada — blur aqui seria custo sem ganho.
        "border-r border-line bg-sidebar/55",
        "bg-[linear-gradient(180deg,rgba(47,107,255,0.07)_0%,rgba(47,107,255,0.02)_30%,transparent_64%)]",
        "transition-[width] duration-[var(--af-dur-menu)] ease-[var(--af-ease)]",
      )}
    >
      {/* Marca. Sem borda inferior de propósito: a sidebar é uma coluna
          contínua, não uma pilha de blocos. A altura acompanha a da barra
          superior só para o logo alinhar com o breadcrumb ao lado. */}
      <div
        className={cx(
          "flex h-[var(--af-topbar-h)] shrink-0 items-center gap-2.5",
          recolhida ? "justify-center px-0" : "px-4",
        )}
      >
        <img src={LOGO_ACESSOFAST} alt="" aria-hidden className="size-7 shrink-0 object-contain" />
        {!recolhida && (
          <span className="min-w-0 leading-none">
            <span className="block truncate text-[14px] font-semibold tracking-[-0.01em] text-ink">
              AcessoFast
            </span>
            <span className="mt-1 block text-[10px] uppercase tracking-[0.14em] text-muted">
              acesso remoto
            </span>
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        <Grupo titulo="Operação" itens={OPERACAO} rota={rota} recolhida={recolhida} />
        <Grupo titulo="Gestão" itens={GESTAO} rota={rota} recolhida={recolhida} />
        {isSuper && (
          <Grupo titulo="Plataforma" itens={PLATAFORMA} rota={rota} recolhida={recolhida} />
        )}
      </div>

      <div className="shrink-0 border-t border-line-subtle p-2">
        <Tooltip content={recolhida ? "Expandir menu" : "Recolher menu"} side="right">
          <button
            type="button"
            onClick={onToggle}
            aria-label={recolhida ? "Expandir menu lateral" : "Recolher menu lateral"}
            aria-expanded={!recolhida}
            className={cx(
              "flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-[12.5px] text-muted",
              "transition-colors duration-[var(--af-dur-hover)] hover:bg-surface-hover hover:text-ink",
              recolhida && "justify-center px-0",
            )}
          >
            {recolhida ? (
              <PanelLeftOpen className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
            ) : (
              <>
                <PanelLeftClose className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                Recolher menu
              </>
            )}
          </button>
        </Tooltip>
      </div>
    </nav>
  );
}

function Grupo({
  titulo,
  itens,
  rota,
  recolhida,
}: {
  titulo: string;
  itens: Item[];
  rota: Rota;
  recolhida: boolean;
}) {
  return (
    <div className="mb-1.5">
      {recolhida ? (
        <div aria-hidden className="mx-2 my-2 h-px bg-line-subtle" />
      ) : (
        <p className="af-eyebrow px-2.5 pb-1.5 pt-2.5">{titulo}</p>
      )}
      <ul className="space-y-0.5">
        {itens.map((item) => (
          <li key={item.rota}>
            <ItemNav item={item} ativo={rota === item.rota} recolhida={recolhida} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ItemNav({ item, ativo, recolhida }: { item: Item; ativo: boolean; recolhida: boolean }) {
  const link = (
    <Link
      to={item.rota}
      aria-current={ativo ? "page" : undefined}
      className={cx(
        "relative flex h-9 items-center gap-2.5 rounded-md text-[13px]",
        "transition-colors duration-[var(--af-dur-hover)]",
        recolhida ? "justify-center px-0" : "px-2.5",
        ativo
          ? "bg-primary-soft font-medium text-ink"
          : "text-ink-2 hover:bg-surface-hover hover:text-ink",
      )}
    >
      {ativo && (
        <span
          aria-hidden
          className="absolute -left-2 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-primary"
        />
      )}
      <item.Icone
        className={cx("size-4 shrink-0", ativo ? "text-primary-light" : "text-muted")}
        strokeWidth={1.75}
        aria-hidden
      />
      {!recolhida && <span className="truncate">{item.titulo}</span>}
    </Link>
  );

  if (!recolhida) return link;
  return (
    <Tooltip content={item.titulo} side="right">
      {link}
    </Tooltip>
  );
}
