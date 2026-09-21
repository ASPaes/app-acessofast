import { createFileRoute, Link } from "@tanstack/react-router";
import acessofastLogo from "@/assets/acessofast-logo.png.asset.json";

// ─────────────────────────────────────────────────────────────────────────────
// Identificação do controlador. A Play Store compara esta página com a
// declaração de Segurança dos dados; se mudar o que o app coleta, mude os dois
// no mesmo dia.
// ─────────────────────────────────────────────────────────────────────────────
const CONTROLADOR = {
  razaoSocial: "ASP Desenvolvimento de Softwares Ltda",
  cnpj: "07.507.463/0001-93",
  endereco: "Rua Frei Rogério, 320, Centro, Lages/SC, CEP 88502-199",
  email: "suporte@acessofast.com.br",
};

const ATUALIZADO_EM = "18 de setembro de 2026";

// Prazo de guarda dos registros de sessão. NÃO é um número escolhido aqui: é o
// que o banco de fato faz. O cron acessofast_purge_connection_logs roda toda
// madrugada e apaga connection_logs por tenant_settings.log_retention_days,
// cujo default é 180. Se esse default mudar, este texto mente — mude os dois.
const RETENCAO_SESSOES = "180 dias";

export const Route = createFileRoute("/privacidade")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade — AcessoFast" },
      {
        name: "description",
        content:
          "Como o AcessoFast trata dados no painel, no cliente para computador e no aplicativo Android: o que é coletado, por quê, com quem é compartilhado e como pedir exclusão.",
      },
      // Esta página PRECISA ser indexável e aberta: a Play Store exige uma URL
      // pública, sem login. Não colocar noindex aqui.
      { name: "robots", content: "index, follow" },
    ],
  }),
  component: PrivacidadePage,
});

