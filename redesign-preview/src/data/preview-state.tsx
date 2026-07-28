import * as React from "react";
import type { Papel } from "./mock";

/**
 * Estado global do PREVIEW (não existe no app real).
 * Serve só para o avaliador trocar papel, densidade e o estado dos dados
 * (normal / carregando / vazio / erro) e ver como cada tela reage — os mesmos
 * estados que o painel real já produz hoje com TanStack Query.
 */

export type EstadoDados = "normal" | "carregando" | "vazio" | "erro";

export type EstadoBanner =
  | "nenhum"
  | "trial_ativo"
  | "trial_expirado"
  | "vencendo"
  | "past_due"
  | "suspenso";

export type Densidade = "confortavel" | "compact";

/** Acabamento das superfícies: opaca (padrão do sistema) ou vidro fosco. */
export type EstiloPainel = "solido" | "vidro";

type Ctx = {
  papel: Papel;
  setPapel: (p: Papel) => void;
  dados: EstadoDados;
  setDados: (e: EstadoDados) => void;
  banner: EstadoBanner;
  setBanner: (b: EstadoBanner) => void;
  densidade: Densidade;
  setDensidade: (d: Densidade) => void;
  fundoAnimado: boolean;
  setFundoAnimado: (v: boolean) => void;
  estiloPainel: EstiloPainel;
  setEstiloPainel: (v: EstiloPainel) => void;
  isSuper: boolean;
  isTech: boolean;
  escopo: string;
};

const PreviewCtx = React.createContext<Ctx | null>(null);

export type EstadoInicial = Partial<{
  papel: Papel;
  dados: EstadoDados;
  banner: EstadoBanner;
  densidade: Densidade;
}>;

export function PreviewProvider({
  children,
  inicial,
}: {
  children: React.ReactNode;
  /** Só usado pelo smoke test, para renderizar combinações de papel/estado. */
  inicial?: EstadoInicial;
}) {
  const [papel, setPapel] = React.useState<Papel>(inicial?.papel ?? "admin");
  const [dados, setDados] = React.useState<EstadoDados>(inicial?.dados ?? "normal");
  const [banner, setBanner] = React.useState<EstadoBanner>(inicial?.banner ?? "nenhum");
  const [densidade, setDensidade] = React.useState<Densidade>(inicial?.densidade ?? "confortavel");
  const [fundoAnimado, setFundoAnimado] = React.useState(true);
  const [estiloPainel, setEstiloPainel] = React.useState<EstiloPainel>("vidro");

  React.useEffect(() => {
    document.documentElement.dataset.density = densidade === "compact" ? "compact" : "";
  }, [densidade]);

  React.useEffect(() => {
    document.documentElement.dataset.painel = estiloPainel;
  }, [estiloPainel]);

  const isSuper = papel === "super_admin";
  const value: Ctx = {
    papel,
    setPapel,
    dados,
    setDados,
    banner,
    setBanner,
    densidade,
    setDensidade,
    fundoAnimado,
    setFundoAnimado,
    estiloPainel,
    setEstiloPainel,
    isSuper,
    isTech: papel === "tech",
    escopo: isSuper ? "Plataforma" : "NorteTI Suporte",
  };

  return <PreviewCtx.Provider value={value}>{children}</PreviewCtx.Provider>;
}

export function usePreview(): Ctx {
  const ctx = React.useContext(PreviewCtx);
  if (!ctx) throw new Error("usePreview precisa estar dentro de <PreviewProvider>");
  return ctx;
}
