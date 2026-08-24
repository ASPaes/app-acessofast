import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2, Copy, Check } from "lucide-react";
import { toast } from "sonner";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Valor do select para "ainda não vendi plano nenhum". */
const SEM_PLANO = "__sem_plano__";

type Plano = {
  code: string;
  name: string;
  max_users: number | null;
  max_concurrent_per_tech: number | null;
  is_custom: boolean;
};

type InviteResult = {
  ok?: boolean;
  user_id?: string;
  tenant_id?: string;
  role?: string;
  invite_link?: string;
  error?: string;
  detail?: string;
  /** Preenchido quando a empresa nasceu mas o plano não colou nela. */
  plan_error?: string;
};

async function invokeErrorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const b = await error.context.json();
      return b?.detail ?? b?.error ?? error.message;
    } catch {
      return error.message;
    }
  }
  return (error as { message?: string })?.message ?? "Erro ao chamar a função";
}

function InviteLinkBlock({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar o link");
    }
  };
  return (
    <div className="mt-3 rounded-md border border-border/60 bg-muted/40 p-3 space-y-2">
      <p className="text-xs text-muted-foreground">
        E-mail automático não está configurado. Compartilhe este link com o convidado para definir a
        senha:
      </p>
      <div className="flex items-center gap-2">
        <Input readOnly value={link} className="text-xs" />
        <Button type="button" size="sm" variant="outline" onClick={copy}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          <span className="ml-1">{copied ? "Copiado" : "Copiar"}</span>
        </Button>
      </div>
    </div>
  );
}

export function ProvisionTenantDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [seatLimit, setSeatLimit] = useState<number>(1);
  const [planCode, setPlanCode] = useState<string>(SEM_PLANO);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  // Só ativos: aqui se está vendendo uma conta nova, e plano desativado não é
  // algo que se venda hoje. Na tela de plano da empresa os inativos aparecem
  // porque lá existe a conta que já assina um deles.
  const { data: planos } = useQuery({
    queryKey: ["planos-catalogo-ativos"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plans")
        .select("code, name, max_users, max_concurrent_per_tech, is_custom, sort_order, is_active")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as Plano[];
    },
  });

  const planoEscolhido = (planos ?? []).find((p) => p.code === planCode);

  /** Escolher o plano preenche os assentos dele — mesma regra do diálogo de plano. */
  const escolherPlano = (code: string) => {
    setPlanCode(code);
    const p = (planos ?? []).find((x) => x.code === code);
    if (p?.max_users != null) setSeatLimit(p.max_users);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<InviteResult>("invite-user", {
        body: {
          mode: "bootstrap_msp",
          name: name.trim(),
          email: email.trim(),
          seat_limit: seatLimit,
          redirect_to: `${window.location.origin}/definir-senha`,
        },
      });
      if (error) throw new Error(await invokeErrorMessage(error));
      if (!data?.ok) throw new Error(data?.detail ?? data?.error ?? "Falha ao provisionar");

      // O plano entra num segundo passo, por assign_plan, em vez de virar mais
      // um parâmetro da invite-user: é a mesma RPC que a tela de plano usa, com
      // as mesmas travas, e ela também acerta o billing_mode da conta nova.
      //
      // Se este passo falhar, a empresa já existe e o convite já saiu — voltar
      // atrás apagaria uma conta com admin convidado por causa de um campo. A
      // empresa fica sem plano e a tela avisa em qual passo parou.
      if (planCode !== SEM_PLANO && data.tenant_id) {
        const { error: planErr } = await supabase.rpc("assign_plan", {
          p_tenant: data.tenant_id,
          p_code: planCode,
          p_seat_override: seatLimit,
        });
        if (planErr) return { ...data, plan_error: planErr.message };
      }
      return data;
    },
    onSuccess: (data) => {
      if (data.plan_error) {
        toast.warning(
          `Empresa criada e convite enviado, mas o plano não foi aplicado: ${data.plan_error}. Use "Alterar" na coluna Plano.`,
        );
      } else {
        toast.success("Empresa criada com sucesso");
      }
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      // A lista de Empresas lê desta chave. Sem invalidar, a empresa recém-criada
      // só aparecia depois de recarregar a página na mão.
      queryClient.invalidateQueries({ queryKey: ["tenants-empresas"] });
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      if (data.invite_link) {
        setInviteLink(data.invite_link);
      } else {
        setOpen(false);
        resetForm();
      }
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const resetForm = () => {
    setName("");
    setEmail("");
    setSeatLimit(1);
    setPlanCode(SEM_PLANO);
    setInviteLink(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Informe o nome da empresa");
      return;
    }
    if (!emailRegex.test(email.trim())) {
      toast.error("Informe um e-mail válido");
      return;
    }
    if (!Number.isInteger(seatLimit) || seatLimit < 1) {
      toast.error("Limite de assentos deve ser um inteiro >= 1");
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Building2 className="h-4 w-4 mr-1" />
          Nova empresa
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          {/* "Tenant" é vocabulário de arquitetura, não de quem usa o painel.
              Multi-tenant é como o sistema foi construído — não é assunto de
              quem cadastra um cliente novo. */}
          <DialogTitle>Nova empresa</DialogTitle>
          <DialogDescription>
            Cria a empresa, aplica o plano escolhido e convida o e-mail informado como administrador
            dela.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tenant-name">Nome da empresa *</Label>
            <Input
              id="tenant-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tenant-admin-email">E-mail do administrador *</Label>
            <Input
              id="tenant-admin-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tenant-plano">Plano</Label>
            <Select value={planCode} onValueChange={escolherPlano}>
              <SelectTrigger id="tenant-plano">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* Continua dando para criar a conta antes de fechar a venda —
                    é o que acontecia até aqui, e o plano entra depois pelo
                    "Alterar" da coluna Plano. */}
                <SelectItem value={SEM_PLANO}>Sem plano por enquanto</SelectItem>
                {(planos ?? []).map((p) => (
                  <SelectItem key={p.code} value={p.code}>
                    {p.name}
                    {p.is_custom ? " · sob medida" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tenant-seats">Limite de assentos</Label>
            <Input
              id="tenant-seats"
              type="number"
              min={1}
              step={1}
              value={seatLimit}
              onChange={(e) => setSeatLimit(parseInt(e.target.value, 10) || 1)}
            />
            <p className="text-xs text-muted-foreground">
              {planoEscolhido
                ? planoEscolhido.max_users === null
                  ? "Plano sob medida: informe quantos técnicos foram combinados."
                  : `Padrão do plano: ${planoEscolhido.max_users}`
                : "Sem plano, o limite é o que você digitar aqui."}
            </p>
          </div>
          {inviteLink && <InviteLinkBlock link={inviteLink} />}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                resetForm();
              }}
            >
              Fechar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Enviando..." : "Provisionar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
