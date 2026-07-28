import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { X } from "lucide-react";
import { cx } from "@preview/lib/cx";
import { Button } from "./button";

/* -------------------------------------------------------------------------- */
/* Modal                                                                       */
/* -------------------------------------------------------------------------- */

const overlayClass =
  "fixed inset-0 z-[var(--af-z-modal)] bg-[#04070d]/70 backdrop-blur-[2px] af-anim-fade";

export const ModalRoot = DialogPrimitive.Root;
export const ModalTrigger = DialogPrimitive.Trigger;

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  tone = "default",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  tone?: "default" | "danger";
}) {
  const widths = {
    sm: "max-w-[400px]",
    md: "max-w-[520px]",
    lg: "max-w-[660px]",
    xl: "max-w-[860px]",
  } as const;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlayClass} />
        <DialogPrimitive.Content
          className={cx(
            "fixed left-1/2 top-1/2 z-[var(--af-z-modal)] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2",
            widths[size],
            "af-anim-modal overflow-hidden rounded-2xl border border-line bg-surface-raised shadow-modal",
          )}
        >
          <div
            aria-hidden
            className={cx(
              "h-[2px] w-full",
              tone === "danger" ? "bg-gradient-to-r from-danger to-transparent" : "af-brand-line",
            )}
          />
          <header className="flex items-start justify-between gap-4 px-6 pb-4 pt-5">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close
              aria-label="Fechar"
              className="-mr-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-md text-muted transition-colors duration-[var(--af-dur-hover)] hover:bg-surface-hover hover:text-ink"
            >
              <X className="size-4" aria-hidden />
            </DialogPrimitive.Close>
          </header>
          {children ? <div className="px-6 pb-5">{children}</div> : null}
          {footer ? (
            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line-subtle bg-surface/60 px-6 py-4">
              {footer}
            </footer>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Confirmação destrutiva: ação principal em vermelho, cancelar sempre visível. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      tone={destructive ? "danger" : "default"}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Dropdown                                                                    */
/* -------------------------------------------------------------------------- */

export const Dropdown = DropdownPrimitive.Root;
export const DropdownTrigger = DropdownPrimitive.Trigger;

export function DropdownContent({
  children,
  align = "end",
  className,
}: {
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        align={align}
        sideOffset={6}
        collisionPadding={12}
        className={cx(
          "af-anim-pop z-[var(--af-z-popover)] min-w-[204px] overflow-hidden rounded-lg",
          "border border-line bg-surface-raised p-1 shadow-pop",
          className,
        )}
      >
        {children}
      </DropdownPrimitive.Content>
    </DropdownPrimitive.Portal>
  );
}

export function DropdownItem({
  children,
  onSelect,
  icon,
  destructive = false,
  disabled = false,
  shortcut,
}: {
  children: React.ReactNode;
  onSelect?: () => void;
  icon?: React.ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  shortcut?: string;
}) {
  return (
    <DropdownPrimitive.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cx(
        "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] outline-none",
        "transition-colors duration-[var(--af-dur-hover)] [&_svg]:size-4 [&_svg]:shrink-0",
        destructive
          ? "text-danger data-[highlighted]:bg-danger-soft"
          : "text-ink-2 data-[highlighted]:bg-surface-hover data-[highlighted]:text-ink",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-45",
      )}
    >
      {icon ? <span className={destructive ? "text-danger" : "text-muted"}>{icon}</span> : null}
      <span className="flex-1 truncate">{children}</span>
      {shortcut ? <span className="text-[11px] text-muted">{shortcut}</span> : null}
    </DropdownPrimitive.Item>
  );
}

export function DropdownLabel({ children }: { children: React.ReactNode }) {
  return (
    <DropdownPrimitive.Label className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
      {children}
    </DropdownPrimitive.Label>
  );
}

export function DropdownSeparator() {
  return <DropdownPrimitive.Separator className="my-1 h-px bg-line-subtle" />;
}

/* -------------------------------------------------------------------------- */
/* Tooltip                                                                     */
/* -------------------------------------------------------------------------- */

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={220} skipDelayDuration={300}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={8}
          collisionPadding={10}
          className="af-anim-pop z-[var(--af-z-popover)] max-w-[260px] rounded-md border border-line bg-surface-raised px-2.5 py-1.5 text-[12px] text-ink shadow-pop"
        >
          {content}
          <TooltipPrimitive.Arrow
            className="fill-[var(--af-surface-raised)]"
            width={10}
            height={5}
          />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* -------------------------------------------------------------------------- */
/* Popover                                                                     */
/* -------------------------------------------------------------------------- */

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({
  children,
  align = "end",
  className,
}: {
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={6}
        collisionPadding={12}
        className={cx(
          "af-anim-pop z-[var(--af-z-popover)] w-[264px] overflow-hidden rounded-lg",
          "border border-line bg-surface-raised shadow-pop",
          className,
        )}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
