/**
 * ACP handshake route — POC, READ-ONLY, additive.
 *
 * Mounts `GET /acp/handshake` returning a connected agent's self-described
 * capability bag. Intended to be mounted under `/api`:
 *
 *     app.use("/api", createAcpRouter());   // production integration
 *
 * For the POC it is also served by acp-sidecar.ts on its own port so the
 * capability display can be proven in a real browser WITHOUT restarting the
 * shared Paperclip backend (which would disrupt the parallel Team Mode build).
 *
 * This route never mutates anything and is fully independent of the existing
 * Hermes<->Ares bridge and the production openclaw_gateway adapter.
 */
import { Router } from "express";
import { readGatewayHandshake, readGatewayFleet } from "./gateway-handshake.js";

export function createAcpRouter(): Router {
  const router = Router();

  // GET /acp/handshake?agentId=<gateway agent id>&url=<ws url>&label=<label>
  router.get("/acp/handshake", async (req, res) => {
    const gatewayAgentId = typeof req.query.agentId === "string" ? req.query.agentId : undefined;
    const url = typeof req.query.url === "string" ? req.query.url : undefined;
    const agentLabel = typeof req.query.label === "string" ? req.query.label : undefined;
    try {
      const handshake = await readGatewayHandshake({ gatewayAgentId, url, agentLabel });
      res.status(handshake.ok ? 200 : 502).json(handshake);
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // GET /acp/fleet?url=<ws url>  — Phase 1: per-agent capabilities for the whole
  // self-described roster, built from a single handshake (read-only, additive).
  router.get("/acp/fleet", async (req, res) => {
    const url = typeof req.query.url === "string" ? req.query.url : undefined;
    try {
      const fleet = await readGatewayFleet({ url });
      res.status(fleet.ok ? 200 : 502).json(fleet);
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
