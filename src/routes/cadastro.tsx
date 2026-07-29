import { createFileRoute, useNavigate, redirect, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, ShieldCheck, Eye, EyeOff, ArrowRight, ArrowLeft, Building2 } from "lucide-react";
import { toast } from "sonner";
import acessofastLogo from "@/assets/acessofast-logo.png.asset.json";
import { ParticleBackground } from "@/components/ParticleBackground";
import { apenasDigitos, mascararDocumento, tipoDocumentoValido } from "@/lib/documento";

export const Route = createFileRoute("/cadastro")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: "Criar conta — Acessofast" },
      {
        name: "description",
        content: "Crie sua conta no painel Acessofast.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CadastroPage,
});

const SENHA_MIN = 8;

type LookupResult = {
  ok?: boolean;
  exists?: boolean;
  company_name?: string | null;
  has_seat?: boolean;
  doc_reservado?: boolean;
};

type SubmitResult = {
  ok?: boolean;
  status?: "created" | "pending_approval";
  company_name?: string | null;
};

/** A edge function devolve o motivo no corpo; sem isso sobra "non-2xx status". */
async function mensagemDoErro(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const b = await error.context.json();
      return traduzirErro(b?.error, b?.detail) ?? error.message;
    } catch {
      return error.message;
    }
  }
  return (error as { message?: string })?.message ?? "Não foi possível concluir o cadastro.";
}

function traduzirErro(codigo?: string, detalhe?: string): string | null {
  switch (codigo) {
    case "invalid_document":
      return "CPF ou CNPJ inválido.";
    case "invalid_email":
      return "E-mail inválido.";
    case "weak_password":
      return `A senha precisa de pelo menos ${SENHA_MIN} caracteres.`;
    case "email_already_registered":
      return "Já existe uma conta com este e-mail. Tente entrar ou recuperar a senha.";
    case "document_already_used":
    case "documento_indisponivel":
      return detalhe ?? "Este documento já possui uma conta.";
    case "sem_vagas":
      return detalhe ?? "A empresa atingiu o limite de usuários do plano.";
    case "rate_limited":
      return "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
    case "consent_required":
      return "É preciso aceitar os termos para continuar.";
    default:
      return detalhe ?? codigo ?? null;
  }
}

