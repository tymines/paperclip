import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createUiDevWatchOptions } from "./src/lib/vite-watch";

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  build: {
    minify: "esbuild",
  },
  esbuild:
    mode === "production"
      ? {
          drop: ["console", "debugger"],
          legalComments: "none",
        }
      : undefined,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      lexical: path.resolve(__dirname, "./node_modules/lexical/Lexical.mjs"),
    },
  },
  server: {
    port: 5173,
    hmr: { host: "127.0.0.1" },
    // Allow the Cloudflare-tunnelled host (paperclip.augiport.com) so Tyler can
    // open the dev UI from his phone. The tunnel is already access-gated, so the
    // Vite host check adds no security here — keep localhost too for local dev.
    allowedHosts: ["paperclip.augiport.com", "localhost", "127.0.0.1", ".internal"],
    watch: createUiDevWatchOptions(process.cwd()),
    proxy: {
      // ACP phase-2 POC sidecar (read-only). Must precede "/api" so it wins.
      "/api/acp": {
        target: process.env.PP_ACP_TARGET || "http://127.0.0.1:18900",
        changeOrigin: true,
      },
      "/api": {
        target: process.env.PP_API_TARGET || "http://localhost:3100",
        changeOrigin: true,
        ws: true,
      },
    },
  },
}));