function Secao({
  id,
  titulo,
  children,
}: {
  id: string;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3">
      <h2 className="text-xl font-semibold tracking-tight text-foreground">{titulo}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

const SUMARIO = [
  ["quem-somos", "Quem trata seus dados"],
  ["a-que-se-aplica", "A que este documento se aplica"],
  ["app-android", "O aplicativo Android: o que ele coleta"],
  ["durante-a-sessao", "O que acontece durante um acesso remoto"],
  ["permissoes", "As permissões que o Android pede"],
  ["conta-painel", "Dados da conta no painel"],
  ["anuncios", "Anúncios no plano gratuito"],
  ["compartilhamento", "Com quem compartilhamos"],
  ["retencao", "Por quanto tempo guardamos"],
  ["seguranca", "Como protegemos"],
  ["direitos", "Seus direitos e como exercê-los"],
  ["menores", "Menores de idade"],
  ["mudancas", "Mudanças nesta política"],
  ["contato", "Contato"],
] as const;

function PrivacidadePage() {
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

          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Política de Privacidade
            </h1>
            <p className="text-sm text-muted-foreground">Última atualização: {ATUALIZADO_EM}</p>
          </div>

          <p className="text-sm leading-relaxed text-muted-foreground">
            O AcessoFast é uma ferramenta de acesso remoto usada por empresas de TI para atender
            seus clientes. Isso significa que alguém pode ver e controlar um computador ou celular à
            distância — e um documento de privacidade que não explica isso em português claro não
            serve para nada. É o que esta página tenta fazer.
          </p>
        </header>

        <nav
          aria-label="Sumário"
          className="mt-10 rounded-lg border border-border/60 bg-muted/20 p-5"
        >
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Nesta página
          </h2>
          <ol className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {SUMARIO.map(([id, titulo], i) => (
              <li key={id}>
                <a
                  href={"#" + id}
                  className="text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                >
                  {i + 1}. {titulo}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <main className="mt-12 space-y-10">
          <Secao id="quem-somos" titulo="1. Quem trata seus dados">
            <p>
              O responsável pelo tratamento (controlador, na linguagem da LGPD) é{" "}
              <strong className="text-foreground">{CONTROLADOR.razaoSocial}</strong>, inscrita no
              CNPJ {CONTROLADOR.cnpj}, com sede na {CONTROLADOR.endereco}.
            </p>
            <p>
              Para qualquer assunto de privacidade, incluindo pedidos de exclusão, o canal é{" "}
              <a
                href={"mailto:" + CONTROLADOR.email}
                className="text-foreground underline underline-offset-4"
              >
                {CONTROLADOR.email}
              </a>
              .
            </p>
            <p>
              Há um detalhe importante nesta arquitetura: quando você usa o AcessoFast como
              funcionário ou cliente de uma empresa de TI,{" "}
              <strong className="text-foreground">
                quem decide o que fazer com os dados daquele atendimento é essa empresa
              </strong>
              , não nós. Nesse caso ela é a controladora e nós operamos a ferramenta para ela. Para
              pedir acesso ou exclusão de dados de um atendimento específico, fale primeiro com a
              empresa que prestou o serviço.
            </p>
          </Secao>

          <Secao id="a-que-se-aplica" titulo="2. A que este documento se aplica">
            <p>Esta política cobre três coisas, que funcionam juntas:</p>
            <ul className="ml-5 list-disc space-y-1.5">
              <li>
                <strong className="text-foreground">O painel web</strong>, onde o técnico vê os
                dispositivos e abre os atendimentos.
              </li>
              <li>
                <strong className="text-foreground">O cliente para computador</strong> (Windows e
                macOS), instalado na máquina que vai ser atendida.
              </li>
              <li>
                <strong className="text-foreground">O aplicativo Android</strong> (
                <code className="rounded bg-muted/60 px-1 py-0.5 text-xs text-foreground">
                  br.com.aspsoftwares.acessofast.mobile
                </code>
                ), instalado no celular ou tablet que vai ser atendido.
              </li>
            </ul>
            <p>
              As seções 3, 4 e 5 tratam especificamente do aplicativo Android, porque é ele que pede
              as permissões mais sensíveis do aparelho.
            </p>
          </Secao>

          <Secao id="app-android" titulo="3. O aplicativo Android: o que ele coleta">
            <p>
              O aplicativo Android transforma o aparelho em um dispositivo que pode ser atendido à
              distância. Ele não tem tela de cadastro, não pede seu nome e não pede seu e-mail. O
              que ele envia para os nossos servidores é apenas o necessário para o aparelho aparecer
              na lista da empresa que o adotou:
            </p>

            <div className="overflow-hidden rounded-lg border border-border/60">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Dado</th>
                    <th className="px-4 py-2.5 font-medium">Para quê</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  <tr>
                    <td className="px-4 py-3 align-top text-foreground">
                      Identificador do aparelho no AcessoFast
                    </td>
                    <td className="px-4 py-3 align-top">
                      É o número que o técnico digita para localizar e conectar. Gerado pelo próprio
                      app: não é o IMEI nem o ID de publicidade do Android.
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 align-top text-foreground">
                      Nome do aparelho, versão do Android e versão do aplicativo
                    </td>
                    <td className="px-4 py-3 align-top">
                      Para você reconhecer qual aparelho é qual na lista, e para sabermos se ele
                      precisa de atualização.
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 align-top text-foreground">
                      Credencial de acesso do aparelho
                    </td>
                    <td className="px-4 py-3 align-top">
                      A senha que autoriza a conexão. É trocada periodicamente e entregue apenas a
                      técnicos autorizados da empresa que adotou o aparelho.
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 align-top text-foreground">
                      Registro de cada atendimento
                    </td>
                    <td className="px-4 py-3 align-top">
                      Hora de início, hora de término e qual técnico conectou. É o que permite
                      auditar depois quem acessou o aparelho e quando.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="rounded-md border border-border/60 bg-muted/20 p-4">
              <strong className="text-foreground">
                O aplicativo Android não coleta, não acessa e não envia:
              </strong>{" "}
              sua localização, sua agenda de contatos, suas fotos, seus arquivos, suas mensagens, o
              microfone, a câmera, nem a lista de aplicativos instalados. Ele também não contém
              anúncios e não usa nenhuma ferramenta de publicidade ou de rastreamento.
            </p>
          </Secao>

          <Secao id="durante-a-sessao" titulo="4. O que acontece durante um acesso remoto">
            <p>
              Esta é a parte que mais importa entender, então ela vai sem rodeios. Enquanto um
              atendimento está em andamento:
            </p>
            <ul className="ml-5 list-disc space-y-1.5">
              <li>
                <strong className="text-foreground">O técnico vê a sua tela ao vivo</strong>, com
                tudo o que estiver nela.
              </li>
              <li>
                <strong className="text-foreground">O técnico pode controlar o aparelho</strong>,
                tocando e digitando como se estivesse com ele na mão.
              </li>
              <li>
                Os dois lados podem trocar mensagens de texto e transferir arquivos durante o
                atendimento.
              </li>
            </ul>
            <p>
              Nada disso começa sozinho. O acesso exige a credencial do aparelho e, no Android, o
              próprio sistema operacional exibe um aviso pedindo sua confirmação antes de a tela ser
              compartilhada. Enquanto a sessão estiver ativa, o Android mantém um indicador visível
              na barra de notificações.
            </p>
            <p>
              <strong className="text-foreground">
                O conteúdo da sessão trafega direto entre os dois aparelhos, criptografado, e não é
                gravado nem armazenado por nós.
              </strong>{" "}
              Nossos servidores apenas intermediam a conexão quando os dois lados não conseguem se
              enxergar diretamente na rede — e, mesmo aí, passam adiante um conteúdo que não podem
              ler. Não gravamos vídeo da sessão, não guardamos o que foi digitado, não guardamos as
              mensagens do chat e não guardamos cópia dos arquivos transferidos. O que fica
              registrado do lado do AcessoFast é só o que está na tabela da seção 3: que houve um
              atendimento, quando, e por quem.
            </p>
            <p>
              A empresa que administra o aparelho pode marcá-lo como privado no painel, e cada
              mudança dessa marcação fica registrada com autor e data, visível para os
              administradores da empresa.
            </p>
          </Secao>

          <Secao id="permissoes" titulo="5. As permissões que o Android pede">
            <p>
              O aplicativo pede poucas permissões, e cada uma existe por um motivo direto. Nenhuma
              delas é usada para qualquer finalidade além da descrita aqui:
            </p>
            <ul className="ml-5 list-disc space-y-2">
              <li>
                <strong className="text-foreground">Captura de tela</strong> — é o que permite ao
                técnico ver o aparelho. O Android exibe o próprio pedido de confirmação dele; sem
                seu aceite, a tela não é compartilhada.
              </li>
              <li>
                <strong className="text-foreground">Serviço de Acessibilidade</strong> — é o que
                permite ao técnico tocar e digitar no aparelho à distância. Você ativa manualmente
                uma vez, nas configurações do Android, e pode desativar a qualquer momento pelo
                mesmo caminho. Usamos esse serviço exclusivamente para reproduzir os toques do
                técnico durante um atendimento: ele não lê o conteúdo das telas para nenhuma outra
                finalidade, não registra o que você digita fora da sessão e não envia nada a
                terceiros.
              </li>
              <li>
                <strong className="text-foreground">Notificações</strong> — para manter visível o
                aviso de que há um atendimento em andamento.
              </li>
              <li>
                <strong className="text-foreground">Execução em segundo plano</strong> — para o
                aparelho continuar alcançável quando o aplicativo não está aberto na tela.
              </li>
            </ul>
          </Secao>

          <Secao id="conta-painel" titulo="6. Dados da conta no painel">
            <p>
              Quem cria conta no painel web é o técnico ou o administrador da empresa. Nesse
              cadastro coletamos nome, e-mail, senha (guardada de forma cifrada, não legível por
              nós), CNPJ ou CPF e o nome da empresa. Usamos isso para identificar você no painel,
              vincular sua conta à empresa certa, controlar o que cada pessoa pode fazer e emitir
              cobrança quando o plano for pago.
            </p>
            <p>
              A empresa também pode cadastrar dados dos próprios clientes dela (nome, documento,
              telefone) para organizar os atendimentos. Esses dados são da empresa: ela os insere,
              ela os administra, e nós os tratamos a pedido dela.
            </p>
            <p>
              De cada atendimento aberto pelo painel guardamos o registro que permite auditá-lo
              depois: qual dispositivo foi acessado, o e-mail do técnico que conectou, o endereço IP
              de onde ele conectou, o horário de início e de término, a duração e eventuais
              observações que ele tenha anotado. Esse registro existe para a empresa, e é o que
              responde à pergunta "quem entrou na minha máquina, e quando".
            </p>
            <p>
              Registramos ainda ações administrativas relevantes — quem adotou um dispositivo, quem
              alterou uma permissão, quem mudou a marcação de privacidade — para que a empresa possa
              auditar a própria operação.
            </p>
          </Secao>

          <Secao id="anuncios" titulo="7. Anúncios no plano gratuito">
            <p>
              O plano gratuito exibe anúncios, e só no painel web — nunca no aplicativo Android e
              nunca no cliente para computador. Eles aparecem em telas de espera, nunca por cima de
              um atendimento em andamento, nunca em tela cheia, e são sempre rotulados como
              publicidade.
            </p>
            <p>
              <strong className="text-foreground">O anunciante não recebe quem você é.</strong> Ele
              não recebe seu nome, seu e-mail, o nome da sua empresa nem qualquer dado da sua
              operação. O relatório que ele recebe é agregado: quantas vezes a peça apareceu,
              quantos cliques teve. Registramos internamente quais anúncios foram exibidos a cada
              pessoa por um motivo específico: é assim que respeitamos o limite diário de anúncios
              por pessoa e fazemos o rodízio entre campanhas. Esse registro não é exposto a
              anunciantes.
            </p>
            <p>Não usamos os dados dos seus atendimentos para direcionar publicidade.</p>
          </Secao>

          <Secao id="compartilhamento" titulo="8. Com quem compartilhamos">
            <p>
              <strong className="text-foreground">Não vendemos seus dados.</strong> Não os cedemos
              para corretoras de dados nem para redes de publicidade.
            </p>
            <p>Os dados chegam a terceiros apenas nestas situações:</p>
            <ul className="ml-5 list-disc space-y-1.5">
              <li>
                <strong className="text-foreground">Fornecedores de infraestrutura</strong> que
                hospedam o banco de dados e os servidores do serviço, contratados como operadores e
                obrigados contratualmente a tratar os dados só conforme nossas instruções.
              </li>
              <li>
                <strong className="text-foreground">
                  A empresa de TI que administra seu aparelho
                </strong>
                , que naturalmente vê os dispositivos e os atendimentos dela.
              </li>
              <li>
                <strong className="text-foreground">Autoridades</strong>, quando houver ordem legal
                que nos obrigue.
              </li>
            </ul>
            <p>
              Parte da infraestrutura pode estar localizada fora do Brasil. Nesses casos, a
              transferência é feita com as salvaguardas exigidas pela LGPD.
            </p>
          </Secao>

          <Secao id="retencao" titulo="9. Por quanto tempo guardamos">
            <ul className="ml-5 list-disc space-y-1.5">
              <li>
                <strong className="text-foreground">Dados da conta e da empresa:</strong> enquanto a
                conta existir.
              </li>
              <li>
                <strong className="text-foreground">Registros de atendimento:</strong>{" "}
                {RETENCAO_SESSOES} após o atendimento, quando são apagados automaticamente. Esse é o
                prazo padrão; a empresa contratante pode definir um prazo diferente para a própria
                operação. Eles existem justamente para permitir verificar depois quem acessou o quê,
                então apagá-los cedo demais tiraria a proteção de quem foi atendido.
              </li>
              <li>
                <strong className="text-foreground">Registros administrativos</strong> (adoção de
                dispositivo, mudança de permissão, marcação de privacidade): enquanto a conta
                existir. São poucos, raros, e é justamente o histórico que perde o sentido se for
                apagado.
              </li>
              <li>
                <strong className="text-foreground">Dados de cobrança:</strong> pelo prazo que a
                legislação fiscal exigir.
              </li>
              <li>
                <strong className="text-foreground">Conteúdo das sessões:</strong> não é guardado —
                não há o que reter.
              </li>
            </ul>
            <p>
              Encerrada a conta, os dados são excluídos ou anonimizados, exceto o que precisarmos
              manter por obrigação legal.
            </p>
          </Secao>

          <Secao id="seguranca" titulo="10. Como protegemos">
            <p>
              Todo o tráfego entre os aplicativos e nossos servidores é criptografado. O conteúdo
              das sessões de acesso remoto é criptografado entre as duas pontas. As senhas de conta
              são guardadas de forma cifrada e não são legíveis nem por nós.
            </p>
            <p>
              O acesso aos dados dentro do produto é separado por empresa e por papel: um usuário de
              uma empresa não alcança os dispositivos, os clientes nem os atendimentos de outra. No
              aparelho Android, as credenciais ficam na área privada do aplicativo, isolada pelo
              próprio sistema operacional.
            </p>
            <p>
              Nenhum sistema é infalível. Se ocorrer um incidente de segurança que possa acarretar
              risco relevante, comunicaremos os afetados e a Autoridade Nacional de Proteção de
              Dados conforme a LGPD.
            </p>
          </Secao>

          <Secao id="direitos" titulo="11. Seus direitos e como exercê-los">
            <p>
              A LGPD garante a você o direito de confirmar que tratamos seus dados, acessá-los,
              corrigi-los, pedir sua anonimização ou exclusão, solicitar portabilidade, saber com
              quem foram compartilhados, e revogar consentimento.
            </p>
            <p>
              Para exercer qualquer um deles, escreva para{" "}
              <a
                href={"mailto:" + CONTROLADOR.email}
                className="text-foreground underline underline-offset-4"
              >
                {CONTROLADOR.email}
              </a>
              . Respondemos em até 15 dias. Podemos pedir informações que confirmem sua identidade
              antes de atender — não para dificultar, mas porque entregar dados a quem se passa por
              você seria o oposto de protegê-los.
            </p>
            <p>
              <strong className="text-foreground">Exclusão de dados:</strong> o procedimento, o que
              é apagado e o que precisa ser mantido estão detalhados em{" "}
              <Link
                to="/exclusao-de-dados"
                className="text-foreground underline underline-offset-4"
              >
                Exclusão de dados
              </Link>
              . Se seus dados foram inseridos pela empresa de TI que administra seu aparelho,
              encaminhamos o pedido a ela, já que é ela quem decide sobre aqueles dados.
            </p>
          </Secao>

          <Secao id="menores" titulo="12. Menores de idade">
            <p>
              O AcessoFast é uma ferramenta profissional, destinada a maiores de 18 anos. Não o
              direcionamos a crianças e adolescentes e não coletamos dados deles de forma
              consciente. Se identificarmos um cadastro nessas condições, ele é encerrado.
            </p>
          </Secao>

          <Secao id="mudancas" titulo="13. Mudanças nesta política">
            <p>
              Se esta política mudar, a data no topo muda junto. Quando a mudança afetar de forma
              relevante como tratamos seus dados, avisamos pelo painel ou por e-mail antes de ela
              passar a valer.
            </p>
          </Secao>

          <Secao id="contato" titulo="14. Contato">
            <p>
              Dúvidas, pedidos ou reclamações sobre privacidade:{" "}
              <a
                href={"mailto:" + CONTROLADOR.email}
                className="text-foreground underline underline-offset-4"
              >
                {CONTROLADOR.email}
              </a>
              .
            </p>
            <p>
              {CONTROLADOR.razaoSocial} — CNPJ {CONTROLADOR.cnpj} — {CONTROLADOR.endereco}
            </p>
          </Secao>
        </main>

        <footer className="mt-16 border-t border-border/60 pt-6 text-xs text-muted-foreground">
          © {new Date().getFullYear()} AcessoFast
        </footer>
      </div>
    </div>
  );
}
