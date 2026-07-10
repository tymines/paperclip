// ponytail: gate-decision + kill + run-create + advance. Manual-first pipeline.
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { checkGate } from "../rooms-rail/gate-checker.js";
import { logger } from "../middleware/logger.js";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const EVENTS_LOG = path.join(process.cwd(), ".rail_events.jsonl");
const MANUAL_STAGES = ["idea", "spec", "design", "architecture", "build", "review", "ship", "retro"];

function emitEvent(evt: Record<string, unknown>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...evt }) + "\n";
  try { fs.appendFileSync(EVENTS_LOG, line); } catch {}
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

    await db.run(`
      INSERT INTO pipeline_runs (id, company_id, name, status) VALUES ($1, $2, $3, 'active');
      INSERT INTO run_stages (id, pipeline_run_id, name, status, stage_order)
        VALUES ($4, $1, 'idea', 'active', 0);
    `, [runId, companyId, name ?? "New Project", stageId]);

    emitEvent({ type: "pipeline_start", runId, stageId, name });

    res.status(201).json({ runId, stageId, stage: "idea", name: name ?? "New Project" });
  });

  // ── Gate decision + advance ──
  router.post("/companies/:companyId/gate-decision", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);

    if (actor.actorType !== "board") {
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

    // ponytail: get current active stage
    const [activeRow] = await db.run(
      "SELECT id, name, stage_order FROM run_stages WHERE pipeline_run_id = $1 AND status = 'active' ORDER BY stage_order LIMIT 1",
      [runId]
    );

    if (!activeRow) {
      res.status(404).json({ error: "no active stage found" });
      return;
    }

    const currentStage = activeRow.name;
    const currentIdx = MANUAL_STAGES.indexOf(currentStage);
    const gateResult = checkGate(currentStage, evidence ?? []);

    if (decision === "pass") {
      // Advance: mark current complete, create next
      await db.run("UPDATE run_stages SET status = 'passed', completed_at = now() WHERE id = $1", [activeRow.id]);

      const nextIdx = currentIdx + 1;
      if (nextIdx < MANUAL_STAGES.length) {
        const nextStage = MANUAL_STAGES[nextIdx];
        const nextId = randomUUID();
        await db.run(
          "INSERT INTO run_stages (id, pipeline_run_id, name, status, stage_order) VALUES ($1, $2, $3, 'active', $4)",
          [nextId, runId, nextStage, nextIdx]
        );
        emitEvent({ type: "stage_advance", runId, from: currentStage, to: nextStage, decision: "pass" });
        res.json({ advanced: true, from: currentStage, to: nextStage, stageId: nextId, gate: gateResult });
      } else {
        await db.run("UPDATE pipeline_runs SET status = 'completed', completed_at = now() WHERE id = $1", [runId]);
        emitEvent({ type: "pipeline_complete", runId });
        res.json({ advanced: false, completed: true, from: currentStage, gate: gateResult });
      }
    } else {
      // Reject: mark current rework, re-activate target (or previous) room
      const targetIdx = send_back_to
        ? MANUAL_STAGES.indexOf(send_back_to)
        : Math.max(0, currentIdx - 1);

      if (targetIdx < 0 || targetIdx >= currentIdx) {
        res.status(400).json({ error: "send_back_to must be an earlier stage" });
        return;
      }

      const targetStage = MANUAL_STAGES[targetIdx];
      const reworkId = randomUUID();

      await db.run("UPDATE run_stages SET status = 'rework', completed_at = now() WHERE id = $1", [activeRow.id]);
      // ponytail: new artifact version — fresh row at target stage
      await db.run(
        "INSERT INTO run_stages (id, pipeline_run_id, name, status, stage_order) VALUES ($1, $2, $3, 'active', $4)",
        [reworkId, runId, targetStage, targetIdx]
      );
      await db.run("UPDATE pipeline_runs SET status = 'active' WHERE id = $1", [runId]);

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
