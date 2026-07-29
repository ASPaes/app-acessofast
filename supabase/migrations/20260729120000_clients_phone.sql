-- Telefone do cliente. A tabela so guardava nome e documento; a importacao de
-- planilha (Nome, CNPJ/CPF, Telefone) precisa da coluna, e o cadastro manual
-- passa a mostrar o campo tambem. Nullable: cliente sem telefone continua valido.
alter table public.clients
  add column if not exists phone text;

-- Defesa em profundidade. Se os grants de clients forem por coluna (como ficou
-- address_book na 20260714002937), uma coluna nova nasce sem privilegio nenhum e
-- o insert/update quebraria em runtime. Quando o grant ja e no nivel da tabela
-- isto e apenas redundante — privilegios de tabela e de coluna se somam.
grant select (phone), insert (phone), update (phone) on public.clients to authenticated;
