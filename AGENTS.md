<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Notas de atualização (Novidades)

Toda mudança que o usuário percebe, ao entrar na `main`, ganha uma entrada no topo de
`NOVIDADES` em `src/lib/novidades.ts`, **no mesmo commit** da mudança. O painel mostra essas
notas no botão Novidades, no topo. Texto para o cliente (o que mudou e onde encontrar), sem
detalhe técnico; `para: "admin"` ou `"plataforma"` quando a tela não é de todos. Correção
interna que ninguém vê não entra.
