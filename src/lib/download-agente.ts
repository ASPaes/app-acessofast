// Onde se baixa o agente do AcessoFast. Mora aqui porque hoje dois lugares
// apontam para cá — o botão do cabeçalho do painel e as instruções que a tela
// de conectar manda para o cliente final — e é o mesmo endereço do fluxo normal
// de instalação (FASE3-DESIGN, item 1). Duas cópias soltas dessa string é uma
// que sai do ar sem ninguém notar.
//
// Era `/baixar` até 25/08/2026. O endereço antigo continua de pé no site,
// respondendo 301 para cá, e precisa continuar: o texto de instalação que a
// tela de conectar gera já foi para clientes por WhatsApp, e quem só for
// instalar semana que vem tem `/baixar` na mão.
export const URL_DOWNLOAD_AGENTE = "https://acessofast.com.br/download";

// O instalador em si, direto — sem passar pela pagina. O `latest` e um ponteiro
// do GitHub que sempre aponta para o release mais recente do instalador, entao
// este endereco nao precisa ser trocado a cada build.
//
// Serve ao comando de atualizacao que o tecnico cola no PowerShell da maquina do
// cliente. A pagina de download nao serve para isso: ela e HTML, e o que o
// comando precisa e do binario.
export const URL_INSTALADOR_DIRETO =
  "https://github.com/ASPaes/acessofast-agent/releases/latest/download/AcessoFastSetup.exe";

// Comando de atualizacao para colar no PowerShell DA MAQUINA DO CLIENTE, ja
// dentro da sessao remota.
//
// Por que um comando e nao "abra o navegador e baixe": dentro de uma sessao
// remota, baixar pelo navegador e uma sequencia de cliques em janela alheia,
// com o download indo parar numa pasta que o tecnico precisa achar depois.
// Colar uma linha e um passo so.
//
// Para colar DENTRO de um PowerShell ja aberto — sem `powershell -Command` na
// frente. Essa era a versao anterior e ela QUEBRA na pratica: colando
// `powershell -Command "..."` dentro do proprio PowerShell, o shell de fora
// consome as aspas e a expressao ($env:TEMP+'\...') chega ao shell de dentro
// como texto literal. O erro que aparece e:
//
//   C:\Users\...\Temp+'\AcessoFastSetup.exe' : O termo ... nao e reconhecido
//
// Sem o aninhamento, "$env:TEMP\..." com aspas duplas resolve normal — inclusive
// quando o caminho tem espaco, que e o caso sempre que o usuario do Windows tem
// espaco no nome.
//
// -UseBasicParsing: Windows Server com o IE nunca aberto quebra o
//   Invoke-WebRequest sem isso, e servidor e justamente onde mais se acha agente
//   velho.
// O instalador roda POR CIMA da instalacao existente: nao desinstala, nao pede
//   nada, nao reinicia a maquina.
// A barra e escapada em DOBRO de proposito: em template literal, `\\` produz uma
// barra so, e `\A` seria consumido como escape — o comando saia
// "$env:TEMPAcessoFastSetup.exe", sem separador. Pego rodando a string, nao
// lendo o codigo.
export const COMANDO_ATUALIZAR_AGENTE =
  `iwr -UseBasicParsing '${URL_INSTALADOR_DIRETO}'` +
  ` -OutFile "$env:TEMP\\\\AcessoFastSetup.exe"; Start-Process "$env:TEMP\\\\AcessoFastSetup.exe"`;
