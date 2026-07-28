import * as React from "react";
import { AlertCircle, Check, Eye, EyeOff, Search, X } from "lucide-react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as RadioPrimitive from "@radix-ui/react-radio-group";
import { cx } from "@preview/lib/cx";

/* -------------------------------------------------------------------------- */
/* Base compartilhada por input / select / textarea                            */
/* -------------------------------------------------------------------------- */

const control =
  "w-full rounded-md border bg-surface-2 text-ink placeholder:text-muted " +
  "border-line transition-[border-color,box-shadow,background-color] " +
  "duration-[var(--af-dur-hover)] ease-[var(--af-ease)] " +
  "hover:border-line-strong " +
  "focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-[var(--af-primary-ring)]/35 " +
  "disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-line " +
  "read-only:text-ink-2 read-only:hover:border-line";

const heights = { sm: "h-8 px-2.5 text-[13px]", md: "h-9 px-3 text-[13.5px]" } as const;

function stateRing(invalid?: boolean, valid?: boolean) {
  if (invalid)
    return "border-danger focus:border-danger focus:ring-[color-mix(in_oklab,var(--af-danger)_35%,transparent)]";
  if (valid)
    return "border-success focus:border-success focus:ring-[color-mix(in_oklab,var(--af-success)_35%,transparent)]";
  return "";
}

/* -------------------------------------------------------------------------- */
/* Field: label + hint + mensagem de erro, tudo amarrado por id                 */
/* -------------------------------------------------------------------------- */

export function Field({
  label,
  htmlFor,
  hint,
  error,
  success,
  required,
  className,
  children,
}: {
  label?: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  success?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cx("space-y-1.5", className)}>
      {label ? (
        <label
          htmlFor={htmlFor}
          className="flex items-center gap-1 text-[12px] font-medium text-ink-2"
        >
          {label}
          {required ? (
            <span className="text-danger" aria-hidden>
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p
          id={htmlFor ? `${htmlFor}-error` : undefined}
          role="alert"
          className="flex items-start gap-1.5 text-[12px] text-danger"
        >
          <AlertCircle className="mt-[1px] size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : success ? (
        <p className="flex items-start gap-1.5 text-[12px] text-success">
          <Check className="mt-[1px] size-3.5 shrink-0" aria-hidden />
          {success}
        </p>
      ) : hint ? (
        <p
          id={htmlFor ? `${htmlFor}-hint` : undefined}
          className="text-[12px] leading-relaxed text-muted"
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  inputSize?: keyof typeof heights;
  invalid?: boolean;
  valid?: boolean;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  mono?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, inputSize = "md", invalid, valid, leading, trailing, mono, ...props },
  ref,
) {
  const field = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cx(
        control,
        heights[inputSize],
        stateRing(invalid, valid),
        mono && "font-mono text-[12.5px]",
        leading && "pl-9",
        trailing && "pr-9",
        className,
      )}
      {...props}
    />
  );
  if (!leading && !trailing) return field;
  return (
    <div className="relative">
      {leading ? (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted [&_svg]:size-4">
          {leading}
        </span>
      ) : null}
      {field}
      {trailing ? (
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted [&_svg]:size-4">
          {trailing}
        </span>
      ) : null}
    </div>
  );
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, rows = 3, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cx(
        control,
        "px-3 py-2 text-[13.5px] leading-relaxed",
        stateRing(invalid),
        className,
      )}
      {...props}
    />
  );
});

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & {
    invalid?: boolean;
    selectSize?: keyof typeof heights;
  }
