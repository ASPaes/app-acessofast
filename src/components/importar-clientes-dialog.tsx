import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  RefreshCw,
  SkipForward,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { formatarDocumento, formatarTelefone } from "@/lib/clientes";
import {
  analisar,
  lerMatriz,
  type ClienteExistente,
  type LinhaPlanilha,
} from "@/lib/importar-clientes";

type Resultado = {
  criados: number;
  atualizados: number;
  ignorados: number;
  falhas: Array<{ nome: string; msg: string }>;
};

const LOTE = 200;

function mensagemErro(err: unknown): string {
  const e = err as { code?: string; message?: string };
  if (e?.code === "23505") return "Já existe um cliente com esse nome ou documento";
  return e?.message ?? "Erro desconhecido";
}

export function ImportarClientesDialog({
  open,
  onOpenChange,
  tenantId,
  existentes,
  onImportado,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string;
  existentes: ClienteExistente[];
  onImportado: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [etapa, setEtapa] = useState<"upload" | "revisao" | "resultado">("upload");
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [linhas, setLinhas] = useState<LinhaPlanilha[]>([]);
  const [modoDuplicados, setModoDuplicados] = useState<"ignorar" | "atualizar">("ignorar");
  const [lendo, setLendo] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const novos = linhas.filter((l) => l.status === "novo");
  const duplicados = linhas.filter((l) => l.status === "duplicado");
  const repetidos = linhas.filter((l) => l.status === "repetido");
  const comErro = linhas.filter((l) => l.status === "erro");
  const totalAImportar = novos.length + (modoDuplicados === "atualizar" ? duplicados.length : 0);

  const reset = () => {
    setEtapa("upload");
    setNomeArquivo("");
    setLinhas([]);
    setModoDuplicados("ignorar");
    setProgresso(0);
    setResultado(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const fechar = (v: boolean) => {
    onOpenChange(v);
    if (!v) reset();
  };

  const receberArquivo = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    setLendo(true);
    try {
      const matriz = await lerMatriz(arquivo);
      const analisadas = analisar(matriz, existentes);
      setNomeArquivo(arquivo.name);
      setLinhas(analisadas);
      setEtapa("revisao");
    } catch (err) {
      toast.error((err as Error)?.message ?? "Não foi possível ler a planilha");
    } finally {
      setLendo(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const baixarModelo = async () => {
    try {
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.aoa_to_sheet([
        ["Nome", "CNPJ", "Telefone"],
        ["Mercado Exemplo Ltda", "12.345.678/0001-90", "(47) 99999-9999"],
        ["Maria de Souza", "123.456.789-09", "(47) 3333-4444"],
      ]);
      ws["!cols"] = [{ wch: 34 }, { wch: 22 }, { wch: 18 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Clientes");
      XLSX.writeFile(wb, "modelo-clientes.xlsx");
    } catch {
      toast.error("Não foi possível gerar o modelo");
    }
  };

  const importacao = useMutation({
    mutationFn: async (): Promise<Resultado> => {
      if (!tenantId) throw new Error("Empresa não selecionada");

      const paraCriar = novos;
      const paraAtualizar = modoDuplicados === "atualizar" ? duplicados : [];
      const total = paraCriar.length + paraAtualizar.length;
      let processados = 0;
      const falhas: Resultado["falhas"] = [];
      let criados = 0;
      let atualizados = 0;

      setProgresso(0);

      for (let i = 0; i < paraCriar.length; i += LOTE) {
        const fatia = paraCriar.slice(i, i + LOTE);
        const payload = fatia.map((l) => ({
          tenant_id: tenantId,
          name: l.nome,
          document: l.document,
          document_type: l.document_type,
          phone: l.phone,
        }));
        const { error } = await supabase.from("clients").insert(payload);
        if (error) {
          // Um único conflito derruba o lote inteiro. Reinsere linha a linha
          // para isolar quem falhou sem perder as outras do lote.
          for (const [idx, linha] of payload.entries()) {
            const { error: e } = await supabase.from("clients").insert(linha);
            if (e) falhas.push({ nome: fatia[idx]!.nome, msg: mensagemErro(e) });
            else criados++;
          }
        } else {
          criados += fatia.length;
        }
        processados += fatia.length;
        setProgresso(Math.round((processados / total) * 100));
      }

      for (const l of paraAtualizar) {
        const { error } = await supabase
          .from("clients")
          .update({
            name: l.nome,
            document: l.document,
            document_type: l.document_type,
            phone: l.phone,
          })
          .eq("id", l.existenteId!);
        if (error) falhas.push({ nome: l.nome, msg: mensagemErro(error) });
        else atualizados++;
        processados++;
        setProgresso(Math.round((processados / total) * 100));
      }

      return {
        criados,
        atualizados,
        ignorados:
          repetidos.length + (modoDuplicados === "ignorar" ? duplicados.length : 0) + comErro.length,
        falhas,
      };
    },
    onSuccess: (r) => {
      setResultado(r);
      setEtapa("resultado");
      if (r.criados || r.atualizados) {
        toast.success(
          `${r.criados} cliente(s) criado(s)` +
            (r.atualizados ? ` e ${r.atualizados} atualizado(s)` : ""),
        );
      }
      onImportado();
    },
    onError: (err) => toast.error(mensagemErro(err)),
  });

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importar clientes de planilha</DialogTitle>
          <DialogDescription>
            {etapa === "upload"
              ? "Aceita .xlsx, .xls e .csv. São lidas apenas as colunas Nome, CNPJ/CPF e Telefone."
              : etapa === "revisao"
                ? `${nomeArquivo} — ${linhas.length} linha(s) lida(s). Confira antes de importar.`
                : "Importação concluída."}
          </DialogDescription>
        </DialogHeader>

        {etapa === "upload" && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setArrastando(true);
              }}
              onDragLeave={() => setArrastando(false)}
              onDrop={(e) => {
                e.preventDefault();
                setArrastando(false);
                void receberArquivo(e.dataTransfer.files?.[0]);
              }}
              disabled={lendo}
              className={`flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors ${
                arrastando
                  ? "border-primary bg-primary/5"
                  : "border-border/70 hover:border-primary/60 hover:bg-muted/40"
              }`}
            >
              <FileSpreadsheet className="h-8 w-8 text-primary" />
              <span className="text-sm font-medium">
                {lendo ? "Lendo planilha…" : "Clique para escolher ou arraste a planilha aqui"}
              </span>
              <span className="text-xs text-muted-foreground">.xlsx, .xls ou .csv</span>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv,text/csv"
              className="hidden"
              onChange={(e) => void receberArquivo(e.target.files?.[0])}
            />

            <div className="rounded-md border border-border/60 bg-muted/40 p-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                A primeira linha deve ter os títulos das colunas. São reconhecidos:{" "}
                <strong>Nome</strong> (ou Cliente, Razão Social), <strong>CNPJ</strong> (ou CPF,
                Documento) e <strong>Telefone</strong> (ou Celular, WhatsApp). Qualquer outra coluna
                é ignorada.
              </p>
              <Button type="button" size="sm" variant="outline" onClick={() => void baixarModelo()}>
                <Download className="h-4 w-4 mr-1" />
                Baixar modelo
              </Button>
            </div>
          </div>
        )}

        {etapa === "revisao" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="default">{novos.length} novo(s)</Badge>
              {duplicados.length > 0 && (
                <Badge variant="secondary">{duplicados.length} já cadastrado(s)</Badge>
              )}
              {repetidos.length > 0 && (
                <Badge variant="outline">{repetidos.length} repetido(s) na planilha</Badge>
              )}
              {comErro.length > 0 && (
                <Badge variant="destructive">{comErro.length} com erro</Badge>
              )}
            </div>

            {duplicados.length > 0 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>
                  {duplicados.length} cliente(s) da planilha já estão cadastrados
                </AlertTitle>
                <AlertDescription className="space-y-3">
                  <ul className="mt-1 max-h-28 overflow-auto text-xs text-muted-foreground">
                    {duplicados.map((l) => (
                      <li key={l.linha}>
                        Linha {l.linha}: <strong>{l.nome}</strong>
                        {l.existenteNome && l.existenteNome !== l.nome
                          ? ` — já cadastrado como “${l.existenteNome}”`
                          : ""}
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={modoDuplicados === "atualizar" ? "default" : "outline"}
                      onClick={() => setModoDuplicados("atualizar")}
                    >
                      <RefreshCw className="h-4 w-4 mr-1" />
                      Atualizar cadastro
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={modoDuplicados === "ignorar" ? "default" : "outline"}
                      onClick={() => setModoDuplicados("ignorar")}
                    >
                      <SkipForward className="h-4 w-4 mr-1" />
                      Ignorar
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {modoDuplicados === "atualizar"
                      ? "Nome, documento e telefone do cadastro atual serão substituídos pelos da planilha."
                      : "Os cadastros atuais ficam como estão; só os clientes novos entram."}
                  </p>
                </AlertDescription>
              </Alert>
            )}

            <div className="rounded-md border border-border/60 overflow-hidden">
              <div className="max-h-[40vh] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Linha</TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead>CNPJ / CPF</TableHead>
                      <TableHead>Telefone</TableHead>
                      <TableHead className="w-44">Situação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {linhas.map((l) => (
                      <TableRow key={l.linha}>
                        <TableCell className="text-xs text-muted-foreground">{l.linha}</TableCell>
                        <TableCell className="font-medium">{l.nome}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatarDocumento(l.document, l.document_type) ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatarTelefone(l.phone) ?? "—"}
                        </TableCell>
                        <TableCell>
                          {l.status === "novo" && <Badge variant="default">Novo</Badge>}
                          {l.status === "duplicado" && (
                            <Badge variant="secondary">
                              {modoDuplicados === "atualizar" ? "Atualizar" : "Já cadastrado"}
                            </Badge>
                          )}
                          {l.status === "repetido" && <Badge variant="outline">Repetido</Badge>}
                          {l.status === "erro" && <Badge variant="destructive">{l.motivo}</Badge>}
                          {l.aviso && (
                            <p className="mt-1 text-[11px] text-muted-foreground">{l.aviso}</p>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {importacao.isPending && <Progress value={progresso} />}
          </div>
        )}

        {etapa === "resultado" && resultado && (
          <div className="space-y-3">
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Importação concluída</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                  <li>{resultado.criados} cliente(s) criado(s)</li>
                  <li>{resultado.atualizados} cadastro(s) atualizado(s)</li>
                  <li>{resultado.ignorados} linha(s) ignorada(s)</li>
                </ul>
              </AlertDescription>
            </Alert>
            {resultado.falhas.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{resultado.falhas.length} linha(s) não puderam ser salvas</AlertTitle>
                <AlertDescription>
                  <ul className="mt-1 max-h-32 overflow-auto text-xs">
                    {resultado.falhas.map((f, i) => (
                      <li key={i}>
                        <strong>{f.nome}</strong>: {f.msg}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          {etapa === "upload" && (
            <Button type="button" variant="outline" onClick={() => fechar(false)}>
              Cancelar
            </Button>
          )}
          {etapa === "revisao" && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={reset}
                disabled={importacao.isPending}
              >
                Trocar planilha
              </Button>
              <Button
                type="button"
                onClick={() => importacao.mutate()}
                disabled={importacao.isPending || totalAImportar === 0}
              >
                <Upload className="h-4 w-4 mr-1" />
                {importacao.isPending
                  ? "Importando…"
                  : `Importar ${totalAImportar} cliente(s)`}
              </Button>
            </>
          )}
          {etapa === "resultado" && (
            <Button type="button" onClick={() => fechar(false)}>
              Fechar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
