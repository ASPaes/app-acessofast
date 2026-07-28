import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { Loader2 } from "lucide-react";
import { cx } from "@preview/lib/cx";

/**
 * Hierarquia de ação:
 *  primary   -> a ação principal do contexto — inclusive quando ela se repete
 *               linha a linha, como o "Conectar" do address book. Azul sólido,
 *               igual ao painel atual: é o botão que o técnico procura sem ler.
 *  secondary -> ação de apoio recorrente (superfície + borda sutil).
 *  ghost     -> ação terciária/repetida em linha de tabela.
 *  danger    -> destrutiva. Nunca é a ação padrão de um formulário.
 *  link      -> navegação inline dentro de texto.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium " +
  "transition-[background-color,border-color,color,box-shadow] duration-[var(--af-dur-hover)] " +
  "ease-[var(--af-ease)] select-none " +
  "disabled:pointer-events-none disabled:opacity-45 " +
  "[&_svg]:shrink-0 [&_svg]:size-4";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-on-primary shadow-sm hover:bg-primary-hover active:bg-primary " +
    "border border-transparent",
  secondary:
    "bg-surface-2 text-ink border border-line hover:bg-surface-hover hover:border-line-strong",
  ghost:
    "bg-transparent text-ink-2 border border-transparent hover:bg-surface-hover hover:text-ink",
  danger:
    "bg-danger-soft text-danger border border-[color-mix(in_oklab,var(--af-danger)_35%,transparent)] " +
    "hover:bg-[color-mix(in_oklab,var(--af-danger)_20%,transparent)] hover:text-ink",
  // O link mantém a cor no hover e sublinha. Não usa --af-primary-hover porque
  // esse token escurece (ver tokens.css), o que sobre fundo escuro pioraria.
  link: "bg-transparent text-primary-light underline-offset-4 hover:underline px-0",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-9 px-3.5 text-[13.5px]",
  lg: "h-11 px-5 text-[15px]",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  asChild?: boolean;
  block?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = "primary",
    size = "md",
    loading = false,
    asChild = false,
    block = false,
    disabled,
    children,
    ...props
  },
  ref,
) {
  const classes = cx(
    base,
    variants[variant],
    variant === "link" ? "h-auto" : sizes[size],
    block && "w-full",
    className,
  );

  // Com asChild o Radix Slot exige exatamente um filho: repassamos `children`
  // direto (sem o wrapper do spinner). `loading` fica reservado ao <button>.
  if (asChild) {
    return (
      <Slot ref={ref} className={classes} {...props}>
        {children}
      </Slot>
    );
  }

  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classes}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
});

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Obrigatório: botão só com ícone precisa de nome acessível. */
  label: string;
  variant?: Exclude<ButtonVariant, "link">;
  size?: "sm" | "md";
  active?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, label, variant = "ghost", size = "md", active, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cx(
        base,
        variants[variant],
        size === "sm" ? "h-7 w-7" : "h-9 w-9",
        "p-0",
        active && "bg-primary-soft text-primary-light border-transparent",
        className,
      )}
      {...props}
    />
  );
});
