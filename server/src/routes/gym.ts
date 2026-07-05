import { Router } from "express";
import { randomUUID } from "node:crypto";
import { eq, and, desc } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { gymEvalSuites, gymEvalRuns, gymPromptCandidates, gymAgentProfiles } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";
import { logActivity } from "../services/index.js";

export function gymRoutes(db: Db) {
import { eq, and, desc } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { gymEvalSuites, gymEvalRuns, gymPromptCandidates, gymAgentProfiles } from "@paperclipai/db";
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
>>>>>>> 16829257c (feat(gym): add agent self-evolution toolkit backend — 4 tables, 8 endpoints, Gemini scoring, vitest)
  });

  return router;
}
