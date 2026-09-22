-- AcessoFast, 22/09/2026: observacao livre por maquina (nota que o tecnico le
-- antes de conectar: "caixa do fundo", "so mexer depois das 18h", "senha do
-- Windows e ...").
--
-- Fica no address_book, e nao em tabela propria, porque e um atributo da
-- maquina como alias e device_group: uma nota por maquina, sem historico, lida
-- em todo lugar onde a linha ja e lida (a lista faz um select so).

alter table public.address_book
  add column if not exists observacoes text;

comment on column public.address_book.observacoes is
  'Nota livre sobre a maquina, escrita e lida no painel. Sem historico e sem uso pelo agente.';

-- Sem este grant a tela recebe "permission denied": a
-- 20260914190000_address_book_colunas_editaveis_e_historico_privado revogou o
-- UPDATE da tabela inteira de authenticated/anon e liberou coluna a coluna.
-- Leitura nao precisa de grant novo — o SELECT continua sendo da tabela toda,
-- filtrado por RLS de tenant.
grant update (observacoes) on public.address_book to authenticated;
