import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Acabamento de vidro fosco.
 *
 * A referência é vidro FOSCO, não transparente: a superfície pega luz na aresta
 * de cima, tem canto arredondado e sombra macia, mas o que está atrás vira um
 * borrão sem detalhe. É essa a parte que importa num painel de trabalho — atrás
 * do vidro não pode passar nada que compita com o dado.
 *
 * Por isso a base é OPACA (`bg-card` = --af-glass) e não translúcida. Medindo a
 * composição do fundo: uma bolinha da constelação atravessa com amplitude RGB
 * (56, 74, 92); a mancha azul, com (6, 11, 23). A bolinha é ~4x mais forte que
 * o degradê que ela acompanha, então não existe nível de transparência que
 * deixe passar a mancha e barre a constelação. O valor de --af-glass é a média
 * medida do que o painel mostrava translúcido: a cor é a mesma, sem a
 * constelação por dentro.
 *
 * Efeito colateral bem-vindo: nenhum `backdrop-filter` na área de conteúdo.
 * Cada um recalcularia a cada repintura do fundo.
 */
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-xl border border-white/[0.09] bg-card text-card-foreground",
        // brilho de topo: é o que sustenta a leitura de "vidro" numa base opaca
        "bg-[linear-gradient(180deg,rgba(255,255,255,0.075)_0%,rgba(255,255,255,0.018)_38%,rgba(255,255,255,0)_100%)]",
        // aresta de cima acesa + sombra macia
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_12px_32px_-12px_rgba(2,6,16,0.75)]",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  ),
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
