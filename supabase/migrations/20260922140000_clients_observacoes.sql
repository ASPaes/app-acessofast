-- AcessoFast, 22/09/2026: a nota livre, que nasceu na máquina, passa a existir
-- também no cliente.
--
-- Mesma ideia da 20260922120000 (address_book.observacoes), outro assunto: a nota
-- da MÁQUINA é sobre o equipamento ("caixa do fundo", "só mexer depois das 18h");
-- a do CLIENTE é sobre quem atende ("falar com a Marta", "não atende sábado").
-- Separadas de propósito: juntar as duas obrigaria a repetir o recado do cliente
-- em cada uma das máquinas dele.
--
-- SEM GRANT AQUI, e a diferença para a 20260922120000 é intencional: `clients`
-- ainda tem UPDATE de TABELA INTEIRA para `authenticated` (o mesmo buraco que a
-- 20260914190000 fechou no address_book, e que nesta tabela continua aberto),
-- então a coluna nova já nasce gravável. Quando `clients` for fechado por
-- privilégio de coluna, `observacoes` precisa entrar na lista do grant — junto de
-- name, document, document_type e phone, que são o que a tela escreve.

alter table public.clients
  add column if not exists observacoes text;

comment on column public.clients.observacoes is
  'Nota livre sobre o cliente, escrita e lida no painel. Sem histórico.';
