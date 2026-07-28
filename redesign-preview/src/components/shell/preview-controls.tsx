import * as React from "react";
import { FlaskConical, X } from "lucide-react";
import { cx } from "@preview/lib/cx";
import { Button, IconButton } from "@preview/components/ui/button";
import { Field, Select } from "@preview/components/ui/field";
import { useNavegar } from "@preview/lib/router";
import {
  usePreview,
  type Densidade,
  type EstadoBanner,
  type EstadoDados,
  type EstiloPainel,
} from "@preview/data/preview-state";
import type { Papel } from "@preview/data/mock";

/**
 * Painel de controle EXCLUSIVO do preview.
 * Não corresponde a nada do app real — existe só para o avaliador percorrer
 * papéis, densidades e estados (carregando / vazio / erro / cobrança) sem
 * precisar de backend.
 */
export function PreviewControls() {
  const [aberto, setAberto] = React.useState(false);
  const p = usePreview();
  const navegar = useNavegar();

  return (
    <>
      {!aberto && (
        <button
          type="button"
          onClick={() => setAberto(true)}
          className={cx(
            "fixed bottom-4 right-4 z-[var(--af-z-toast)] inline-flex h-10 items-center gap-2 rounded-full",
            "border border-line bg-surface-raised px-4 text-[12.5px] font-medium text-ink shadow-pop",
            "transition-colors duration-[var(--af-dur-hover)] hover:bg-surface-hover",
          )}
        >
          <FlaskConical className="size-4 text-primary-light" aria-hidden />
          Preview
        </button>
      )}

      {aberto && (
        <aside
          aria-label="Controles do preview"
          className={cx(
            "af-anim-pop fixed bottom-4 right-4 z-[var(--af-z-toast)] w-[290px] overflow-hidden",
            "rounded-xl border border-line bg-surface-raised shadow-modal",
          )}
        >
          <div aria-hidden className="af-brand-line h-[2px] w-full" />
          <header className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
            <div>
              <p className="text-[13px] font-semibold text-ink">Controles do preview</p>
              <p className="text-[11.5px] text-muted">Não existe no app real</p>
            </div>
            <IconButton label="Fechar controles" size="sm" onClick={() => setAberto(false)}>
              <X aria-hidden />
            </IconButton>
          </header>

          <div className="space-y-3 px-4 pb-4">
            <Field label="Papel do usuário" htmlFor="pv-papel">
              <Select
                id="pv-papel"
                selectSize="sm"
                value={p.papel}
                onChange={(e) => p.setPapel(e.target.value as Papel)}
              >
                <option value="super_admin">Super Admin</option>
                <option value="admin">Administrador</option>
                <option value="head">Supervisor</option>
                <option value="tech">Técnico</option>
              </Select>
            </Field>

            <Field label="Estado dos dados" htmlFor="pv-dados">
              <Select
                id="pv-dados"
                selectSize="sm"
                value={p.dados}
                onChange={(e) => p.setDados(e.target.value as EstadoDados)}
              >
                <option value="normal">Normal</option>
                <option value="carregando">Carregando</option>
                <option value="vazio">Vazio</option>
                <option value="erro">Erro</option>
              </Select>
            </Field>

            <Field label="Faixa de cobrança" htmlFor="pv-banner">
              <Select
                id="pv-banner"
                selectSize="sm"
                value={p.banner}
                onChange={(e) => p.setBanner(e.target.value as EstadoBanner)}
              >
                <option value="nenhum">Nenhuma</option>
                <option value="trial_ativo">Teste grátis ativo</option>
                <option value="trial_expirado">Teste expirado</option>
                <option value="vencendo">Plano vencendo</option>
                <option value="past_due">Pagamento pendente</option>
                <option value="suspenso">Suspenso</option>
              </Select>
            </Field>

            <Field label="Densidade" htmlFor="pv-dens">
              <Select
                id="pv-dens"
                selectSize="sm"
                value={p.densidade}
                onChange={(e) => p.setDensidade(e.target.value as Densidade)}
              >
                <option value="confortavel">Confortável (52px)</option>
                <option value="compact">Compacta (44px)</option>
              </Select>
            </Field>

            <Field label="Acabamento dos painéis" htmlFor="pv-painel">
              <Select
                id="pv-painel"
                selectSize="sm"
                value={p.estiloPainel}
                onChange={(e) => p.setEstiloPainel(e.target.value as EstiloPainel)}
              >
                <option value="vidro">Vidro (translúcido)</option>
                <option value="solido">Sólido (opaco)</option>
              </Select>
            </Field>

            <Field label="Fundo animado" htmlFor="pv-fundo">
              <Select
                id="pv-fundo"
                selectSize="sm"
                value={p.fundoAnimado ? "on" : "off"}
                onChange={(e) => p.setFundoAnimado(e.target.value === "on")}
              >
                <option value="on">Ligado (constelação)</option>
                <option value="off">Desligado (só as manchas)</option>
              </Select>
            </Field>

            <div className="flex flex-wrap gap-2 border-t border-line-subtle pt-3">
              <Button size="sm" variant="secondary" onClick={() => navegar("/auth")}>
                Login
              </Button>
              <Button size="sm" variant="secondary" onClick={() => navegar("/definir-senha")}>
                Definir senha
              </Button>
              <Button size="sm" variant="secondary" onClick={() => navegar("/design-system")}>
                Design system
              </Button>
              <Button size="sm" variant="ghost" onClick={() => navegar("/404")}>
                404
              </Button>
              <Button size="sm" variant="ghost" onClick={() => navegar("/erro")}>
                Erro
              </Button>
            </div>
          </div>
        </aside>
      )}
    </>
  );
}
