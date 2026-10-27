import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImageIcon, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

// ---------------------------------------------------------------------------
// Logo da empresa no AcessoFast instalado nos computadores dos clientes (27/10/2026).
//
// O administrador sobe a logo aqui e ela chega sozinha a todos os computadores da empresa: a
// session-ingest entrega no presence, o agente grava e o app mostra ("Seu suporte", junto do
// ID, e o selo na janela de acesso de quem conectou pelo painel).
//
// Quem tem direito e decidido no banco (marca_da_maquina): plano pago ou em teste. Aqui a
// regra so explica e trava o envio — perder o direito tira a logo das maquinas sem ninguem
// precisar mexer nesta tela.
// ---------------------------------------------------------------------------

/** O mesmo limite do bucket logos-empresas, que o agente confere de novo antes de gravar. */
const TAMANHO_MAX = 1024 * 1024;
const TIPOS = ["image/png", "image/jpeg"];

type Marca = { display_name: string | null; logo_path: string | null };
type Conta = {
  name: string;
  billing_mode: string;
  billing_status: string;
  is_trial: boolean;
  is_active: boolean;
};

/** Mesma regra da marca_da_maquina: plano pago ou em teste, conta ativa e sem bloqueio. */
function temDireito(c: Conta) {
  return (
    c.is_active &&
    c.billing_mode === "plan" &&
    ["active", "trialing", "dunning"].includes(c.billing_status)
  );
}

async function problemaNaImagem(f: File): Promise<string | null> {
  if (!TIPOS.includes(f.type)) return "Use uma imagem PNG ou JPG.";
  if (f.size > TAMANHO_MAX) return "A imagem passa de 1 MB. Use uma versão menor.";
  // Abre a imagem antes de enviar: arquivo renomeado ou corrompido nao chega as maquinas.
  try {
    const bmp = await createImageBitmap(f);
    const pequena = bmp.width < 32 || bmp.height < 16;
    bmp.close();
    if (pequena) return "A imagem é pequena demais. Use uma com pelo menos 200 pixels de largura.";
  } catch {
    return "Não foi possível abrir essa imagem. Tente outro arquivo.";
  }
  return null;
}

export function LogoEmpresaCard({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient();

  const marca = useQuery({
    queryKey: ["tenant_settings_marca", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_settings")
        .select("display_name, logo_path")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      return data as Marca | null;
    },
  });

  const conta = useQuery({
    queryKey: ["tenant_conta_marca", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("name, billing_mode, billing_status, is_trial, is_active")
        .eq("id", tenantId)
        .maybeSingle();
      if (error) throw error;
      return data as Conta | null;
    },
  });

  if (marca.isPending || conta.isPending) return <Skeleton className="h-72 w-full" />;
  if (marca.isError || conta.isError || !marca.data || !conta.data) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Não foi possível carregar a logo desta empresa. Tente de novo em instantes.
        </CardContent>
      </Card>
    );
  }

  return (
    // key: salvar recomeca o formulario a partir do que ficou gravado.
    <LogoForm
      key={`${marca.data.logo_path}|${marca.data.display_name}`}
      tenantId={tenantId}
      salvo={marca.data}
      conta={conta.data}
      aoSalvar={() =>
        queryClient.invalidateQueries({ queryKey: ["tenant_settings_marca", tenantId] })
      }
    />
  );
}

