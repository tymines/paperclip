// Gym Tab (Fable spec): read-only observability + proposal review.
//  - Learning Feed: deep-dream / session-end reflections from the vault
//  - Proposals queue: skill/soul/workflow changes surfaced for Tyler (approve/reject/edit)
//  - Skill Evolution Timeline: derived from approved proposals
//  - Generation: parse vault deep-dreams into pending proposals (nothing auto-executes)
import { Router } from "express";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Db } from "@paperclipai/db";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { readLearningFeed, generateProposals } from "../services/gym/proposal-generator.js";

async function rows(db: Db, q: ReturnType<typeof sql>): Promise<any[]> {
  return [...(await db.execute(q))] as any[];
}

export function gymObservabilityRoutes(db: Db) {
  const router = Router();

  // ── Learning Feed (vault-backed, read-only) ──
  router.get("/companies/:companyId/gym/learning-feed", async (req, res) => {
    const c = req.params.companyId as string; assertCompanyAccess(req, c);
    res.json({ items: readLearningFeed() });
  });

  // ── Proposals list (optional ?status=pending|approved|rejected) ──
  router.get("/companies/:companyId/gym/proposals", async (req, res) => {
    const c = req.params.companyId as string; assertCompanyAccess(req, c);
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const list = status
      ? await rows(db, sql`SELECT * FROM skill_proposals WHERE company_id = ${c} AND status = ${status} ORDER BY created_at DESC`)
      : await rows(db, sql`SELECT * FROM skill_proposals WHERE company_id = ${c} ORDER BY created_at DESC`);
    res.json({ proposals: list });
  });

  // ── Generate proposals from the vault (board only) ──
  router.post("/companies/:companyId/gym/generate-proposals", async (req, res) => {
    const c = req.params.companyId as string; assertCompanyAccess(req, c);
    const actor = getActorInfo(req);
    if (actor.actorType !== "user") { res.status(403).json({ error: "only Tyler can scan for proposals" }); return; }

    const { proposals } = generateProposals();
    let inserted = 0;
    for (const p of proposals) {
      const r = await rows(db, sql`
        INSERT INTO skill_proposals
          (id, company_id, agent_name, target_type, target_name, title, detail, rationale,
           effort, value_note, confidence, source_type, source_file, source_ref, status)
        VALUES
          (${randomUUID()}, ${c}, ${p.agent}, ${p.targetType}, ${p.targetName}, ${p.title}, ${null}, ${p.valueNote},
           ${p.effort}, ${p.valueNote}, ${p.confidence}, 'deep-dream', ${p.sourceFile}, ${p.sourceRef}, 'pending')
        ON CONFLICT (company_id, source_file, source_ref) DO NOTHING
        RETURNING id
      `);
      if (r.length) inserted++;
    }
    res.json({ scanned: proposals.length, inserted });
  });

  // ── Edit a proposal (board only) — tweak before approving ──
  router.patch("/companies/:companyId/gym/proposals/:id", async (req, res) => {
    const c = req.params.companyId as string; assertCompanyAccess(req, c);
    const actor = getActorInfo(req);
    if (actor.actorType !== "user") { res.status(403).json({ error: "only Tyler can edit proposals" }); return; }
    const { title, detail, target_name } = req.body as { title?: string; detail?: string; target_name?: string };
    await db.execute(sql`
      UPDATE skill_proposals SET
        title = COALESCE(${title ?? null}, title),
        detail = COALESCE(${detail ?? null}, detail),
        target_name = COALESCE(${target_name ?? null}, target_name)
      WHERE id = ${req.params.id} AND company_id = ${c}
    `);
    const [proposal] = await rows(db, sql`SELECT * FROM skill_proposals WHERE id = ${req.params.id} AND company_id = ${c}`);
    if (!proposal) { res.status(404).json({ error: "proposal not found" }); return; }
    res.json({ proposal });
  });

  // ── Review a proposal: approve | reject (board only) ──
  router.post("/companies/:companyId/gym/proposals/:id/review", async (req, res) => {
    const c = req.params.companyId as string; assertCompanyAccess(req, c);
    const actor = getActorInfo(req);
    if (actor.actorType !== "user") { res.status(403).json({ error: "only Tyler can review proposals" }); return; }
    const { decision, note } = req.body as { decision?: string; note?: string };
    if (decision !== "approve" && decision !== "reject") {
      res.status(400).json({ error: "decision must be 'approve' or 'reject'" }); return;
    }
    const status = decision === "approve" ? "approved" : "rejected";
    await db.execute(sql`
      UPDATE skill_proposals
      SET status = ${status}, reviewed_at = now(), reviewed_by = 'Tyler', review_note = ${note ?? null}
      WHERE id = ${req.params.id} AND company_id = ${c}
    `);
    const [proposal] = await rows(db, sql`SELECT * FROM skill_proposals WHERE id = ${req.params.id} AND company_id = ${c}`);
    if (!proposal) { res.status(404).json({ error: "proposal not found" }); return; }
    res.json({ proposal });
  });

  // ── Skill Evolution Timeline — derived from approved proposals ──
  router.get("/companies/:companyId/gym/skill-timeline", async (req, res) => {
    const c = req.params.companyId as string; assertCompanyAccess(req, c);
    const approved = await rows(db, sql`
      SELECT target_name, target_type, title, agent_name, reviewed_at, source_file
      FROM skill_proposals
      WHERE company_id = ${c} AND status = 'approved'
      ORDER BY target_name, reviewed_at
    `);
    const byTarget: Record<string, { target: string; type: string; versions: any[] }> = {};
    for (const p of approved) {
      const key = p.target_name || "unknown";
      if (!byTarget[key]) byTarget[key] = { target: key, type: p.target_type, versions: [] };
      const n = byTarget[key].versions.length + 1;
      byTarget[key].versions.push({ version: `v1.${n}`, title: p.title, agent: p.agent_name, at: p.reviewed_at });
    }
    res.json({ timelines: Object.values(byTarget) });
  });

  return router;
}
