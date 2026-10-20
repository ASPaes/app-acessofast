import { Toaster as Sonner } from "sonner";
import { Otto } from "@/components/otto/otto";

type ToasterProps = React.ComponentProps<typeof Sonner> & {
  /** Sem a cara do Otto nos avisos (a tela de login fica como sempre foi). */
  semOtto?: boolean;
};

// Os avisos vêm com a cara do Otto: feliz quando deu certo, triste no erro,
// em dúvida no alerta, conectando enquanto espera. Parado (sem flutuar): é um
// ícone, e vários avisos juntos não podem virar uma dança no canto da tela.
const ICONES_DO_OTTO: ToasterProps["icons"] = {
  success: <Otto estado="concluido" animado={false} className="w-full" />,
  error: <Otto estado="erro" animado={false} className="w-full" />,
  warning: <Otto estado="aguardando" animado={false} className="w-full" />,
  info: <Otto estado="parado" animado={false} className="w-full" />,
  loading: <Otto estado="conectando" animado={false} className="w-full" />,
};

const Toaster = ({ semOtto = false, ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      icons={semOtto ? undefined : ICONES_DO_OTTO}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