>(function Select({ className, invalid, selectSize = "md", children, ...props }, ref) {
  return (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cx(
          control,
          heights[selectSize],
          stateRing(invalid),
          "cursor-pointer appearance-none pr-8",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 12 12"
        className="pointer-events-none absolute right-3 top-1/2 size-3 -translate-y-1/2 text-muted"
      >
        <path
          d="M2 4.5 6 8.5 10 4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
});

/* -------------------------------------------------------------------------- */

export function SearchField({
  value,
  onValueChange,
  placeholder = "Buscar…",
  className,
  id,
  "aria-label": ariaLabel,
}: {
  value: string;
  onValueChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  "aria-label"?: string;
}) {
  return (
    <div className={cx("relative", className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
      />
      <input
        id={id}
        type="search"
        role="searchbox"
        aria-label={ariaLabel ?? placeholder}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onValueChange(e.target.value)}
        className={cx(
          control,
          "h-9 pl-9 pr-8 text-[13.5px] [&::-webkit-search-cancel-button]:hidden",
        )}
      />
      {value ? (
        <button
          type="button"
          aria-label="Limpar busca"
          onClick={() => onValueChange("")}
          className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-sm text-muted transition-colors duration-[var(--af-dur-hover)] hover:bg-surface-hover hover:text-ink"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

export function PasswordField({
  id,
  value,
  onValueChange,
  autoComplete = "current-password",
  placeholder,
  required,
}: {
  id: string;
  value: string;
  onValueChange: (v: string) => void;
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
}) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(e) => onValueChange(e.target.value)}
        className={cx(control, "h-11 pl-3 pr-11 text-[14px]")}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
        className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted transition-colors duration-[var(--af-dur-hover)] hover:bg-surface-hover hover:text-ink"
      >
        {visible ? (
          <EyeOff className="size-4" aria-hidden />
        ) : (
          <Eye className="size-4" aria-hidden />
        )}
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Switch / Checkbox / Radio                                                   */
/* -------------------------------------------------------------------------- */

export function Switch({
  id,
  checked,
  onCheckedChange,
  label,
  icon,
  disabled,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label?: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-2">
      <SwitchPrimitive.Root
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        className={cx(
          "peer relative inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full",
          "border border-line bg-surface-2 transition-colors duration-[var(--af-dur-hover)]",
          "data-[state=checked]:border-primary data-[state=checked]:bg-primary",
          "disabled:cursor-not-allowed disabled:opacity-45",
        )}
      >
        <SwitchPrimitive.Thumb
          className={cx(
            "block size-[12px] translate-x-[3px] rounded-full bg-muted transition-transform",
            "duration-[var(--af-dur-hover)] ease-[var(--af-ease)]",
            "data-[state=checked]:translate-x-[17px] data-[state=checked]:bg-white",
          )}
        />
      </SwitchPrimitive.Root>
      {label ? (
        <label
          htmlFor={id}
          className="inline-flex cursor-pointer select-none items-center gap-1.5 text-[12.5px] text-ink-2 peer-data-[state=checked]:text-ink"
        >
          {icon}
          {label}
        </label>
      ) : null}
    </div>
  );
}

export function Checkbox({
  id,
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-2">
      <CheckboxPrimitive.Root
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onCheckedChange(Boolean(v))}
        className={cx(
          "grid size-[16px] shrink-0 place-items-center rounded-[4px] border border-line bg-surface-2",
          "transition-colors duration-[var(--af-dur-hover)] hover:border-line-strong",
          "data-[state=checked]:border-primary data-[state=checked]:bg-primary",
          "disabled:cursor-not-allowed disabled:opacity-45",
        )}
      >
        <CheckboxPrimitive.Indicator>
          <Check className="size-3 text-white" strokeWidth={3} aria-hidden />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {label ? (
        <label htmlFor={id} className="cursor-pointer select-none text-[13px] text-ink-2">
          {label}
        </label>
      ) : null}
    </div>
  );
}

export function RadioGroup({
  value,
  onValueChange,
  options,
  name,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: Array<{ value: string; label: string; hint?: string }>;
  name: string;
}) {
  return (
    <RadioPrimitive.Root value={value} onValueChange={onValueChange} className="space-y-2">
      {options.map((o) => (
        <div key={o.value} className="flex items-start gap-2.5">
          <RadioPrimitive.Item
            id={`${name}-${o.value}`}
            value={o.value}
            className={cx(
              "mt-[2px] grid size-[16px] shrink-0 place-items-center rounded-full border border-line bg-surface-2",
              "transition-colors duration-[var(--af-dur-hover)] hover:border-line-strong",
              "data-[state=checked]:border-primary",
            )}
          >
            <RadioPrimitive.Indicator className="size-[7px] rounded-full bg-primary" />
          </RadioPrimitive.Item>
          <label htmlFor={`${name}-${o.value}`} className="cursor-pointer select-none">
            <span className="block text-[13px] text-ink">{o.label}</span>
            {o.hint ? <span className="block text-[12px] text-muted">{o.hint}</span> : null}
          </label>
        </div>
      ))}
    </RadioPrimitive.Root>
  );
}
