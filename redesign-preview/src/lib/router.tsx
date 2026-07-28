import * as React from "react";

/**
 * Router mínimo por hash — o preview não precisa de dependência de roteamento.
 * As rotas são exatamente as mesmas do painel real (mesmos caminhos, mesmos
 * nomes), então o mapa 1:1 continua válido na hora de aplicar o redesign.
 */

export const ROTAS = [
  "/dashboard",
  "/dispositivos",
  "/clientes",
  "/auditoria",
  "/usuarios",
  "/financeiro",
  "/monitoramento",
  "/configuracoes",
  "/empresas",
  "/planos",
  "/auth",
  "/definir-senha",
  "/404",
  "/erro",
  "/design-system",
] as const;

export type Rota = (typeof ROTAS)[number];

function ler(): Rota {
  const h = window.location.hash.replace(/^#/, "");
  return (ROTAS as readonly string[]).includes(h) ? (h as Rota) : "/dashboard";
}

export function useRota(): [Rota, (r: Rota) => void] {
  const [rota, setRota] = React.useState<Rota>(() =>
    typeof window === "undefined" ? "/dashboard" : ler(),
  );

  React.useEffect(() => {
    const onHash = () => setRota(ler());
    window.addEventListener("hashchange", onHash);
    if (!window.location.hash) window.location.hash = "/dashboard";
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navegar = React.useCallback((r: Rota) => {
    window.location.hash = r;
    window.scrollTo({ top: 0 });
  }, []);

  return [rota, navegar];
}

const NavCtx = React.createContext<(r: Rota) => void>(() => {});
export const NavProvider = NavCtx.Provider;
export const useNavegar = () => React.useContext(NavCtx);

/** Link interno que mantém semântica de âncora (Ctrl+clique, foco, leitor de tela). */
export function Link({
  to,
  children,
  className,
  ...rest
}: {
  to: Rota;
  children: React.ReactNode;
  className?: string;
} & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={`#${to}`} className={className} {...rest}>
      {children}
    </a>
  );
}
