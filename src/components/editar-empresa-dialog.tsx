import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apenasDigitos, mascararDocumento, tipoDocumentoValido } from "@/lib/documento";
import { toast } from "sonner";

/**
 * Cadastro da empresa: nome, documento e e-mail de cobrança.
 *
 * O que fica de fora é de propósito. Plano e assentos já têm o diálogo de
 * plano; billing_status, plan_expires_at e os ids do Asaas são o que a cobrança
 * escreveu e ninguém deveria corrigir por um formulário — errar ali desfaz um
 * acordo comercial sem deixar rastro. Aqui só entra o que um humano digitou e
 * um humano pode ter digitado errado.
 */

export type EmpresaCadastro = {
  id: string;
  name: string;
  cnpj: string | null;
  billing_email: string | null;
};

export function EditarEmpresaDialog({
  empresa,
  onClose,
}: {
  empresa: EmpresaCadastro | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [nome, setNome] = useState("");
  const [documento, setDocumento] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (!empresa) return;
    setNome(empresa.name);
    setDocumento(mascararDocumento(empresa.cnpj ?? ""));
    setEmail(empresa.billing_email ?? "");
  }, [empresa]);

  const docDigitado = apenasDigitos(documento);
  const docOriginal = apenasDigitos(empresa?.cnpj ?? "");
  const docMudou = docDigitado !== docOriginal;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!empresa) throw new Error("Nenhuma empresa selecionada");
      const { error } = await supabase.rpc("update_tenant", {
        p_tenant: empresa.id,
        p_name: nome.trim(),
        p_cnpj: docDigitado,
        p_billing_email: email.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenants-empresas"] });
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      toast.success("Cadastro atualizado.");
      onClose();
    },
    onError: (err: Error) => {
      toast.error(traduzirErro(err.message));
    },
  });

  const submeter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) {
      toast.error("Informe o nome da empresa.");
      return;
    }
    // O dígito só é cobrado de quem mexeu no campo: há contas antigas que
    // entraram com documento inválido, antes da checagem existir, e travar o
    // salvamento delas impediria corrigir o nome ou o e-mail.
    if (docMudou && docDigitado !== "" && !tipoDocumentoValido(documento)) {
      toast.error(
        docDigitado.length === 11 || docDigitado.length === 14
          ? "Documento inválido: o dígito verificador não confere."
          : "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).",
      );
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={empresa !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cadastro — {empresa?.name}</DialogTitle>
          <DialogDescription>
            Dados cadastrais da conta. Plano e assentos ficam em “Alterar”, na coluna Plano.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submeter} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="empresa-nome">Nome da empresa *</Label>
            <Input
              id="empresa-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="empresa-documento">CNPJ ou CPF</Label>
            <Input
              id="empresa-documento"
              inputMode="numeric"
              value={documento}
              placeholder="00.000.000/0000-00"
              onChange={(e) => setDocumento(mascararDocumento(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Vazio deixa a conta sem documento. Trocar aqui corrige o cadastro — a reserva
              antifraude do documento antigo continua como está.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="empresa-email">E-mail de cobrança</Label>
            <Input
              id="empresa-email"
              type="email"
              value={email}
              placeholder="financeiro@empresa.com.br"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** As RPCs levantam código curto; a tela é quem sabe dizer isso em português. */
function traduzirErro(mensagem: string): string {
  if (mensagem.includes("documento_em_uso")) {
    return "Outra empresa já está cadastrada com este documento.";
  }
  if (mensagem.includes("documento_invalido")) {
    return "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).";
  }
  if (mensagem.includes("email_invalido")) return "E-mail de cobrança inválido.";
  if (mensagem.includes("nome_obrigatorio")) return "Informe o nome da empresa.";
  if (mensagem.includes("forbidden")) return "Só o super admin edita empresas.";
  return mensagem || "Não foi possível salvar o cadastro.";
}
