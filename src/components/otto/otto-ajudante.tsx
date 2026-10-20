import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Download, Lightbulb, Mail, Monitor, Plus, Sparkles } from "lucide-react";
import { Otto } from "@/components/otto/otto";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { URL_DOWNLOAD_AGENTE } from "@/lib/download-agente";
import { pedirAoPainel } from "@/lib/otto-pedidos";

// O Otto da barra do topo: pequeno, no canto, e só fala quando a pessoa clica. No
// site ele puxa conversa sozinho; aqui não, porque quem abre o painel está
// trabalhando, no meio de um atendimento, e um balão aparecendo do nada atrapalha.
// O clique abre atalhos para o que mais se procura no painel.

const SUPORTE = "suporte@acessofast.com.br";

function Atalho({
  icone,
  children,
  onClick,
}: {
  icone: ReactNode;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-9 w-full justify-start gap-2.5 px-2.5 font-normal text-foreground [&_svg]:text-text-dim"
      onClick={onClick}
    >
      {icone}
      {children}
    </Button>
  );
}

export function OttoAjudante({ isSuper }: { isSuper: boolean }) {
  const [aberto, setAberto] = useState(false);
  const navigate = useNavigate();

  const fazer = (acao: () => void) => () => {
    setAberto(false);
    acao();
  };

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-9 w-9 p-0"
          title="Precisa de ajuda? Fale com o Otto"
        >
          <Otto estado={aberto ? "ola" : "parado"} className="w-7" />
          <span className="sr-only">Ajuda do Otto</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <div className="flex items-center gap-3 px-2 pb-2 pt-1">
          <Otto estado="ola" className="w-12" />
          <div className="leading-tight">
            <p className="text-sm font-medium text-foreground">Oi! Eu sou o Otto.</p>
            <p className="text-[13px] text-muted-foreground">Em que posso ajudar?</p>
          </div>
        </div>
        <div className="h-px bg-border-subtle" aria-hidden />
        <div className="pt-1.5">
          <Atalho
            icone={<Plus />}
            onClick={fazer(() => {
              pedirAoPainel("adicionar-dispositivo");
              void navigate({ to: "/dispositivos" });
            })}
          >
            Adicionar um computador
          </Atalho>
          <Atalho icone={<Monitor />} onClick={fazer(() => void navigate({ to: "/dispositivos" }))}>
            Conectar em um computador
          </Atalho>
          <Atalho
            icone={<Download />}
            onClick={fazer(() => window.open(URL_DOWNLOAD_AGENTE, "_blank", "noopener,noreferrer"))}
          >
            Baixar o AcessoFast
          </Atalho>
          <Atalho icone={<Sparkles />} onClick={fazer(() => pedirAoPainel("abrir-novidades"))}>
            Ver as novidades
          </Atalho>
          {/* A equipe não manda sugestão para si mesma (ver app-shell). */}
          {!isSuper && (
            <Atalho icone={<Lightbulb />} onClick={fazer(() => pedirAoPainel("abrir-sugestoes"))}>
              Mandar uma sugestão
            </Atalho>
          )}
          <Atalho
            icone={<Mail />}
            onClick={fazer(() => {
              window.location.href = `mailto:${SUPORTE}`;
            })}
          >
            Falar com o suporte
          </Atalho>
        </div>
      </PopoverContent>
    </Popover>
  );
}
