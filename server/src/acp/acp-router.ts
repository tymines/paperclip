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
import { assertCompanyAccess } from "../routes/authz.js";
import { readGatewayHandshake, readGatewayFleet } from "./gateway-handshake.js";

interface FleetRosterRow {
  id: string;
  name: string;
  role?: string | null;
  title?: string | null;
  status?: string | null;
}

interface FleetRosterSourceRow extends FleetRosterRow {
  status: string;
}

interface AcpRouterDependencies {
  listAgents?: (companyId: string) => Promise<FleetRosterSourceRow[]>;
  getCompany?: (companyId: string) => Promise<{ issuePrefix: string } | null>;
}

async function getCompanyById(db: Db, companyId: string) {
  // Keep the ACP route lightweight in isolated route tests; production only
  // loads the company service after a validated, authorized company request.
  const { companyService } = await import("../services/companies.js");
  return companyService(db).getById(companyId);
}

export async function readFleetRoster(
  db: Db,
  companyId: string,
  listAgents: (id: string) => Promise<FleetRosterSourceRow[]> = (id) => agentService(db).list(id),
): Promise<
  { ok: true; roster: FleetRosterRow[] } | { ok: false }
> {
  try {
    const rows = await listAgents(companyId);
    return {
      ok: true,
      roster: rows.map((agent) => ({
        id: agent.id,
        name: agent.name,
        role: (agent.role as string | null) ?? null,
        title: agent.title ?? null,
        status: agent.status,
      })),
    };
  } catch {
    return { ok: false };
  }
}

export function createAcpRouter(db?: Db, dependencies: AcpRouterDependencies = {}): Router {
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

  // GET /acp/fleet?companyId=<id> — authorize the company-scoped DB read, then
  // reconcile registered rows into the canonical read-only Fleet definitions.
  router.get("/acp/fleet", async (req, res, next) => {
    try {
      const url = typeof req.query.url === "string" ? req.query.url : undefined;
      const companyId = typeof req.query.companyId === "string" ? req.query.companyId : undefined;
      if (!companyId) {
        res.status(400).json({ ok: false, error: "companyId is required", stage: "validation" });
        return;
      }
      // Authorize before looking up any company data or registered agents.
      assertCompanyAccess(req, companyId);
      let roster: FleetRosterRow[] | undefined;
      let canonicalRoster = false;
      if (db) {
        const company = dependencies.getCompany
          ? await dependencies.getCompany(companyId)
          : await getCompanyById(db, companyId);
        if (!company) {
          res.status(404).json({ ok: false, error: "Company not found", stage: "company" });
          return;
        }
        canonicalRoster = company.issuePrefix.trim().toUpperCase() === "AUG";
        const result = await readFleetRoster(db, companyId, dependencies.listAgents);
        if (!result.ok) {
          res.status(503).json({
            ok: false,
            agentLabel: "Canonical Fleet",
            url: url ?? "",
            error: "Fleet roster unavailable",
            stage: "roster",
          });
          return;
        }
        roster = result.roster;
      }
      const fleet = await readGatewayFleet({ url, roster, canonicalRoster, skipGateway: true });
      res.status(fleet.ok ? 200 : 502).json(fleet);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