function CadastroPage() {
  const navigate = useNavigate();

  const [documento, setDocumento] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [aceite, setAceite] = useState(false);

  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [consultando, setConsultando] = useState(false);
  const [empresaExistente, setEmpresaExistente] = useState<LookupResult | null>(null);

  const digitos = apenasDigitos(documento);
  const tipoDoc = tipoDocumentoValido(documento);
  const documentoIncompleto = digitos.length !== 11 && digitos.length !== 14;
  const documentoInvalido = !documentoIncompleto && !tipoDoc;
  const vinculando = empresaExistente?.exists === true;
  const semVaga = vinculando && empresaExistente?.has_seat === false;

  // Consulta o documento assim que ele fica válido. O nome da empresa vem
  // pronto quando ela já existe — a pessoa não deve ter que adivinhar como a
  // conta foi cadastrada.
  const documentoConsultado = useRef<string | null>(null);
  useEffect(() => {
    if (!tipoDoc) {
      setEmpresaExistente(null);
      documentoConsultado.current = null;
      return;
    }
    if (documentoConsultado.current === digitos) return;

    let cancelado = false;
    const timer = setTimeout(async () => {
      setConsultando(true);
      const { data, error } = await supabase.functions.invoke<LookupResult>("signup-publico", {
        body: { action: "lookup", document: digitos },
      });
      if (cancelado) return;
      setConsultando(false);
      documentoConsultado.current = digitos;
      if (error || !data?.ok) {
        // Falha na consulta não bloqueia o cadastro: o submit refaz a decisão
        // no servidor, que é quem manda.
        setEmpresaExistente(null);
        return;
      }
      setEmpresaExistente(data);
      if (data.exists && data.company_name) setEmpresa(data.company_name);
    }, 400);

    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [digitos, tipoDoc]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    if (!tipoDoc) {
      setErro("Informe um CPF ou CNPJ válido.");
      return;
    }
    if (!nome.trim()) {
      setErro("Informe seu nome.");
      return;
    }
    if (!vinculando && !empresa.trim()) {
      setErro("Informe o nome da empresa.");
      return;
    }
    if (senha.length < SENHA_MIN) {
      setErro(`A senha precisa de pelo menos ${SENHA_MIN} caracteres.`);
      return;
    }
    if (senha !== confirmacao) {
      setErro("As senhas não conferem.");
      return;
    }
    if (!aceite) {
      setErro("É preciso aceitar os termos para continuar.");
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.functions.invoke<SubmitResult>("signup-publico", {
      body: {
        action: "submit",
        document: digitos,
        full_name: nome.trim(),
        company_name: empresa.trim(),
        email: email.trim().toLowerCase(),
        password: senha,
        consent: true,
      },
    });

    if (error || !data?.ok) {
      setLoading(false);
      setErro(error ? await mensagemDoErro(error) : "Não foi possível concluir o cadastro.");
      return;
    }

    // Vínculo pendente: entra na sessão só para conseguir acompanhar o status
    // da própria solicitação. Sem empresa no perfil, o painel continua fechado.
    if (data.status === "pending_approval") {
      const { error: loginErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: senha,
      });
      setLoading(false);
      if (loginErr) {
        toast.success("Solicitação enviada. Entre com seu e-mail e senha para acompanhar.");
        navigate({ to: "/auth", replace: true });
        return;
      }
      navigate({ to: "/aguardando-autorizacao", replace: true });
      return;
    }

    setLoading(false);
    toast.success("Conta criada. Entre com seu e-mail e senha.");
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="relative min-h-screen w-full bg-background">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(148,163,184,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.05) 1px, transparent 1px), radial-gradient(circle at 20% 20%, rgba(59,130,246,0.15), transparent 40%), radial-gradient(circle at 85% 80%, rgba(37,99,235,0.10), transparent 45%)",
          backgroundSize: "46px 46px, 46px 46px, 100% 100%, 100% 100%",
        }}
      />
      <ParticleBackground />
      <div className="relative z-10 grid min-h-screen w-full lg:grid-cols-2">
        <div className="hidden lg:flex relative flex-col justify-between p-12 text-sidebar-foreground overflow-hidden">
          <div className="relative flex items-center gap-5">
            <img src={acessofastLogo.url} alt="Acessofast" className="h-24 w-24 object-contain" />
            <div className="leading-tight">
              <div className="text-4xl font-semibold">AcessoFast</div>
              <div className="text-base uppercase tracking-widest text-muted-foreground">
                ASP SOFTWARES
              </div>
            </div>
          </div>

          <div className="relative space-y-6 max-w-3xl">
            <h1 className="text-6xl lg:text-7xl font-semibold tracking-tight text-white">
              Comece agora.
              <br />
              Sem instalar nada.
            </h1>
            <p className="text-lg text-muted-foreground">
              Informe o CNPJ ou CPF da sua operação. Se a empresa já usa o AcessoFast, seu acesso é
              enviado para o administrador dela aprovar.
            </p>
          </div>

          <div className="relative text-[11px] text-muted-foreground">
            © {new Date().getFullYear()} ASP Softwares
          </div>
        </div>

        <div className="flex items-center justify-center p-6">
          <Card className="w-full max-w-lg border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl">
            <CardContent className="space-y-6 p-8">
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-widest text-primary">CRIAR CONTA</div>
                <h2 className="text-4xl font-semibold">Vamos começar</h2>
                <p className="text-sm text-muted-foreground">
                  Comece pelo CNPJ ou CPF — ele define se você abre uma conta nova ou entra numa
                  empresa que já existe.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {erro && (
                  <Alert variant="destructive">
                    <AlertDescription>{erro}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <Label htmlFor="documento">CNPJ ou CPF</Label>
                  <div className="relative">
                    <Input
                      id="documento"
                      inputMode="numeric"
                      required
                      autoComplete="off"
                      placeholder="00.000.000/0000-00"
                      value={documento}
                      onChange={(e) => setDocumento(mascararDocumento(e.target.value))}
                      className="h-12 pr-10"
                      aria-invalid={documentoInvalido}
                    />
                    {consultando && (
                      <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  {documentoInvalido && (
                    <p className="text-xs text-destructive">
                      {digitos.length === 11 ? "CPF inválido." : "CNPJ inválido."}
                    </p>
                  )}
                </div>

                {vinculando && !semVaga && (
                  <Alert>
                    <Building2 className="h-4 w-4" />
                    <AlertDescription>
                      Este documento já pertence a <strong>{empresaExistente?.company_name}</strong>
                      . Seu cadastro será enviado ao administrador dela para aprovação.
                    </AlertDescription>
                  </Alert>
                )}

                {semVaga && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      <strong>{empresaExistente?.company_name}</strong> já usa todas as vagas do
                      plano. Peça ao administrador dela para ampliar o plano antes de se cadastrar.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <Label htmlFor="empresa">Nome da empresa</Label>
                  <Input
                    id="empresa"
                    required
                    autoComplete="organization"
                    placeholder="Como sua operação se chama"
                    value={empresa}
                    onChange={(e) => setEmpresa(e.target.value)}
                    disabled={vinculando}
                    className="h-12 disabled:opacity-100 disabled:text-muted-foreground"
                  />
                  {vinculando && (
                    <p className="text-xs text-muted-foreground">
                      Preenchido pelo documento informado.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="nome">Seu nome</Label>
                  <Input
                    id="nome"
                    required
                    autoComplete="name"
                    placeholder="Nome e sobrenome"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    className="h-12"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">E-mail corporativo</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="nome@empresa.com.br"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-12"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="senha">Senha</Label>
                  <div className="relative">
                    <Input
                      id="senha"
                      type={mostrarSenha ? "text" : "password"}
                      required
                      autoComplete="new-password"
                      placeholder={`Mínimo de ${SENHA_MIN} caracteres`}
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      className="h-12 pr-12"
                    />
                    <button
                      type="button"
                      onClick={() => setMostrarSenha((s) => !s)}
                      aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {mostrarSenha ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmacao">Confirmar senha</Label>
                  <Input
                    id="confirmacao"
                    type={mostrarSenha ? "text" : "password"}
                    required
                    autoComplete="new-password"
                    placeholder="Repita a senha"
                    value={confirmacao}
                    onChange={(e) => setConfirmacao(e.target.value)}
                    className="h-12"
                    aria-invalid={confirmacao.length > 0 && senha !== confirmacao}
                  />
                  {confirmacao.length > 0 && senha !== confirmacao && (
                    <p className="text-xs text-destructive">As senhas não conferem.</p>
                  )}
                </div>

                <div className="flex items-start gap-2 pt-1">
                  <Checkbox
                    id="aceite"
                    checked={aceite}
                    onCheckedChange={(checked) => setAceite(Boolean(checked))}
                    className="mt-0.5"
                  />
                  <Label htmlFor="aceite" className="text-sm font-normal cursor-pointer leading-snug">
                    Autorizo o uso dos meus dados para criar e manter esta conta.
                  </Label>
                </div>

                <Button type="submit" className="w-full h-12" disabled={loading || semVaga}>
                  {loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      {vinculando ? "Solicitar acesso" : "Criar conta"}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>

                <Link
                  to="/auth"
                  className="flex items-center justify-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Já tenho conta
                </Link>

                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Ambiente protegido e monitorado
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
