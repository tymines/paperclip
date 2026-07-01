import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { randomUUID } from "crypto";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { assertCompanyAccess } from "./authz.js";

export function gymRoutes(_db: Db) {
  const router = Router();

  // GET /api/companies/:companyId/gym/agents
  router.get("/companies/:companyId/gym/agents", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    // Placeholder agent cards — in production these would come from the agents service
    const agents = [
      { name: "Alpha", status: "active", lastActive: new Date().toISOString(), skillCount: 12 },
      { name: "Beta", status: "idle", lastActive: new Date(Date.now() - 3600000).toISOString(), skillCount: 8 },
      { name: "Gamma", status: "paused", lastActive: new Date(Date.now() - 86400000).toISOString(), skillCount: 5 },
      { name: "Delta", status: "active", lastActive: new Date().toISOString(), skillCount: 15 },
      { name: "Epsilon", status: "idle", lastActive: new Date(Date.now() - 7200000).toISOString(), skillCount: 3 },
      { name: "Zeta", status: "paused", lastActive: new Date(Date.now() - 172800000).toISOString(), skillCount: 7 },
    ];

    res.json(agents);
  });

  // GET /api/companies/:companyId/gym/evolution-runs
  router.get("/companies/:companyId/gym/evolution-runs", async (_req, res) => {
    const evolutionPath = `${homedir()}/hermes-agent-self-evolution/reports/evolution_proposals.jsonl`;

    if (!existsSync(evolutionPath)) {
      res.json([]);
      return;
    }

    try {
      const raw = readFileSync(evolutionPath, "utf-8");
      const lines = raw.split("\n").filter(Boolean);
      const proposals = lines.map((line) => JSON.parse(line));

      // Map proposals to evolution run format
      const runs = proposals.map((p: Record<string, unknown>, i: number) => ({
        id: p.id ?? `run-${randomUUID().slice(0, 8)}`,
        targetSkill: p.targetSkill ?? p.skill ?? "unknown",
        beforeScore: p.beforeScore ?? p.currentScore ?? 0,
        afterScore: p.afterScore ?? p.proposedScore ?? 0,
        delta: Number(p.afterScore ?? p.proposedScore ?? 0) - Number(p.beforeScore ?? p.currentScore ?? 0),
        status: p.status ?? "awaiting_approval",
        createdAt: p.createdAt ?? p.timestamp ?? new Date().toISOString(),
        diff: p.diff ?? p.changeDescription ?? null,
        rationale: p.rationale ?? null,
      }));

      res.json(runs);
    } catch {
      res.json([]);
    }
  });

  // GET /api/companies/:companyId/gym/skills-stats
  router.get("/companies/:companyId/gym/skills-stats", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    // Placeholder skill stats
    const stats = [
      { skill: "Code Review", score: 87, lastImproved: "2026-06-27" },
      { skill: "Task Planning", score: 92, lastImproved: "2026-06-26" },
      { skill: "Communication", score: 78, lastImproved: "2026-06-25" },
      { skill: "Debugging", score: 84, lastImproved: "2026-06-28" },
      { skill: "Documentation", score: 71, lastImproved: "2026-06-24" },
    ];

    res.json(stats);
  });

  return router;
}
