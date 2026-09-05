import * as React from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { cx } from "@preview/lib/cx";
import { Button } from "@preview/components/ui/button";
import { Checkbox, Field, Input, PasswordField } from "@preview/components/ui/field";
import { Alert } from "@preview/components/ui/states";
import { StatusBadge } from "@preview/components/ui/badge";
import { useNavegar } from "@preview/lib/router";
import { LOGO_ACESSOFAST } from "@preview/lib/brand";

/**
 * Login.
 * A versão atual usa um cartão de vidro sobre partículas animadas. Aqui o
 * fundo vira uma malha estática discreta com dois halos azuis muito suaves —
 * mesma sensação de "ambiente controlado", sem animação constante rodando
 * atrás de um formulário que a pessoa usa dez vezes por dia.
 */
export function AuthScreen() {
  const navegar = useNavegar();
  const [email, setEmail] = React.useState("");
  const [senha, setSenha] = React.useState("");
  const [manter, setManter] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [carregando, setCarregando] = React.useState(false);

  function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!email.trim() || !senha) {
      setErro("E-mail ou senha inválidos.");
      return;
    }
    setCarregando(true);
    setTimeout(() => {
      setCarregando(false);
      navegar("/dashboard");
    }, 700);
  }

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-bg">
      <Fundo />

      <div className="relative z-10 grid min-h-screen lg:grid-cols-[1.05fr_minmax(0,520px)]">
        {/* Painel de marca */}
        <section className="hidden flex-col justify-between p-12 lg:flex xl:p-16">
          <div className="flex items-center gap-4">
            <img src={LOGO_ACESSOFAST} alt="" aria-hidden className="size-14 object-contain" />
            <div className="leading-tight">
              <p className="text-[22px] font-semibold tracking-[-0.02em] text-ink">AcessoFast</p>
            </div>
          </div>

          <div className="space-y-6">
            <h1 className="max-w-[16ch] text-[52px] font-bold leading-[1.05] tracking-[-0.035em] text-ink xl:text-[60px]">
              Acesso remoto.
              <br />
              <span className="text-primary-light">Sem perder o controle.</span>
            </h1>
            <p className="max-w-[48ch] text-[15px] leading-relaxed text-ink-2">
              Acesse, acompanhe e proteja cada sessão de suporte em um só ambiente. Feito para
              equipes que precisam resolver rápido — com segurança.
            </p>
            <StatusBadge tone="success" pulse>
              Sistema operacional
            </StatusBadge>
          </div>

          <p className="text-[11.5px] text-muted">© 2026 AcessoFast</p>
        </section>

        {/* Formulário */}
        <section className="flex items-center justify-center p-5 sm:p-8">
          <div className="w-full max-w-[420px]">
            <div className="mb-7 flex items-center gap-3 lg:hidden">
              <img src={LOGO_ACESSOFAST} alt="" aria-hidden className="size-9 object-contain" />
              <span className="text-[17px] font-semibold text-ink">AcessoFast</span>
            </div>

            <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-modal">
              <div aria-hidden className="af-brand-line h-[2px] w-full" />
              <div className="space-y-6 p-7 sm:p-8">
                <div className="space-y-1.5">
                  <p className="af-eyebrow text-primary-light">Área administrativa</p>
                  <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">
                    Bem-vindo de volta
                  </h2>
                  <p className="text-[13px] text-muted">
                    Entre com suas credenciais para acessar o painel.
                  </p>
                </div>

                <form onSubmit={entrar} className="space-y-4" noValidate>
                  {erro && <Alert tone="danger">{erro}</Alert>}

                  <Field label="E-mail corporativo" htmlFor="login-email">
                    <Input
                      id="login-email"
                      type="email"
                      autoComplete="email"
                      placeholder="nome@empresa.com.br"
                      value={email}
                      invalid={!!erro}
                      className="h-11 text-[14px]"
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setErro(null);
                      }}
                    />
                  </Field>

                  <Field label="Senha" htmlFor="login-senha">
                    <PasswordField
                      id="login-senha"
                      value={senha}
                      onValueChange={(v) => {
                        setSenha(v);
                        setErro(null);
                      }}
                      placeholder="Digite sua senha"
                    />
                  </Field>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Checkbox
                      id="manter"
                      checked={manter}
                      onCheckedChange={setManter}
                      label="Manter conectado"
                    />
                    <button
                      type="button"
                      className="text-[12.5px] text-primary-light underline-offset-4 hover:underline"
                    >
                      Esqueci minha senha
                    </button>
                  </div>

                  <Button type="submit" size="lg" block loading={carregando}>
                    {carregando ? (
                      "Entrando…"
                    ) : (
                      <>
                        Entrar no painel
                        <ArrowRight aria-hidden />
                      </>
                    )}
                  </Button>

                  <p className="flex items-center justify-center gap-1.5 pt-1 text-[11.5px] text-muted">
                    <ShieldCheck className="size-3.5 text-primary-light" aria-hidden />
                    Ambiente protegido e monitorado
                  </p>
                </form>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Malha estática + dois halos azuis. Sem animação: é tela de uso diário. */
function Fundo() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage: [
          "linear-gradient(rgba(148,163,184,0.045) 1px, transparent 1px)",
          "linear-gradient(90deg, rgba(148,163,184,0.045) 1px, transparent 1px)",
          "radial-gradient(circle at 18% 22%, rgba(47,107,255,0.16), transparent 42%)",
          "radial-gradient(circle at 88% 78%, rgba(47,107,255,0.10), transparent 46%)",
        ].join(","),
        backgroundSize: "48px 48px, 48px 48px, 100% 100%, 100% 100%",
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */

export function DefinirSenhaScreen() {
  const [estado, setEstado] = React.useState<"pronto" | "linkInvalido" | "enviado">("pronto");
  const [senha, setSenha] = React.useState("");
  const [confirma, setConfirma] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg p-5">
      <Fundo />

      <div className="relative z-10 w-full max-w-[420px] space-y-4">
        <div className="mb-2 flex items-center justify-center gap-3">
          <img src={LOGO_ACESSOFAST} alt="" aria-hidden className="size-9 object-contain" />
          <span className="text-[17px] font-semibold text-ink">AcessoFast</span>
        </div>

        {/* Alternador só do preview, para ver os três estados desta tela. */}
        <div className="flex justify-center gap-1.5">
          {(["pronto", "linkInvalido", "enviado"] as const).map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEstado(e)}
              className={cx(
                "rounded-md px-2.5 py-1 text-[11.5px] transition-colors duration-[var(--af-dur-hover)]",
                estado === e
                  ? "bg-primary-soft text-primary-light"
                  : "text-muted hover:bg-surface-hover hover:text-ink",
              )}
            >
              {e === "pronto"
                ? "convite válido"
                : e === "linkInvalido"
                  ? "link expirado"
                  : "link enviado"}
            </button>
          ))}
        </div>

        {estado === "linkInvalido" && (
          <>
            <Alert tone="danger" title="Não foi possível abrir o convite">
              Este link expirou ou já foi utilizado. Solicite um novo abaixo.
            </Alert>
            <Cartao
              titulo="Solicitar novo link"
              descricao="Informe o e-mail usado na contratação para receber um novo link de acesso."
            >
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  setEstado("enviado");
                }}
              >
                <Field label="E-mail" htmlFor="reenvio-email">
                  <Input id="reenvio-email" type="email" autoComplete="email" required />
                </Field>
                <Button type="submit" block>
                  Enviar novo link
                </Button>
              </form>
            </Cartao>
          </>
        )}

        {estado === "enviado" && (
          <Cartao
            titulo="Link enviado"
            descricao="Se este e-mail estiver cadastrado, você receberá um link de acesso em instantes. Verifique também a caixa de spam."
          />
        )}

        {estado === "pronto" && (
          <Cartao
            titulo="Definir senha"
            descricao="Escolha uma senha para acessar o AcessoFast. Mínimo de 8 caracteres."
          >
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (senha.length < 8) {
                  setErro("A senha deve ter no mínimo 8 caracteres.");
                  return;
                }
                if (senha !== confirma) {
                  setErro("As senhas não coincidem.");
                  return;
                }
                setErro(null);
              }}
            >
              <Field label="Nova senha" htmlFor="nova-senha" error={erro}>
                <PasswordField
                  id="nova-senha"
                  value={senha}
                  autoComplete="new-password"
                  onValueChange={(v) => {
                    setSenha(v);
                    setErro(null);
                  }}
                />
              </Field>
              <Field label="Confirmar senha" htmlFor="confirma-senha">
                <PasswordField
                  id="confirma-senha"
                  value={confirma}
                  autoComplete="new-password"
                  onValueChange={(v) => {
                    setConfirma(v);
                    setErro(null);
                  }}
                />
              </Field>
              <Button type="submit" block>
                Definir senha
              </Button>
            </form>
          </Cartao>
        )}
      </div>
    </div>
  );
}

function Cartao({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-modal">
      <div aria-hidden className="af-brand-line h-[2px] w-full" />
      <div className="space-y-5 p-7">
        <div className="space-y-1.5">
          <h1 className="text-[19px] font-semibold tracking-[-0.01em] text-ink">{titulo}</h1>
          <p className="text-[13px] leading-relaxed text-muted">{descricao}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function NaoEncontradaScreen() {
  const navegar = useNavegar();
  return (
    <TelaMensagem
      codigo="404"
      titulo="Página não encontrada"
      descricao="A página que você procura não existe ou foi movida."
      acao={<Button onClick={() => navegar("/dashboard")}>Voltar ao início</Button>}
    />
  );
}

export function ErroScreen() {
  const navegar = useNavegar();
  return (
    <TelaMensagem
      titulo="Esta página não carregou"
      descricao="Algo deu errado do nosso lado. Tente atualizar ou volte ao início."
      acao={
        <>
          <Button>Tentar de novo</Button>
          <Button variant="secondary" onClick={() => navegar("/dashboard")}>
            Início
          </Button>
        </>
      }
    />
  );
}

function TelaMensagem({
  codigo,
  titulo,
  descricao,
  acao,
}: {
  codigo?: string;
  titulo: string;
  descricao: string;
  acao: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg p-5">
      <Fundo />
      <div className="relative z-10 max-w-[46ch] text-center">
        <img
          src={LOGO_ACESSOFAST}
          alt=""
          aria-hidden
          className="mx-auto mb-6 size-12 object-contain"
        />
        {codigo ? (
          <p className="af-num text-[64px] font-bold leading-none tracking-[-0.04em] text-primary-light">
            {codigo}
          </p>
        ) : null}
        <h1 className="mt-4 text-[21px] font-semibold tracking-[-0.01em] text-ink">{titulo}</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{descricao}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">{acao}</div>
      </div>
    </div>
  );
}
