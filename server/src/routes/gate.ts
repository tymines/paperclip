// ponytail: gate-decision + kill + run-create + advance. Manual-first pipeline.
import { Router } from "express";
import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { checkGate } from "../rooms-rail/gate-checker.js";
import { logger } from "../middleware/logger.js";
import { resolveRailEventsPath } from "../home-paths.js";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const EVENTS_LOG = resolveRailEventsPath();
const MANUAL_STAGES = ["idea", "spec", "design", "architecture", "build", "review", "ship", "retro"];

function emitEvent(evt: Record<string, unknown>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...evt }) + "\n";
  try {
    fs.mkdirSync(path.dirname(EVENTS_LOG), { recursive: true });
    fs.appendFileSync(EVENTS_LOG, line);
  } catch {}
}

// ponytail: drizzle-compatible raw-SQL helper (same pattern as gym-observability.ts)
async function rows(db: Db, q: ReturnType<typeof sql>): Promise<any[]> {
  return [...(await db.execute(q))] as any[];
}

export function gateRoutes(db: Db) {
  const router = Router();

  // ── Run create — start pipeline at Idea ──
  router.post("/companies/:companyId/pipeline/start", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const { name } = req.body as { name?: string };
    const runId = randomUUID();
    const stageId = randomUUID();
    const runName = name ?? "New Project";

    await db.execute(sql`INSERT INTO pipeline_runs (id, company_id, name, status) VALUES (${runId}, ${companyId}, ${runName}, 'active')`);
    await db.execute(sql`INSERT INTO run_stages (id, pipeline_run_id, name, status, stage_order) VALUES (${stageId}, ${runId}, 'idea', 'active', 0)`);

    emitEvent({ type: "pipeline_start", runId, stageId, name: runName });

    res.status(201).json({ runId, stageId, stage: "idea", name: runName });
  });

  // ── Gate decision + advance ──
  router.post("/companies/:companyId/gate-decision", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);

    if (req.actor.type !== "board") {
      emitEvent({ type: "gate_denied", reason: "agent_blocked", actorType: actor.actorType });
      res.status(403).json({ error: "agents cannot advance gates", actorType: actor.actorType });
      return;
    }

    const { runId, decision, evidence, send_back_to } = req.body as {
      runId?: string; decision?: string; evidence?: string[]; send_back_to?: string;
    };

    if (!runId || !decision) {
      res.status(400).json({ error: "runId and decision required" });
      return;
    }

    const [activeRow] = await rows(db, sql`SELECT id, name, stage_order FROM run_stages WHERE pipeline_run_id = ${runId} AND status = 'active' ORDER BY stage_order LIMIT 1`);

    if (!activeRow) {
      res.status(404).json({ error: "no active stage found" });
      return;
    }

    const currentStage = activeRow.name as string;
    const currentIdx = MANUAL_STAGES.indexOf(currentStage);
    const gateResult = checkGate(currentStage, evidence ?? []);

    if (decision === "pass") {
      await db.execute(sql`UPDATE run_stages SET status = 'passed', completed_at = now() WHERE id = ${activeRow.id}`);

      const nextIdx = currentIdx + 1;
      if (nextIdx < MANUAL_STAGES.length) {
        const nextStage = MANUAL_STAGES[nextIdx];
        const nextId = randomUUID();
        await db.execute(sql`INSERT INTO run_stages (id, pipeline_run_id, name, status, stage_order) VALUES (${nextId}, ${runId}, ${nextStage}, 'active', ${nextIdx})`);
        emitEvent({ type: "stage_advance", runId, from: currentStage, to: nextStage, decision: "pass" });
        res.json({ advanced: true, from: currentStage, to: nextStage, stageId: nextId, gate: gateResult });
      } else {
        await db.execute(sql`UPDATE pipeline_runs SET status = 'completed', completed_at = now() WHERE id = ${runId}`);
        emitEvent({ type: "pipeline_complete", runId });
        res.json({ advanced: false, completed: true, from: currentStage, gate: gateResult });
      }
    } else {
      const targetIdx = send_back_to
        ? MANUAL_STAGES.indexOf(send_back_to)
        : Math.max(0, currentIdx - 1);

      if (targetIdx < 0 || targetIdx >= currentIdx) {
        res.status(400).json({ error: "send_back_to must be an earlier stage" });
        return;
      }

      const targetStage = MANUAL_STAGES[targetIdx];
      const reworkId = randomUUID();

      await db.execute(sql`UPDATE run_stages SET status = 'rework', completed_at = now() WHERE id = ${activeRow.id}`);
      await db.execute(sql`INSERT INTO run_stages (id, pipeline_run_id, name, status, stage_order) VALUES (${reworkId}, ${runId}, ${targetStage}, 'active', ${targetIdx})`);
      await db.execute(sql`UPDATE pipeline_runs SET status = 'active' WHERE id = ${runId}`);

      emitEvent({ type: "stage_rework", runId, from: currentStage, send_back_to: targetStage, reworkStageId: reworkId });
      res.status(409).json({
        rework: true,
        from: currentStage,
        send_back_to: targetStage,
        stageId: reworkId,
        gate: gateResult,
      });
    }
  });

  // ── Kill ──
  router.post("/companies/:companyId/kill", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);

    if (req.actor.type !== "board") {
      res.status(403).json({ error: "only Tyler can kill runs" });
      return;
    }

    const { runId, reason } = req.body as { runId?: string; reason?: string };

    emitEvent({ type: "run_killed", runId, reason, actorId: actor.actorId });
    logger.info({ runId, reason }, "run killed by Tyler");

    res.json({ killed: true, runId, reason: reason ?? "killed by Tyler" });
  });

  // ── Read pipeline runs + stages ──
  router.get("/companies/:companyId/pipeline/runs", async (req, res) => {
    const c = req.params.companyId as string; assertCompanyAccess(req, c);
    const runs = await rows(db, sql`SELECT r.id,r.name,r.status,r.created_at,s.name AS current_stage,s.status AS stage_status FROM pipeline_runs r LEFT JOIN run_stages s ON s.pipeline_run_id=r.id AND s.status IN ('active','rework') WHERE r.company_id=${c} ORDER BY r.created_at DESC`);
    res.json({ runs });
  });
  router.get("/companies/:companyId/pipeline/runs/:runId", async (req, res) => {
    const c = req.params.companyId as string; assertCompanyAccess(req, c);
    const [run] = await rows(db, sql`SELECT id,name,status,created_at FROM pipeline_runs WHERE id=${req.params.runId} AND company_id=${c}`);
    if (!run) { res.status(404).json({ error: "run not found" }); return; }
    const stages = await rows(db, sql`SELECT id,name,status,stage_order,completed_at FROM run_stages WHERE pipeline_run_id=${req.params.runId} ORDER BY stage_order,completed_at`);
    res.json({ run, stages });
  });

  return router;
}
