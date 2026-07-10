import { createFileRoute, redirect } from "@tanstack/react-router";

// A raiz do painel redireciona para o dashboard.
// O gate de autenticação em /_authenticated cuida do resto (login se preciso).
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
