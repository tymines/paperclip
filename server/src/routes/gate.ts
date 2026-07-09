// ponytail: gate-decision + kill routes. WO-2 §3.3 enforcement endpoints.
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { checkGate } from "../rooms-rail/gate-checker.js";
import { logger } from "../middleware/logger.js";
import fs from "node:fs";
import path from "node:path";

const EVENTS_LOG = path.join(process.cwd(), ".rail_events.jsonl");

function emitEvent(evt: Record<string, unknown>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...evt }) + "\n";
  try { fs.appendFileSync(EVENTS_LOG, line); } catch {}
}

export function gateRoutes(db: Db) {
  const router = Router();

  // POST /companies/:cid/gate-decision
  router.post("/companies/:companyId/gate-decision", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);

    if (actor.actorType !== "board") {
      emitEvent({ type: "gate_denied", reason: "agent_blocked", actorType: actor.actorType });
      res.status(403).json({ error: "agents cannot advance gates", actorType: actor.actorType });
      return;
    }

    const { stage, decision, reason, evidence } = req.body as {
      stage?: string; decision?: string; reason?: string; evidence?: string[];
    };

    if (!stage || !decision) {
      res.status(400).json({ error: "stage and decision required" });
      return;
    }

    const result = checkGate(stage, evidence ?? []);

    if (decision === "pass") {
      result.resolved = true;
      emitEvent({ type: "gate_decision", stage, decision: "pass", reason, result });
      res.json(result);
    } else {
      result.resolved = false;
      result.failed = true;
      emitEvent({ type: "gate_decision", stage, decision: "fail", reason, result });
      res.status(409).json(result);
    }
  });

  // POST /companies/:cid/kill — Tyler-only run kill
  router.post("/companies/:companyId/kill", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);

    if (actor.actorType !== "board") {
      res.status(403).json({ error: "only Tyler can kill runs" });
      return;
    }

    const { runId, reason } = req.body as { runId?: string; reason?: string };

    emitEvent({ type: "run_killed", runId, reason, actorId: actor.actorId });
    logger.info({ runId, reason }, "run killed by Tyler");

    res.json({ killed: true, runId, reason: reason ?? "killed by Tyler" });
  });

  return router;
}
