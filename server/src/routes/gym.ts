import { Router } from "express";
import { randomUUID } from "node:crypto";
import { eq, and, desc, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { gymEvalSuites, gymEvalRuns, gymPromptCandidates, gymAgentProfiles, activityLog, agents } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";
import { logActivity } from "../services/index.js";

export function gymRoutes(db: Db) {
  const router = Router();

  // GET /companies/:companyId/gym/suites
  router.get("/companies/:companyId/gym/suites", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const rows = await db.select().from(gymEvalSuites)
        .where(eq(gymEvalSuites.companyId, companyId))
        .orderBy(desc(gymEvalSuites.createdAt));
      res.json({ suites: rows });
    } catch (err) { next(err); }
  });

  // POST /companies/:companyId/gym/suites
  router.post("/companies/:companyId/gym/suites", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const { name, description, testCases } = req.body;
      if (!name) return res.status(422).json({ error: "name is required" });
      if (!Array.isArray(testCases)) return res.status(422).json({ error: "testCases must be an array" });
      if (testCases.length === 0) return res.status(422).json({ error: "testCases must not be empty" });
      if (testCases.length > 5) return res.status(422).json({ error: "max 5 test cases per suite (v1 limit)" });
      const actor = (req as any).actor;
      const testCasesWithIds = testCases.map((tc: any) => ({ ...tc, id: tc.id ?? randomUUID() }));
      const [suite] = await db.insert(gymEvalSuites).values({
        companyId, name, description, testCases: testCasesWithIds,
        createdBy: actor?.actorId ?? "unknown",
      }).returning();
      await logActivity(db, { companyId, actorType: actor?.type === "agent" ? "agent" : "user", actorId: actor?.actorId ?? "unknown", action: "create_gym_suite", entityType: "gym_suite", entityId: suite.id });
      res.status(201).json({ suite });
    } catch (err) { next(err); }
  });

  // DELETE /companies/:companyId/gym/suites/:suiteId
  router.delete("/companies/:companyId/gym/suites/:suiteId", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const suiteId = req.params.suiteId;
      const [deleted] = await db.delete(gymEvalSuites)
        .where(and(eq(gymEvalSuites.id, suiteId), eq(gymEvalSuites.companyId, companyId)))
        .returning();
      if (!deleted) return res.status(404).json({ error: "suite not found" });
      const actor = (req as any).actor;
      await logActivity(db, { companyId, actorType: actor?.type === "agent" ? "agent" : "user", actorId: actor?.actorId ?? "unknown", action: "delete_gym_suite", entityType: "gym_suite", entityId: suiteId });
      res.json({ deleted: true });
    } catch (err) { next(err); }
  });

  // POST /companies/:companyId/gym/suites/:suiteId/run
  router.post("/companies/:companyId/gym/suites/:suiteId/run", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const suiteId = req.params.suiteId;
      const { promptCandidateId, agentProfileId } = req.body;
      const [suite] = await db.select().from(gymEvalSuites)
        .where(and(eq(gymEvalSuites.id, suiteId), eq(gymEvalSuites.companyId, companyId))).limit(1);
      if (!suite) return res.status(404).json({ error: "suite not found" });
      const actor = (req as any).actor;
      if (!suite.testCases?.length) return res.status(400).json({ error: "suite has no test cases" });
      const [run] = await db.insert(gymEvalRuns).values({
        companyId, suiteId, status: "running",
        promptCandidateId: promptCandidateId ?? null,
        agentProfileId: agentProfileId ?? null,
        startedAt: new Date(),
      }).returning();
      try {
        const { runEvaluation } = await import("../services/gym/evaluator.js");
        const result = await runEvaluation({ suite, promptCandidate: promptCandidateId ? { id: promptCandidateId } : undefined });
        const overallScore = Math.round(result.scores.reduce((sum, s) => sum + s.score, 0) / result.scores.length);
        await db.update(gymEvalRuns).set({
          status: "completed", scores: result.scores as any, overallScore,
          durationMs: result.scores.reduce((sum, s) => sum + s.latencyMs, 0),
          completedAt: new Date(),
        }).where(eq(gymEvalRuns.id, run.id));
        if (agentProfileId) {
          const [profile] = await db.select().from(gymAgentProfiles)
            .where(and(eq(gymAgentProfiles.id, agentProfileId), eq(gymAgentProfiles.companyId, companyId))).limit(1);
          if (profile) {
            const newTotal = profile.totalRuns + 1;
            const newAvg = profile.averageScore
              ? Math.round((profile.averageScore * profile.totalRuns + overallScore) / newTotal)
              : overallScore;
            await db.update(gymAgentProfiles).set({
              totalRuns: newTotal, averageScore: newAvg,
              bestScore: profile.bestScore ? Math.max(profile.bestScore, overallScore) : overallScore,
              lastRunAt: new Date(),
            }).where(eq(gymAgentProfiles.id, agentProfileId));
          }
        }
        await logActivity(db, { companyId, actorType: actor?.type === "agent" ? "agent" : "user", actorId: actor?.actorId ?? "unknown", action: "run_gym_evaluation", entityType: "gym_run", entityId: run.id });
        return res.status(201).json({ run: { ...run, status: "completed", scores: result.scores, overallScore } });
      } catch (evalErr: any) {
        await db.update(gymEvalRuns).set({
          status: "failed", error: evalErr.message || String(evalErr), completedAt: new Date(),
        }).where(eq(gymEvalRuns.id, run.id));
        await logActivity(db, { companyId, actorType: actor?.type === "agent" ? "agent" : "user", actorId: actor?.actorId ?? "unknown", action: "run_gym_evaluation_failed", entityType: "gym_run", entityId: run.id });
        return res.status(200).json({ run: { ...run, status: "failed", error: evalErr.message } });
      }
    } catch (err) { next(err); }
  });

  // GET /companies/:companyId/gym/runs
  router.get("/companies/:companyId/gym/runs", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const rows = await db.select().from(gymEvalRuns)
        .where(eq(gymEvalRuns.companyId, companyId))
        .orderBy(desc(gymEvalRuns.createdAt));
      res.json({ runs: rows });
    } catch (err) { next(err); }
  });

  // GET /companies/:companyId/gym/runs/:runId
  router.get("/companies/:companyId/gym/runs/:runId", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const runId = req.params.runId;
      const [run] = await db.select().from(gymEvalRuns)
        .where(and(eq(gymEvalRuns.id, runId), eq(gymEvalRuns.companyId, companyId))).limit(1);
      if (!run) return res.status(404).json({ error: "run not found" });
      res.json({ run });
    } catch (err) { next(err); }
  });

  // POST /companies/:companyId/gym/prompts
  router.post("/companies/:companyId/gym/prompts", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const { name, systemPrompt, userPromptTemplate, model, temperature, tags, metadata } = req.body;
      if (!name || !systemPrompt) return res.status(422).json({ error: "name and systemPrompt are required" });
      const actor = (req as any).actor;
      const [candidate] = await db.insert(gymPromptCandidates).values({
        companyId, name, systemPrompt,
        userPromptTemplate: userPromptTemplate ?? null,
        model: model ?? "gemini-2.5-flash",
        temperature: temperature ?? 70,
        tags: tags ?? [],
        metadata: metadata ?? {},
        createdBy: actor?.actorId ?? "unknown",
      }).returning();
      await logActivity(db, { companyId, actorType: actor?.type === "agent" ? "agent" : "user", actorId: actor?.actorId ?? "unknown", action: "create_gym_prompt", entityType: "gym_prompt_candidate", entityId: candidate.id });
      res.status(201).json({ candidate });
    } catch (err) { next(err); }
  });

  // GET /companies/:companyId/gym/agents/:agentId/profile
  router.get("/companies/:companyId/gym/agents/:agentId/profile", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const agentId = req.params.agentId;
      let [profile] = await db.select().from(gymAgentProfiles)
        .where(and(eq(gymAgentProfiles.agentId, agentId), eq(gymAgentProfiles.companyId, companyId))).limit(1);
      if (!profile) return res.status(404).json({ error: "no profile found for this agent" });
      const recentRuns = await db.select({
        id: gymEvalRuns.id, overallScore: gymEvalRuns.overallScore, completedAt: gymEvalRuns.completedAt,
      }).from(gymEvalRuns)
        .where(and(eq(gymEvalRuns.agentProfileId, profile.id), eq(gymEvalRuns.status, "completed")))
        .orderBy(desc(gymEvalRuns.completedAt)).limit(20);
      res.json({ profile, recentRuns });
    } catch (err) { next(err); }
  });

  // GET /companies/:companyId/gym/agents
  router.get("/companies/:companyId/gym/agents", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const rows = await db.select({
        id: agents.id,
        name: agents.name,
        status: agents.status,
      }).from(agents)
        .where(eq(agents.companyId, companyId))
        .orderBy(agents.name);

      // Count skill-related events per agent
      const agentIds = rows.map((a) => a.id);
      const skillCounts = new Map<string, number>();
      if (agentIds.length > 0) {
        for (const aid of agentIds) {
          const [r] = await db.select({
            cnt: sql<number>`count(*)::int`,
          }).from(activityLog)
            .where(and(
              eq(activityLog.companyId, companyId),
              eq(activityLog.agentId, aid),
              sql`${activityLog.entityType} = 'company_skill'`,
            )).limit(1);
          skillCounts.set(aid, r?.cnt ?? 0);
        }
      }

      res.json(rows.map((a) => ({
        name: a.name,
        status: a.status === "running" ? "active" as const : a.status === "crashed" ? "idle" as const : "idle" as const,
        lastActive: new Date().toISOString(), // ponytail: agent last-heartbeat lookup if freshness matters
        skillCount: skillCounts.get(a.id) ?? 0,
      })));
    } catch (err) { next(err); }
  });

  // GET /companies/:companyId/gym/evolution-runs
  router.get("/companies/:companyId/gym/evolution-runs", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const rows = await db.select({
        id: activityLog.id,
        action: activityLog.action,
        details: activityLog.details,
        agentId: activityLog.agentId,
        entityId: activityLog.entityId,
        createdAt: activityLog.createdAt,
      }).from(activityLog)
        .where(and(
          eq(activityLog.companyId, companyId),
          eq(activityLog.entityType, "company_skill"),
        ))
        .orderBy(desc(activityLog.createdAt))
        .limit(50);

      // Fetch skill names for entity IDs
      const skillIds = [...new Set(rows.map((r) => r.entityId).filter(Boolean))];
      const skillNames = new Map<string, string>();
      if (skillIds.length > 0) {
        try {
          const skills = await db.select({
            id: sql<string>`id::text`,
            name: sql<string>`name`,
          }).from(sql`company_skills`)
            .where(sql`id::text = ANY(${skillIds})`);
          for (const s of skills) skillNames.set(s.id, s.name);
        } catch { /* company_skills table access — ok if fails */ }
      }

      res.json(rows.map((r) => {
        const d = (r.details ?? {}) as Record<string, unknown>;
        return {
          id: r.id,
          targetSkill: skillNames.get(r.entityId) ?? (d.skillName as string) ?? r.entityId,
          beforeScore: (d.beforeScore as number) ?? 0,
          afterScore: (d.afterScore as number) ?? 0,
          delta: ((d.afterScore as number) ?? 0) - ((d.beforeScore as number) ?? 0),
          status: (r.action === "skill.evolution_accepted" ? "approved"
            : r.action === "skill.evolution_rejected" ? "rejected"
            : "awaiting_approval") as "approved" | "rejected" | "awaiting_approval",
          createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
          diff: (d.diff as string) ?? null,
          rationale: (d.rationale as string) ?? null,
          details: d,
        };
      }));
    } catch (err) { next(err); }
  });

  // GET /companies/:companyId/gym/skills-stats
  router.get("/companies/:companyId/gym/skills-stats", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      // Aggregate: per skill, latest score + last improved
      const rows = await db.select({
        entityId: activityLog.entityId,
        details: activityLog.details,
        createdAt: activityLog.createdAt,
      }).from(activityLog)
        .where(and(
          eq(activityLog.companyId, companyId),
          eq(activityLog.entityType, "company_skill"),
          sql`${activityLog.details} ? 'afterScore'`,
        ))
        .orderBy(desc(activityLog.createdAt));

      const skillNames = new Map<string, string>();
      const seen = new Set<string>();
      const uniqueIds = [...new Set(rows.map((r) => r.entityId).filter(Boolean))];
      if (uniqueIds.length > 0) {
        try {
          const skills = await db.select({
            id: sql<string>`id::text`,
            name: sql<string>`name`,
          }).from(sql`company_skills`)
            .where(sql`id::text = ANY(${uniqueIds})`);
          for (const s of skills) skillNames.set(s.id, s.name);
        } catch { /* ok */ }
      }

      const stats: { skill: string; score: number; lastImproved: string }[] = [];
      for (const r of rows) {
        if (seen.has(r.entityId)) continue;
        seen.add(r.entityId);
        const d = (r.details ?? {}) as Record<string, unknown>;
        stats.push({
          skill: skillNames.get(r.entityId) ?? (d.skillName as string) ?? r.entityId,
          score: (d.afterScore as number) ?? 0,
          lastImproved: r.createdAt?.toISOString() ?? new Date().toISOString(),
        });
      }
      res.json(stats);
    } catch (err) { next(err); }
  });

  // GET /companies/:companyId/gym/registry — Hephaestus works/fails ledger
  router.get("/companies/:companyId/gym/registry", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      // ponytail: surface eval run results + agent actions
      const evalRows = await db.select({
        id: gymEvalRuns.id, status: gymEvalRuns.status,
        overallScore: gymEvalRuns.overallScore, createdAt: gymEvalRuns.createdAt,
        error: gymEvalRuns.error,
      }).from(gymEvalRuns)
        .where(eq(gymEvalRuns.companyId, companyId))
        .orderBy(desc(gymEvalRuns.createdAt))
        .limit(50);
      const entries = evalRows.map((r) => ({
        id: r.id,
        kind: r.status === "completed" ? "works" as const : "fails" as const,
        score: r.overallScore,
        detail: r.error ?? (r.status === "completed" ? `Score: ${r.overallScore}` : "evaluation failed"),
        at: r.createdAt?.toISOString() ?? "",
      }));
      res.json({ entries });
    } catch (err) { next(err); }
  });

  return router;
}
