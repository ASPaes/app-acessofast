import { createFileRoute, Link } from "@tanstack/react-router";
import acessofastLogo from "@/assets/acessofast-logo.png.asset.json";

// Esta página existe porque a Play Store exige uma URL pública (não um e-mail)
// para pedido de exclusão de dados, declarada na Segurança dos dados. Ela é o
// par de /privacidade: o que a política promete na seção 11, aqui vira
// procedimento. Mudou uma, confira a outra. Ver PLAY-CONSOLE.md §6.
const CANAL = "suporte@acessofast.com.br";
const PRAZO = "15 dias";

// Mantido igual ao de /privacidade de propósito: é o mesmo cron
// (acessofast_purge_connection_logs) que apaga os dois.
const RETENCAO_SESSOES = "180 dias";

export const Route = createFileRoute("/exclusao-de-dados")({
  head: () => ({
    meta: [
      { title: "Exclusão de dados — AcessoFast" },
      {
        name: "description",
        content:
          "Como pedir a exclusão da sua conta e dos seus dados no AcessoFast: o que é apagado, o que é mantido por obrigação legal e em quanto tempo.",
      },
      // Precisa ser pública e indexável: é a URL declarada na Play Store.
      { name: "robots", content: "index, follow" },
    ],
  }),
  component: ExclusaoDeDadosPage,
});

function ExclusaoDeDadosPage() {
  return (
    <div className="relative min-h-screen w-full bg-background">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(148,163,184,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.04) 1px, transparent 1px)",
          backgroundSize: "46px 46px, 46px 46px",
        }}
      />

      <div className="relative z-10 mx-auto w-full max-w-3xl px-6 py-12 sm:py-16">
        <header className="space-y-6">
          <Link to="/" className="inline-flex items-center gap-3">
            <img src={acessofastLogo.url} alt="AcessoFast" className="h-10 w-10 object-contain" />
            <span className="text-lg font-semibold text-foreground">AcessoFast</span>
          </Link>

          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Exclusão de dados
          </h1>

          <p className="text-sm leading-relaxed text-muted-foreground">
            Esta página vale para o painel web, para o cliente de computador e para o aplicativo
            Android{" "}
            <code className="rounded bg-muted/60 px-1 py-0.5 text-xs text-foreground">
              br.com.aspsoftwares.acessofast.mobile
            </code>
            . Ela explica o que é apagado, o que não pode ser, e o caminho para pedir.
          </p>
        </header>

        <main className="mt-12 space-y-10">
          <section className="space-y-3">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">Como pedir</h2>
            <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
              <p>
                Escreva para{" "}
                <a
                  href={"mailto:" + CANAL + "?subject=Pedido%20de%20exclus%C3%A3o%20de%20dados"}
                  className="text-foreground underline underline-offset-4"
                >
                  {CANAL}
                </a>{" "}
                com o assunto{" "}
                <strong className="text-foreground">Pedido de exclusão de dados</strong> e informe:
              </p>
              <ul className="ml-5 list-disc space-y-1.5">
                <li>o e-mail da sua conta no painel, se você tiver uma; e</li>
                <li>
                  se o pedido for sobre um aparelho, o identificador que o aplicativo exibe na tela
                  inicial.
                </li>
              </ul>
              <p>
                Respondemos em até <strong className="text-foreground">{PRAZO}</strong>. Podemos
                pedir informações que confirmem sua identidade antes de executar — entregar ou
                apagar dados a pedido de quem se passa por você seria o oposto de protegê-los.
              </p>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              Se o seu aparelho é administrado por uma empresa
            </h2>
            <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
              <p>
                É o caso mais comum de quem usa o aplicativo Android: o aparelho foi adotado por uma
                empresa de TI que presta suporte a você. Nesse arranjo{" "}
                <strong className="text-foreground">
                  quem decide sobre aqueles dados é a empresa
                </strong>
                , não nós — ela é a controladora e nós operamos a ferramenta para ela.
              </p>
              <p>
                Você pode escrever para nós assim mesmo: encaminhamos o pedido a ela e avisamos
                você. Mas o caminho mais rápido costuma ser falar direto com a empresa que presta o
                suporte.
              </p>
              <p>
                Independente disso, você pode encerrar o acesso na hora, sozinho:{" "}
                <strong className="text-foreground">desinstalar o aplicativo</strong> no aparelho
                remove a credencial e o aparelho deixa de ser alcançável. Isso interrompe o acesso
                imediatamente, mas não apaga o histórico já registrado — para isso, o pedido acima.
              </p>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              O que é apagado
            </h2>
            <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
              <ul className="ml-5 list-disc space-y-1.5">
                <li>Sua conta de acesso e os dados de cadastro: nome, e-mail e senha.</li>
                <li>Seu vínculo com a empresa e as permissões associadas a ele.</li>
                <li>
                  Os dispositivos cadastrados, incluindo identificador, nome do aparelho, sistema e
                  credencial de acesso.
                </li>
                <li>Os registros de atendimento associados.</li>
              </ul>
              <p>
                Não há o que apagar do conteúdo das sessões: tela, toques, chat e arquivos trafegam
                entre as duas pontas, criptografados, e nunca foram gravados nem armazenados por
                nós. Veja a{" "}
                <Link to="/privacidade" className="text-foreground underline underline-offset-4">
                  Política de Privacidade
                </Link>
                .
              </p>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              O que é mantido, e por quê
            </h2>
            <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
              <p>
                Duas coisas sobrevivem ao pedido, e é melhor dizer isso do que descobrir depois:
              </p>
              <ul className="ml-5 list-disc space-y-1.5">
                <li>
                  <strong className="text-foreground">Documentos fiscais</strong> (notas e registros
                  de cobrança), pelo prazo que a legislação tributária exige. Isso não é escolha
                  nossa.
                </li>
                <li>
                  <strong className="text-foreground">
                    Registros de atendimento que pertencem à empresa contratante
                  </strong>
                  , enquanto estiverem dentro do prazo de guarda dela — por padrão{" "}
                  {RETENCAO_SESSOES}, quando são apagados automaticamente. Eles são a prova de quem
                  acessou qual máquina e quando; apagá-los a pedido de uma das partes tiraria essa
                  proteção da outra.
                </li>
              </ul>
              <p>
                Fora essas duas exceções, o que não for excluído é anonimizado, de forma que não
                possa mais ser ligado a você.
              </p>
            </div>
          </section>
        </main>

        <footer className="mt-16 border-t border-border/60 pt-6 text-xs text-muted-foreground">
          <Link to="/privacidade" className="underline underline-offset-4 hover:text-foreground">
            Política de Privacidade
          </Link>
          <span className="mx-2">·</span>© {new Date().getFullYear()} AcessoFast
        </footer>
      </div>
    </div>
  );
}
