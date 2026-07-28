import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

// Preview isolado: root próprio, alias próprio e nenhum plugin do app real
// (TanStack Start, nitro, lovable). Depende apenas do node_modules da raiz.
export default defineConfig({
  root: here,
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@preview": path.resolve(here, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: 5199,
    strictPort: false,
    open: false,
    fs: { allow: [here, repoRoot] },
  },
  build: {
    outDir: path.resolve(here, "dist"),
    emptyOutDir: true,
  },
});
