import { supabase } from "@/integrations/supabase/client";

// Texto do "no_pending_claim" do adopt-device: o computador não tem pedido de cadastro
// esperando. Até aqui a tela sempre dizia "ainda não apareceu", e isso engana num caso
// comum: o computador JÁ está no painel. A adoção automática (técnico acessa pelo ID a
// partir de um computador cadastrado) consome o pedido, e quem tenta adicionar depois
// recebe o mesmo erro de quem nunca instalou (caso Altic, 16/11/2026).
//
// A consulta passa pela RLS: o técnico só enxerga a própria empresa, então "não achei"
// pode ser computador de outra empresa. Nesse caso fica o texto antigo, que não afirma
// nada sobre o cadastro alheio.
export async function mensagemSemPedidoDeCadastro(rustdeskId: string): Promise<string> {
  const padrao =
    "Esse computador ainda não apareceu aqui. Confirme que o AcessoFast foi instalado nele e está aberto, depois leia o ID de novo.";
  try {
    const { data } = await supabase
      .from("v_dispositivo_status")
      .select("alias, is_active")
      .eq("rustdesk_id", rustdeskId)
      .maybeSingle();
    if (!data) return padrao;
    const nome = data.alias?.trim() ? `“${data.alias.trim()}”` : "esse ID";
    if (data.is_active === false) {
      return `Esse computador já está cadastrado, como ${nome}, mas está inativo. Em Dispositivos, ligue “Mostrar inativos” e clique em Reativar.`;
    }
    return `Esse computador já está cadastrado, como ${nome}, e não precisa ser adicionado de novo. Para trocar o nome ou o cliente, procure por ele em Dispositivos e use Editar.`;
  } catch {
    return padrao;
  }
}
