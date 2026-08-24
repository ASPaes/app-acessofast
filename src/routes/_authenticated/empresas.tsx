import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Building2,
  ChevronRight,
  Layers,
  MoreHorizontal,
  Pencil,
  Power,
  PowerOff,
  Trash2,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { ProvisionTenantDialog } from "@/components/provision-tenant-dialog";
import { PlanoEmpresaDialog, type EmpresaPlano } from "@/components/plano-empresa-dialog";
import { EditarEmpresaDialog, type EmpresaCadastro } from "@/components/editar-empresa-dialog";
import { mascararDocumento } from "@/lib/documento";

export const Route = createFileRoute("/_authenticated/empresas")({
  head: () => ({
    meta: [{ title: "Empresas — Acessofast" }, { name: "robots", content: "noindex" }],
  }),
  component: EmpresasPage,
});

const rotuloCobranca: Record<string, string> = {
  free: "grátis",
  credits: "créditos",
  plan: "plano",
};

const rotuloPapel: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  head: "Supervisor",
  tech: "Técnico",
};

function EmpresasPage() {
  const queryClient = useQueryClient();
  const [aberta, setAberta] = useState<string | null>(null);
  const [planoEmEdicao, setPlanoEmEdicao] = useState<EmpresaPlano | null>(null);
  const [cadastroEmEdicao, setCadastroEmEdicao] = useState<EmpresaCadastro | null>(null);
  const [inativando, setInativando] = useState<TenantLinha | null>(null);
  const [excluindo, setExcluindo] = useState<TenantLinha | null>(null);

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

  const { data, isLoading } = useQuery({
    queryKey: ["tenants-empresas"],
    enabled: !!isSuper,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select(
          "id, name, cnpj, billing_email, seat_limit, max_concurrent_per_tech, is_active, created_at, plan_code, billing_mode, billing_status, is_trial, profiles(count), address_book(count)",
        )
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const toggleAtivaMutation = useMutation({
    mutationFn: async (vars: { id: string; ativar: boolean }) => {
      const { error } = await supabase.rpc("set_tenant_active", {
        p_tenant: vars.id,
        p_active: vars.ativar,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["tenants-empresas"] });
      toast.success(vars.ativar ? "Empresa reativada." : "Empresa inativada.");
      setInativando(null);
    },
    onError: (err: Error) => toast.error(traduzirErro(err.message)),
  });

  const excluirMutation = useMutation({
    mutationFn: async (vars: { id: string; nome: string }) => {
      const { error } = await supabase.rpc("delete_tenant", {
        p_tenant: vars.id,
        p_confirm_name: vars.nome,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenants-empresas"] });
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      toast.success("Empresa excluída.");
      setExcluindo(null);
    },
    onError: (err: Error) => toast.error(traduzirErro(err.message)),
  });

  if (me && !isSuper) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Empresas</CardTitle>
            <CardDescription>Acesso restrito à equipe da plataforma.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Conta individual é a de um assento só. Não existe coluna "tipo" em tenants,
  // e seat_limit = 1 é o que a diferencia na prática: sem assentos para gerir e
  // sem equipe para listar. Se um dia houver um campo explícito, é aqui que
  // troca — a regra está num lugar só.
  const ehIndividual = (t: { seat_limit: number }) => t.seat_limit === 1;

  const empresas = (data ?? []).filter((t) => !ehIndividual(t)).length;
  const individuais = (data ?? []).filter(ehIndividual).length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Empresas</h1>
          <p className="text-sm text-muted-foreground">
            Contas que utilizam o sistema. Abra uma conta para ver os usuários dela.
          </p>
        </div>
        <div className="flex gap-2">{isSuper && <ProvisionTenantDialog />}</div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            Contas cadastradas
          </CardTitle>
          <CardDescription>
            {data ? `${empresas} empresa(s) · ${individuais} individual(is)` : "Carregando…"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border/60 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-9" />
                  <TableHead>Conta</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Cobrança</TableHead>
                  <TableHead>Dispositivos</TableHead>
                  <TableHead>Assentos</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Criada em</TableHead>
                  <TableHead className="w-12 text-right">
                    <span className="sr-only">Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading &&
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 9 }).map((_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                {!isLoading && (data?.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-10">
                      Nenhuma conta cadastrada ainda.
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  data?.map((t) => {
                    const membros = t.profiles?.[0]?.count ?? 0;
                    const dispositivos = t.address_book?.[0]?.count ?? 0;
                    const individual = ehIndividual(t);
                    const on = aberta === t.id;
                    return (
                      <LinhaConta
                        key={t.id}
                        tenant={t}
                        membros={membros}
                        dispositivos={dispositivos}
                        individual={individual}
                        aberta={on}
                        ehPropriaEmpresa={t.id === me?.tenant_id}
                        onToggle={() => setAberta(on ? null : t.id)}
                        onAlterarPlano={() =>
                          setPlanoEmEdicao({
                            id: t.id,
                            name: t.name,
                            plan_code: t.plan_code,
                            seat_limit: t.seat_limit,
                            max_concurrent_per_tech: t.max_concurrent_per_tech,
                            usuarios: membros,
                          })
                        }
                        onEditarCadastro={() =>
                          setCadastroEmEdicao({
                            id: t.id,
                            name: t.name,
                            cnpj: t.cnpj,
                            billing_email: t.billing_email,
                          })
                        }
                        onInativar={() => setInativando(t)}
                        onReativar={() => toggleAtivaMutation.mutate({ id: t.id, ativar: true })}
                        onExcluir={() => setExcluindo(t)}
                      />
                    );
                  })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <PlanoEmpresaDialog empresa={planoEmEdicao} onClose={() => setPlanoEmEdicao(null)} />
      <EditarEmpresaDialog empresa={cadastroEmEdicao} onClose={() => setCadastroEmEdicao(null)} />

      <AlertDialog open={inativando !== null} onOpenChange={(v) => !v && setInativando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Inativar «{inativando?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Os técnicos da empresa param de abrir atendimentos novos. Os dados, os dispositivos e
              o histórico continuam onde estão, e reativar devolve tudo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={toggleAtivaMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (inativando) toggleAtivaMutation.mutate({ id: inativando.id, ativar: false });
              }}
            >
              {toggleAtivaMutation.isPending ? "Inativando…" : "Inativar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ExcluirEmpresaDialog
        tenant={excluindo}
        pendente={excluirMutation.isPending}
        onClose={() => setExcluindo(null)}
        onConfirmar={(nome) => {
          if (excluindo) excluirMutation.mutate({ id: excluindo.id, nome });
        }}
      />
    </div>
  );
}

type TenantLinha = {
  id: string;
  name: string;
  cnpj: string | null;
  billing_email: string | null;
  seat_limit: number;
  max_concurrent_per_tech: number | null;
  is_active: boolean;
  created_at: string;
  plan_code: string | null;
  billing_mode: string;
  billing_status: string;
  is_trial: boolean;
};

/**
 * Linha de conta + detalhe com os usuários dela.
 *
 * Conta individual não expande: tem um usuário só, que é a própria conta, e um
 * painel repetindo o nome do titular seria ruído. O chevron some em vez de ficar
 * desabilitado — controle que nunca faz nada é pior que controle ausente.
 */
function LinhaConta({
  tenant,
  membros,
  dispositivos,
  individual,
  aberta,
  ehPropriaEmpresa,
  onToggle,
  onAlterarPlano,
  onEditarCadastro,
  onInativar,
  onReativar,
  onExcluir,
}: {
  tenant: TenantLinha;
  membros: number;
  dispositivos: number;
  individual: boolean;
  aberta: boolean;
  ehPropriaEmpresa: boolean;
  onToggle: () => void;
  onAlterarPlano: () => void;
  onEditarCadastro: () => void;
  onInativar: () => void;
  onReativar: () => void;
  onExcluir: () => void;
}) {
  // Só busca os usuários quando a linha abre: em uma plataforma com muitas
  // contas, trazer todos de antemão seria uma consulta por linha sem ninguém ter
  // pedido.
  const { data: usuarios, isLoading } = useQuery({
    queryKey: ["tenant-usuarios", tenant.id],
    enabled: aberta && !individual,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, role, is_active, created_at")
        .eq("tenant_id", tenant.id)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const documento = tenant.cnpj ? mascararDocumento(tenant.cnpj) : null;

  return (
    <>
      <TableRow className={aberta ? "bg-muted/40" : undefined}>
        <TableCell className="pr-0">
          {!individual && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={onToggle}
              aria-expanded={aberta}
              aria-label={aberta ? `Recolher ${tenant.name}` : `Ver usuários de ${tenant.name}`}
            >
              <ChevronRight
                className={`h-4 w-4 transition-transform ${aberta ? "rotate-90" : ""}`}
              />
            </Button>
          )}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${
                individual ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
              }`}
            >
              {individual ? (
                <User className="h-3.5 w-3.5" />
              ) : (
                <Building2 className="h-3.5 w-3.5" />
              )}
            </span>
            <div className="min-w-0">
              <span className="block font-medium">{tenant.name}</span>
              <span className="block text-xs text-muted-foreground">
                {individual ? "conta individual" : `${membros} usuário(s)`}
                {/* O documento fica aqui e não numa coluna própria: é o que
                    identifica a empresa quando dois nomes se parecem, e só
                    interessa junto do nome. */}
                {documento && ` · ${documento}`}
              </span>
            </div>
          </div>
        </TableCell>
        {/* Só o nome do plano. O "Alterar" que ficava aqui era um botão fantasma
            no meio de uma coluna de leitura, e agora mora no ⋯ junto com as
            outras ações da empresa — ação de linha tem um lugar só. */}
        <TableCell className="text-sm">
          {tenant.plan_code ?? <span className="text-muted-foreground">sem plano</span>}
        </TableCell>
        <TableCell>
          <Badge variant="outline">
            {rotuloCobranca[tenant.billing_mode] ?? tenant.billing_mode}
          </Badge>
          {tenant.is_trial && (
            <Badge variant="secondary" className="ml-1.5">
              teste
            </Badge>
          )}
        </TableCell>
        <TableCell>{dispositivos}</TableCell>
        <TableCell>
          {individual ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <>
              {membros}
              <span className="text-muted-foreground"> / {tenant.seat_limit}</span>
              {membros > tenant.seat_limit && (
                <Badge variant="destructive" className="ml-2">
                  acima
                </Badge>
              )}
            </>
          )}
        </TableCell>
        <TableCell>
          <Badge variant={tenant.is_active ? "default" : "secondary"}>
            {tenant.is_active ? "ativa" : "inativa"}
          </Badge>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {new Date(tenant.created_at).toLocaleDateString("pt-BR")}
        </TableCell>
        <TableCell className="text-right">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                aria-label={`Ações de ${tenant.name}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEditarCadastro}>
                <Pencil className="h-4 w-4 mr-2" />
                Editar cadastro
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onAlterarPlano}>
                <Layers className="h-4 w-4 mr-2" />
                Alterar plano
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {tenant.is_active ? (
                <DropdownMenuItem
                  onClick={onInativar}
                  // Quem está logado não desliga a própria casa: a RPC recusa, e
                  // deixar o item clicável só renderia um toast de erro.
                  disabled={ehPropriaEmpresa}
                  className="text-destructive focus:text-destructive"
                >
                  <PowerOff className="h-4 w-4 mr-2" />
                  Inativar
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={onReativar}>
                  <Power className="h-4 w-4 mr-2" />
                  Reativar
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={onExcluir}
                // Excluir só depois de inativar. Não é burocracia: é a chance de
                // olhar a conta desligada e perceber que era a errada, com tudo
                // ainda de pé para desfazer.
                disabled={tenant.is_active || ehPropriaEmpresa}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {tenant.is_active ? "Excluir (inative antes)" : "Excluir"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>

      {aberta && !individual && (
        <TableRow className="bg-muted/40 hover:bg-muted/40">
          <TableCell colSpan={9} className="p-0">
            <div className="px-4 py-3">
              {isLoading && <Skeleton className="h-16 w-full" />}
              {!isLoading && (usuarios?.length ?? 0) === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Nenhum usuário cadastrado em {tenant.name}.
                </p>
              )}
              {!isLoading && (usuarios?.length ?? 0) > 0 && (
                <div className="rounded-md border border-border/60 bg-background overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Usuário</TableHead>
                        <TableHead>Papel</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Desde</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {usuarios?.map((u) => (
                        <TableRow key={u.id}>
                          <TableCell>
                            <span className="block text-sm">
                              {u.full_name?.trim() || (
                                <span className="text-muted-foreground">sem nome</span>
                              )}
                            </span>
                            <span className="block text-xs text-muted-foreground">{u.email}</span>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{rotuloPapel[u.role] ?? u.role}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={u.is_active ? "default" : "secondary"}>
                              {u.is_active ? "ativo" : "inativo"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(u.created_at).toLocaleDateString("pt-BR")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/**
 * Confirmação de exclusão.
 *
 * Digitar o nome não é teatro: é o único jeito de a pessoa reler qual conta
 * está prestes a sumir. O texto lista o que vai junto porque essa é a pergunta
 * que aparece depois, quando já não dá para responder.
 */
function ExcluirEmpresaDialog({
  tenant,
  pendente,
  onClose,
  onConfirmar,
}: {
  tenant: TenantLinha | null;
  pendente: boolean;
  onClose: () => void;
  onConfirmar: (nome: string) => void;
}) {
  const [digitado, setDigitado] = useState("");
  const confere = tenant !== null && digitado.trim() === tenant.name.trim();

  return (
    <AlertDialog
      open={tenant !== null}
      onOpenChange={(v) => {
        if (!v) {
          setDigitado("");
          onClose();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir «{tenant?.name}»?</AlertDialogTitle>
          <AlertDialogDescription>
            Some para sempre: os logins da empresa, os dispositivos, o histórico de atendimentos, os
            clientes, os créditos e as integrações. Não há como desfazer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="confirmar-nome-empresa">
            Digite <span className="font-medium text-foreground">{tenant?.name}</span> para
            confirmar
          </Label>
          <Input
            id="confirmar-nome-empresa"
            autoComplete="off"
            value={digitado}
            onChange={(e) => setDigitado(e.target.value)}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={() => {
              setDigitado("");
            }}
          >
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={!confere || pendente}
            onClick={(e) => {
              e.preventDefault();
              if (tenant && confere) onConfirmar(tenant.name);
            }}
          >
            {pendente ? "Excluindo…" : "Excluir empresa"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** As RPCs levantam código curto; a tela é quem sabe dizer isso em português. */
function traduzirErro(mensagem: string): string {
  if (mensagem.includes("nao_pode_inativar_a_propria_empresa")) {
    return "Você não pode inativar a empresa em que está logado.";
  }
  if (mensagem.includes("nao_pode_excluir_a_propria_empresa")) {
    return "Você não pode excluir a empresa em que está logado.";
  }
  if (mensagem.includes("empresa_ativa")) return "Inative a empresa antes de excluir.";
  if (mensagem.includes("empresa_com_super_admin")) {
    return "Esta empresa abriga um super admin. Mova-o para outra conta antes de excluir.";
  }
  if (mensagem.includes("usuario_com_historico")) {
    return "Um dos logins tem registro em histórico compartilhado (cupom, crédito). Nada foi excluído.";
  }
  if (mensagem.includes("confirmacao_nao_confere")) return "O nome digitado não confere.";
  if (mensagem.includes("empresa_nao_encontrada")) return "Empresa não encontrada.";
  if (mensagem.includes("forbidden")) return "Só o super admin faz isso.";
  return mensagem || "Não foi possível concluir a ação.";
}
