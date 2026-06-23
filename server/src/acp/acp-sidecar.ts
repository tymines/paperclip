/**
 * ACP POC sidecar — runs the SAME createAcpRouter() on its own port so the
 * Fleet capability display can be verified end-to-end in a real browser without
 * restarting the shared Paperclip backend.
 *
 * In production this router is mounted in-process under /api (see acp-router.ts).
 * The sidecar exists only to prove the POC additively and in parallel.
 *
 * Usage:  PORT=18900 tsx server/src/acp/acp-sidecar.ts
 */
import express from "express";
import { createAcpRouter } from "./acp-router.js";

const PORT = Number(process.env.ACP_POC_PORT ?? process.env.PORT ?? 18900);

const app = express();
app.use(express.json());

// CORS for the worktree dev UI (vite on a separate port proxies here, but allow
// direct calls too for debugging).
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// Mounted exactly as it would be in app.ts: app.use("/api", createAcpRouter())
app.use("/api", createAcpRouter());

app.get("/api/acp/ping", (_req, res) => res.json({ ok: true, sidecar: "acp-poc", port: PORT }));

app.listen(PORT, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`[acp-poc] sidecar listening on http://127.0.0.1:${PORT}  (GET /api/acp/handshake)`);
});
