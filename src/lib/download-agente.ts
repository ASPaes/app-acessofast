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
