import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Store, Pencil, Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import { ImportarClientesDialog } from "@/components/importar-clientes-dialog";
import {
  formatarDocumento,
  formatarTelefone,
  normalizarDocumento,
  normalizarTelefone,
} from "@/lib/clientes";

export const Route = createFileRoute("/_authenticated/clientes")({
  head: () => ({
    meta: [{ title: "Clientes — Acessofast" }, { name: "robots", content: "noindex" }],
  }),
  component: ClientesPage,
});

type ClientRow = {
  id: string;
  name: string;
  document: string | null;
  document_type: string | null;
  phone: string | null;
  is_active: boolean;
};

function ClientesPage() {
  const queryClient = useQueryClient();

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      const uid = userData.user?.id;
      if (!uid) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("id, role, tenant_id")
        .eq("id", uid)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const isSuper = me?.role === "super_admin";
  const [tenantSelecionado, setTenantSelecionado] = useState<string>("");
  const effectiveTenant = isSuper ? tenantSelecionado : (me?.tenant_id ?? "");

  const { data: tenants } = useQuery({
    queryKey: ["tenants-clientes-select"],
    enabled: !!isSuper,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: consulta, isLoading } = useQuery({
    queryKey: ["clientes-lista", effectiveTenant],
    enabled: !!effectiveTenant,
    queryFn: async () => {
      const colunas = "id, name, document, document_type, is_active";
      const comTelefone = await supabase
        .from("clients")
        .select(`${colunas}, phone`)
        .eq("tenant_id", effectiveTenant)
        .order("name");
      if (!comTelefone.error) {
        return { rows: (comTelefone.data ?? []) as ClientRow[], temTelefone: true };
      }
      // 42703 = coluna inexistente. A migração 20260729120000 (clients.phone)
      // ainda não foi aplicada neste banco: a tela segue listando os clientes
      // normalmente, só sem o campo telefone, em vez de ficar vazia.
      if (comTelefone.error.code !== "42703") throw comTelefone.error;
      const { data, error } = await supabase
        .from("clients")
        .select(colunas)
        .eq("tenant_id", effectiveTenant)
        .order("name");
      if (error) throw error;
      return {
        rows: (data ?? []).map((c) => ({ ...c, phone: null })) as ClientRow[],
        temTelefone: false,
      };
    },
  });

  const clientes = consulta?.rows;
  const temTelefone = consulta?.temTelefone ?? true;
  const totalColunas = temTelefone ? 5 : 4;

  const { data: deviceCounts } = useQuery({
    queryKey: ["clientes-device-counts", effectiveTenant],
    enabled: !!effectiveTenant,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("address_book")
        .select("client_id")
        .eq("tenant_id", effectiveTenant);
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const row of data ?? []) {
        const cid = (row as { client_id: string | null }).client_id;
        if (!cid) continue;
        map[cid] = (map[cid] ?? 0) + 1;
      }
      return map;
    },
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRow | null>(null);

  const invalidarListas = () => {
    queryClient.invalidateQueries({ queryKey: ["clientes-lista", effectiveTenant] });
    queryClient.invalidateQueries({ queryKey: ["clientes-device-counts", effectiveTenant] });
    queryClient.invalidateQueries({ queryKey: ["clients_lista"] });
    queryClient.invalidateQueries({ queryKey: ["address_book"] });
  };

  const abrirCriar = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const abrirEditar = (c: ClientRow) => {
    setEditing(c);
    setDialogOpen(true);
  };

  if (me && !isSuper && !me.tenant_id) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Clientes</CardTitle>
            <CardDescription>Nenhuma empresa vinculada ao seu perfil.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
          <p className="text-sm text-muted-foreground">
            Clientes cadastrados na empresa e vínculo com dispositivos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isSuper && (
            <Select value={tenantSelecionado} onValueChange={setTenantSelecionado}>
              <SelectTrigger className="w-[260px]">
                <SelectValue placeholder="Selecione uma empresa" />
              </SelectTrigger>
              <SelectContent>
                {tenants?.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setImportOpen(true)}
            disabled={!effectiveTenant}
          >
            <Upload className="h-4 w-4 mr-1" />
            Importar planilha
          </Button>
          <Button size="sm" onClick={abrirCriar} disabled={!effectiveTenant}>
            <Plus className="h-4 w-4 mr-1" />
            Novo cliente
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Store className="h-4 w-4 text-primary" />
            Clientes cadastrados
          </CardTitle>
          <CardDescription>
            {!effectiveTenant
              ? "Selecione uma empresa"
              : clientes
              ? `${clientes.length} cliente(s)`
              : "Carregando…"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border/60 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>CNPJ / CPF</TableHead>
                  {temTelefone && <TableHead>Telefone</TableHead>}
                  <TableHead>Dispositivos</TableHead>
                  <TableHead className="w-24">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!effectiveTenant && (
                  <TableRow>
                    <TableCell
                      colSpan={totalColunas}
                      className="text-center text-muted-foreground py-10"
                    >
                      Selecione uma empresa para listar os clientes.
                    </TableCell>
                  </TableRow>
                )}
                {effectiveTenant && isLoading &&
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: totalColunas }).map((_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                {effectiveTenant && !isLoading && (clientes?.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={totalColunas}
                      className="text-center text-muted-foreground py-10"
                    >
                      Nenhum cliente cadastrado ainda.
                    </TableCell>
                  </TableRow>
                )}
                {effectiveTenant &&
                  !isLoading &&
                  clientes?.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatarDocumento(c.document, c.document_type) ?? "—"}
                      </TableCell>
                      {temTelefone && (
                        <TableCell className="text-sm text-muted-foreground">
                          {formatarTelefone(c.phone) ?? "—"}
                        </TableCell>
                      )}
                      <TableCell>{deviceCounts?.[c.id] ?? 0}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => abrirEditar(c)}
                        >
                          <Pencil className="h-3.5 w-3.5 mr-1" />
                          Editar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <ClienteDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        tenantId={effectiveTenant}
        editing={editing}
        temTelefone={temTelefone}
        onSaved={invalidarListas}
      />

      <ImportarClientesDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        tenantId={effectiveTenant}
        existentes={clientes ?? []}
        temTelefone={temTelefone}
        onImportado={invalidarListas}
      />
    </div>
  );
}

function ClienteDialog({
  open,
  onOpenChange,
  tenantId,
  editing,
  temTelefone,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string;
  editing: ClientRow | null;
  temTelefone: boolean;
  onSaved: () => void;
}) {
  const [nome, setNome] = useState("");
  const [documento, setDocumento] = useState("");
  const [telefone, setTelefone] = useState("");

  useMemo(() => {
    if (open) {
      setNome(editing?.name ?? "");
      setDocumento(editing?.document?.replace(/\D/g, "") ?? "");
      setTelefone(formatarTelefone(editing?.phone ?? null) ?? "");
    }
  }, [open, editing]);

  const mutation = useMutation({
    mutationFn: async () => {
      const nomeTrim = nome.trim();
      if (!nomeTrim) throw new Error("Informe o nome do cliente");
      const doc = normalizarDocumento(documento);
      if (doc.erro) throw new Error(doc.erro);
      const tel = normalizarTelefone(telefone);
      if (tel.erro) throw new Error(tel.erro);
      // Sem a coluna phone no banco, mandar o campo derrubaria o salvamento
      // inteiro; o resto do cadastro continua funcionando.
      const campos = {
        name: nomeTrim,
        document: doc.document,
        document_type: doc.document_type,
        ...(temTelefone ? { phone: tel.phone } : {}),
      };

      if (editing) {
        const { error } = await supabase.from("clients").update(campos).eq("id", editing.id);
        if (error) throw error;
      } else {
        if (!tenantId) throw new Error("Empresa não selecionada");
        const { error } = await supabase
          .from("clients")
          .insert({ tenant_id: tenantId, ...campos });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Cliente atualizado" : "Cliente criado");
      onOpenChange(false);
      onSaved();
    },
    onError: (err: { code?: string; message?: string }) => {
      if (err?.code === "23505") {
        toast.error("Já existe um cliente com esse nome ou documento nesta empresa");
        return;
      }
      toast.error(err?.message ?? "Erro ao salvar cliente");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar cliente" : "Novo cliente"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Atualize os dados do cliente."
              : "Cadastre um novo cliente na empresa selecionada."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="cliente-nome">Nome *</Label>
            <Input
              id="cliente-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cliente-doc">CNPJ ou CPF</Label>
            <Input
              id="cliente-doc"
              value={documento}
              onChange={(e) => setDocumento(e.target.value)}
              placeholder="Somente dígitos (14 = CNPJ, 11 = CPF)"
            />
          </div>
          {temTelefone && (
            <div className="space-y-2">
              <Label htmlFor="cliente-tel">Telefone</Label>
              <Input
                id="cliente-tel"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                placeholder="(47) 99999-9999"
              />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}