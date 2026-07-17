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
import { readLearningFeed, generateProposals, readReflection } from "../services/gym/proposal-generator.js";

async function rows(db: Db, q: ReturnType<typeof sql>): Promise<any[]> {
  return [...(await db.execute(q))] as any[];
}

// ── Migration-0145 runtime gate (2026-07-12, Fable) ──────────────────────
// skill_proposals is created by migration 0145, which is HELD pending journal
// reconciliation + Tyler's restart go. The Gym must stay usable read-only
// without it: GETs return empty + migrationPending, mutations return 503.
let _tableReady: { ok: boolean; at: number } | null = null;
async function proposalsTableReady(db: Db): Promise<boolean> {
  if (_tableReady && Date.now() - _tableReady.at < 30_000) return _tableReady.ok;
  let ok = false;
  try {
    const r = await rows(db, sql`SELECT to_regclass('public.skill_proposals') AS t`);
    ok = Boolean(r[0]?.t);
  } catch {
    ok = false;
  }
  _tableReady = { ok, at: Date.now() };
  return ok;
}
const MIGRATION_PENDING_MSG =
  "skill_proposals table missing — migration 0145_skill_proposals is pending journal reconciliation; proposal persistence is disabled until it is applied deliberately.";

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
    if (!(await proposalsTableReady(db))) {
      res.json({ proposals: [], migrationPending: true }); return;
    }
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
    if (!(await proposalsTableReady(db))) { res.status(503).json({ error: MIGRATION_PENDING_MSG }); return; }

    const { proposals } = generateProposals();
    let inserted = 0;
    for (const p of proposals) {
      const r = await rows(db, sql`
        INSERT INTO skill_proposals
          (id, company_id, agent_name, target_type, target_name, title, detail, rationale,
           effort, value_note, confidence, source_type, source_file, source_ref, status)
        VALUES
          (${randomUUID()}, ${c}, ${p.agent}, ${p.targetType}, ${p.targetName}, ${p.title}, ${p.detail || null}, ${p.valueNote || null},
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
    if (!(await proposalsTableReady(db))) { res.status(503).json({ error: MIGRATION_PENDING_MSG }); return; }
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
    if (!(await proposalsTableReady(db))) { res.status(503).json({ error: MIGRATION_PENDING_MSG }); return; }
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
    if (!(await proposalsTableReady(db))) {
      res.json({ timelines: [], migrationPending: true }); return;
    }
    const all = await rows(db, sql`
      SELECT id, target_name, target_type, title, detail, agent_name, status, reviewed_at, created_at, source_file
      FROM skill_proposals
      WHERE company_id = ${c} AND status IN ('approved', 'pending')
      ORDER BY target_name, COALESCE(reviewed_at, created_at)
    `);
    const byTarget: Record<string, { target: string; type: string; versions: any[] }> = {};
    for (const p of all) {
      const key = p.target_name || "unknown";
      if (!byTarget[key]) byTarget[key] = { target: key, type: p.target_type, versions: [] };
      const approvedCount = byTarget[key].versions.filter((v: any) => v.status === "approved").length;
      byTarget[key].versions.push({
        id: p.id,
        version: p.status === "approved" ? `v1.${approvedCount + 1}` : "pending",
        status: p.status,
        title: p.title,
        detail: p.detail,
        agent: p.agent_name,
        at: p.reviewed_at ?? p.created_at,
        sourceFile: p.source_file,
      });
    }
    res.json({ timelines: Object.values(byTarget) });
  });

  // ── Full reflection content (vault read-only; consolidation dir only) ──
  router.get("/companies/:companyId/gym/reflection", async (req, res) => {
    const c = req.params.companyId as string; assertCompanyAccess(req, c);
    const rel = typeof req.query.path === "string" ? req.query.path : "";
    const doc = readReflection(rel);
    if (!doc) { res.status(404).json({ error: "reflection not found (path must live in 08 - Consolidation)" }); return; }
    res.json(doc);
  });

  return router;
}