function LogoForm({
  tenantId,
  salvo,
  conta,
  aoSalvar,
}: {
  tenantId: string;
  salvo: Marca;
  conta: Conta;
  aoSalvar: () => Promise<void>;
}) {
  const direito = temDireito(conta);
  const [nome, setNome] = useState(salvo.display_name ?? "");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [tirar, setTirar] = useState(false);
  const [problema, setProblema] = useState<string | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const campoArquivo = useRef<HTMLInputElement>(null);

  // A logo gravada vem do bucket privado: URL assinada so para a pre-visualizacao.
  const logoSalva = useQuery({
    queryKey: ["logo_empresa_url", salvo.logo_path],
    enabled: !!salvo.logo_path,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("logos-empresas")
        .createSignedUrl(salvo.logo_path as string, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
  });

  useEffect(() => {
    if (!arquivo) {
      setPrevia(null);
      return;
    }
    const url = URL.createObjectURL(arquivo);
    setPrevia(url);
    return () => URL.revokeObjectURL(url);
  }, [arquivo]);

  const escolher = async (f: File | undefined) => {
    if (!f) return;
    const p = await problemaNaImagem(f);
    setProblema(p);
    if (!p) {
      setArquivo(f);
      setTirar(false);
    }
  };

  const nomeFinal = nome.trim();
  const alterado = !!arquivo || tirar || nomeFinal !== (salvo.display_name ?? "");
  const logoNaTela = tirar ? null : (previa ?? logoSalva.data ?? null);
  const temLogo = !tirar && (!!arquivo || !!salvo.logo_path);

  const salvar = useMutation({
    mutationFn: async () => {
      let logo_path = tirar ? null : salvo.logo_path;
      if (arquivo) {
        // Nome novo a cada envio: a maquina nunca pega uma copia antiga guardada no caminho.
        const caminho = `${tenantId}/logo-${Date.now()}.${arquivo.type === "image/png" ? "png" : "jpg"}`;
        const { error: envioErr } = await supabase.storage
          .from("logos-empresas")
          .upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
        if (envioErr) throw new Error("Não foi possível enviar a imagem. Tente de novo.");
        logo_path = caminho;
      }
      const { data, error } = await supabase
        .from("tenant_settings")
        .update({ logo_path, display_name: nomeFinal || null })
        .eq("tenant_id", tenantId)
        .select("tenant_id");
      if (error) throw error;
      // RLS que nao deixa atualizar nao da erro: devolve zero linhas.
      if (!data?.length) throw new Error("Sem permissão para mudar a logo desta empresa.");
      return logo_path;
    },
    onSuccess: async (logo_path) => {
      toast.success(
        logo_path
          ? "Logo salva. Os computadores da empresa passam a mostrar em alguns minutos."
          : "Logo tirada. Ela sai dos computadores em alguns minutos.",
      );
      await aoSalvar();
    },
    onError: (e: unknown) => {
      toast.error((e as { message?: string })?.message ?? "Falha ao salvar");
    },
  });

  const descartar = () => {
    setNome(salvo.display_name ?? "");
    setArquivo(null);
    setTirar(false);
    setProblema(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ImageIcon className="h-4 w-4" aria-hidden />
          Logo no AcessoFast dos seus clientes
        </CardTitle>
        <CardDescription>
          A logo da sua empresa aparece no AcessoFast instalado nos computadores dos clientes, junto
          do ID, para eles saberem quem cuida do suporte. Chega a todos os computadores da empresa
          em alguns minutos, sem reinstalar nada.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!direito && (
          <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-sm">
            A logo no AcessoFast dos clientes faz parte dos planos pagos, e já funciona no teste
            grátis de 7 dias.{" "}
            <Link
              to="/financeiro"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Ver planos
            </Link>
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Imagem da logo</Label>
              <input
                ref={campoArquivo}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={(e) => {
                  void escolher(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!direito || salvar.isPending}
                  onClick={() => campoArquivo.current?.click()}
                >
                  <Upload className="mr-2 h-4 w-4" aria-hidden />
                  {temLogo ? "Trocar a imagem" : "Escolher imagem"}
                </Button>
                {temLogo && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={salvar.isPending}
                    onClick={() => {
                      setArquivo(null);
                      setTirar(true);
                      setProblema(null);
                    }}
                  >
                    Tirar a logo
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                PNG ou JPG de até 1 MB. Funciona melhor uma logo deitada, com fundo branco ou
                transparente: no computador ela fica sempre sobre um fundo branco.
              </p>
              {problema && <p className="text-sm text-destructive">{problema}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="logo-nome">Nome que aparece junto da logo</Label>
              <Input
                id="logo-nome"
                value={nome}
                maxLength={60}
                placeholder={conta.name}
                disabled={!direito}
                onChange={(e) => setNome(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Em branco, aparece o nome da empresa: {conta.name}.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Como aparece no computador do cliente</Label>
            <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
              {temLogo && logoNaTela ? (
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-[52px] w-[150px] shrink-0 items-center justify-center rounded-md border border-border/60 bg-white px-2.5 py-1.5">
                    <img
                      src={logoNaTela}
                      alt={`Logo de ${nomeFinal || conta.name}`}
                      className="max-h-full max-w-full object-contain"
                    />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                      Seu suporte
                    </span>
                    <span className="block truncate text-[15px] font-bold">
                      {nomeFinal || conta.name}
                    </span>
                  </span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {temLogo
                    ? "Carregando a logo..."
                    : "Sem logo: o AcessoFast dos clientes aparece só com o nome AcessoFast."}
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Quando o técnico conecta pelo painel ou pelo app logado, o cliente vê a logo na janela
              de acesso. Quem tenta entrar por fora não ganha a logo: o cliente vê um aviso de que o
              pedido não veio da sua empresa.
            </p>
            {conta.is_trial && direito && (
              <p className="text-xs text-muted-foreground">
                No teste grátis a logo já funciona. Se o plano não for contratado, ela sai dos
                computadores sozinha.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {alterado && (
            <span className="mr-auto text-xs text-muted-foreground">Alterações não salvas.</span>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={!alterado || salvar.isPending}
            onClick={descartar}
          >
            Descartar
          </Button>
          {/* Sem direito ainda da para tirar uma logo antiga; so nao da para mandar outra. */}
          <Button
            type="button"
            disabled={!alterado || (!direito && !tirar) || salvar.isPending}
            onClick={() => salvar.mutate()}
          >
            {salvar.isPending ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
