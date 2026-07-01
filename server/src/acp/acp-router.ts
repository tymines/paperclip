/**
 * ACP handshake route — POC, READ-ONLY, additive.
 *
 * Mounts `GET /acp/handshake` returning a connected agent's self-described
 * capability bag, and `GET /acp/fleet` returning per-agent capabilities for the
 * whole roster. Intended to be mounted under `/api`:
 *
 *     app.use("/api", createAcpRouter(db));   // production integration
 *
 * For the POC it is also served by acp-sidecar.ts on its own port so the
 * capability display can be proven in a real browser WITHOUT restarting the
 * shared Paperclip backend (which would disrupt the parallel Team Mode build).
 *
 * This route never mutates anything and is fully independent of the existing
 * Hermes<->Ares bridge and the production openclaw_gateway adapter.
 *
 * When a `db` is supplied and the caller passes `?companyId=`, /acp/fleet
 * builds per-agent capabilities from the REAL Paperclip fleet roster (so the
 * Fleet panel shows Tyler's actual agents + their canonical models) instead of
 * the gateway's self-described persona pool. Reading the roster is a plain
 * SELECT — still read-only and additive.
 */
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { agentService } from "../services/agents.js";
import { readGatewayHandshake, readGatewayFleet } from "./gateway-handshake.js";

export function createAcpRouter(db?: Db): Router {
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

  // GET /acp/fleet?url=<ws url>&companyId=<id>  — Phase 1: per-agent capabilities
  // for the whole roster, built from a single handshake (read-only, additive).
  // With companyId + db, the roster is the REAL Paperclip fleet (names/roles from
  // the DB) joined with the canonical fleet model map.
  router.get("/acp/fleet", async (req, res) => {
    const url = typeof req.query.url === "string" ? req.query.url : undefined;
    const companyId = typeof req.query.companyId === "string" ? req.query.companyId : undefined;
    try {
      let roster:
        | Array<{ id: string; name: string; role?: string | null; title?: string | null }>
        | undefined;
      if (db && companyId) {
        try {
          const rows = await agentService(db).list(companyId);
          roster = rows
            .filter((a) => a.status !== "paused")
            .map((a) => ({
            id: a.id,
            name: a.name,
            role: (a.role as string | null) ?? null,
            title: a.title ?? null,
          }));
        } catch {
          // Roster fetch is best-effort; fall back to the handshake roster.
          roster = undefined;
        }
      }
      const fleet = await readGatewayFleet({ url, roster, skipGateway: true });
      res.status(fleet.ok ? 200 : 502).json(fleet);
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
