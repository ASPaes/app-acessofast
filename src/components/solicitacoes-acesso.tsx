import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserRoundCheck, Check, X } from "lucide-react";
import { toast } from "sonner";
import {
  SOLICITACOES_QUERY_KEY,
  useSolicitacoesAcesso,
  type SolicitacaoAcesso,
} from "@/hooks/use-solicitacoes-acesso";

type Papel = "tech" | "admin";

async function mensagemDoErro(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const b = await error.context.json();
      return b?.detail ?? b?.error ?? error.message;
    } catch {
      return error.message;
    }
  }
  return (error as { message?: string })?.message ?? "Não foi possível concluir a operação.";
}

/**
 * Pedidos de acesso de quem se cadastrou pelo login com o CNPJ/CPF desta
 * empresa. Some da tela quando não há nenhum — não é uma seção permanente, é
 * um aviso.
 */
export function SolicitacoesAcesso({
  habilitado,
  mostrarEmpresa,
}: {
  habilitado: boolean;
  mostrarEmpresa: boolean;
}) {
  const { data, isLoading } = useSolicitacoesAcesso(habilitado);
  const [aprovando, setAprovando] = useState<SolicitacaoAcesso | null>(null);

  if (!habilitado || isLoading || !data || data.length === 0) return null;

  return (
    <>
      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <UserRoundCheck className="h-4 w-4 text-primary" />
            Solicitações de acesso
            <Badge variant="default">{data.length}</Badge>
          </CardTitle>
          <CardDescription>
            Essas pessoas se cadastraram informando o CNPJ ou CPF da empresa. Elas não têm nenhum
            acesso até você aprovar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border/60 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  {mostrarEmpresa && <TableHead>Empresa</TableHead>}
                  <TableHead>Solicitado em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.full_name ?? "—"}</TableCell>
                    <TableCell className="text-xs">{s.email}</TableCell>
                    {mostrarEmpresa && (
                      <TableCell className="text-xs">{s.tenant_name ?? "—"}</TableCell>
                    )}
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(s.created_at).toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button size="sm" onClick={() => setAprovando(s)}>
                          <Check className="h-3.5 w-3.5 mr-1" />
                          Aprovar
                        </Button>
                        <RecusarButton solicitacao={s} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <AprovarDialog
        solicitacao={aprovando}
        onOpenChange={(aberto) => {
          if (!aberto) setAprovando(null);
        }}
      />
    </>
  );
}

function AprovarDialog({
  solicitacao,
  onOpenChange,
}: {
  solicitacao: SolicitacaoAcesso | null;
  onOpenChange: (aberto: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [papel, setPapel] = useState<Papel>("tech");

  const aprovar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("join-request", {
        body: { mode: "approve", request_id: solicitacao!.id, role: papel },
      });
      if (error) throw new Error(await mensagemDoErro(error));
      return data;
    },
    onSuccess: () => {
      toast.success(`${solicitacao?.full_name ?? solicitacao?.email} agora tem acesso.`);
      queryClient.invalidateQueries({ queryKey: SOLICITACOES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      onOpenChange(false);
      setPapel("tech");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={!!solicitacao} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Aprovar acesso</DialogTitle>
          <DialogDescription>
            {solicitacao?.full_name ?? solicitacao?.email} passa a fazer parte de{" "}
            {solicitacao?.tenant_name ?? "sua empresa"} e entra no painel com a senha que já
            cadastrou.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="papel-solicitante">Papel</Label>
          <Select value={papel} onValueChange={(v) => setPapel(v as Papel)}>
            <SelectTrigger id="papel-solicitante">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tech">Técnico</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => aprovar.mutate()} disabled={aprovar.isPending}>
            {aprovar.isPending ? "Aprovando..." : "Aprovar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecusarButton({ solicitacao }: { solicitacao: SolicitacaoAcesso }) {
  const queryClient = useQueryClient();
  const recusar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("join-request", {
        body: { mode: "reject", request_id: solicitacao.id },
      });
      if (error) throw new Error(await mensagemDoErro(error));
      return data;
    },
    onSuccess: () => {
      toast.success("Solicitação recusada.");
      queryClient.invalidateQueries({ queryKey: SOLICITACOES_QUERY_KEY });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={recusar.isPending}>
          <X className="h-3.5 w-3.5 mr-1" />
          Recusar
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Recusar solicitação?</AlertDialogTitle>
          <AlertDialogDescription>
            {solicitacao.full_name ?? solicitacao.email} continua sem nenhum acesso à empresa. A
            conta dele não é apagada — ele pode enviar a solicitação de novo pela tela de espera.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => recusar.mutate()}>Recusar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
