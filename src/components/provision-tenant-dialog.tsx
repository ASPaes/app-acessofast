import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Building2, Copy, Check } from "lucide-react";
import { toast } from "sonner";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type InviteResult = {
  ok?: boolean;
  user_id?: string;
  tenant_id?: string;
  role?: string;
  invite_link?: string;
  error?: string;
  detail?: string;
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
        E-mail automático não está configurado. Compartilhe este link com o convidado para
        definir a senha:
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
  const [inviteLink, setInviteLink] = useState<string | null>(null);

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
      return data;
    },
    onSuccess: (data) => {
      toast.success("Tenant provisionado com sucesso");
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      queryClient.invalidateQueries({ queryKey: ["tenants-empresas"] });
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
    setInviteLink(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Informe o nome do tenant");
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
          Provisionar novo tenant
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Provisionar novo tenant</DialogTitle>
          <DialogDescription>
            Cria um novo tenant e convida o usuário informado como admin.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tenant-name">Nome do tenant *</Label>
            <Input
              id="tenant-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tenant-admin-email">E-mail do admin *</Label>
            <Input
              id="tenant-admin-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
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