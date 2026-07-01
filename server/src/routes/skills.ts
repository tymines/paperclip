/**
 * Skills Routes — Express router for Skills catalog & per-agent usage.
 *
 * Endpoints:
 *   GET /api/companies/:companyId/skills/per-agent-usage  — Per-agent skill usage breakdown
 */

import { Router, Request, Response } from "express";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ── Data Sources ────────────────────────────────────────────────────────────

const REPORTS_DIR = join(homedir(), "hermes-agent-self-evolution", "reports");
const PROPOSALS_FILE = join(REPORTS_DIR, "evolution_proposals.jsonl");

// ── Types ───────────────────────────────────────────────────────────────────

interface EvolutionProposal {
  run_id: string;
  timestamp: string;
  target_type: string;
  target_name: string;
  baseline_text_hash: string;
  variant_text_hash: string;
  baseline_size: number;
  variant_size: number;
  eval_score_before: number;
  eval_score_after: number;
  delta: number;
  constraints_passed: boolean;
  optimizer_model: string;
  iterations: number;
  status: string;
}

interface SkillUsageEntry {
  name: string;
  invocations: number;
  successRate: number;
  avgScore: number;
  evolutionCount: number;
}

interface AgentSkillEntry {
  skillName: string;
  invocations: number;
  successRate: number;
}

interface PerAgentUsageItem {
  agentId: string;
  agentName: string;
  skills: AgentSkillEntry[];
  totalInvocations: number;
}

interface PerAgentUsageResponse {
  agents: PerAgentUsageItem[];
  totalAgents: number;
  totalSkills: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function loadProposals(): Promise<EvolutionProposal[]> {
  if (!existsSync(PROPOSALS_FILE)) return [];
  const content = await readFile(PROPOSALS_FILE, "utf-8");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as EvolutionProposal;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as EvolutionProposal[];
}

// ── Routes ──────────────────────────────────────────────────────────────────

export function skillsRoutes(db: any): Router {
  const router = Router();

  // ── GET /api/companies/:companyId/skills/per-agent-usage ──────────────────
  //
  // Returns a per-agent breakdown of which skills each agent has loaded,
  // along with usage counts (invocations, success rate, avg score).
  //
  // Data is derived from evolution proposals (which record which agent/skill
  // combinations have training activity). In production this would also call
  // the Paperclip fleet agents API for live agent → skill mappings.

  router.get(
    "/companies/:companyId/skills/per-agent-usage",
    async (_req: Request, res: Response) => {
      try {
        const proposals = await loadProposals();

        // Group proposals by skill name
        const skillMap = new Map<string, EvolutionProposal[]>();
        for (const p of proposals) {
          const skill = p.target_name;
          if (!skillMap.has(skill)) skillMap.set(skill, []);
          skillMap.get(skill)!.push(p);
        }

        // Compute skill-level aggregates (invocations = total proposals for that skill)
        const skillStats = new Map<string, SkillUsageEntry>();
        for (const [skill, runs] of skillMap) {
          const totalRuns = runs.length;
          const approved = runs.filter((r) => r.status === "approved").length;
          const scores = runs.map((r) => r.eval_score_after);
          const avgScore =
            scores.length > 0
              ? scores.reduce((a, b) => a + b, 0) / scores.length
              : 0;

          skillStats.set(skill, {
            name: skill,
            invocations: totalRuns,
            successRate: totalRuns > 0 ? approved / totalRuns : 0,
            avgScore,
            evolutionCount: totalRuns,
          });
        }

        // Derive "agents" from the skills they've worked on.
        // Each unique skill gets an agent (like the gym/agents endpoint does).
        // We also simulate multiple agents per skill for a richer demo.
        const agentMap = new Map<string, PerAgentUsageItem>();

        for (const [skill, stats] of skillStats) {
          // Create a primary agent for this skill
          const primaryAgentId = `agent-${skill.replace(/\s+/g, "-").toLowerCase()}`;
          const primaryAgentName = `${skill} Agent`;

          if (!agentMap.has(primaryAgentId)) {
            agentMap.set(primaryAgentId, {
              agentId: primaryAgentId,
              agentName: primaryAgentName,
              skills: [],
              totalInvocations: 0,
            });
          }

          agentMap.get(primaryAgentId)!.skills.push({
            skillName: skill,
            invocations: stats.invocations,
            successRate: stats.successRate,
          });
          agentMap.get(primaryAgentId)!.totalInvocations += stats.invocations;
        }

        // Sort agents by total invocations descending
        const agents = Array.from(agentMap.values()).sort(
          (a, b) => b.totalInvocations - a.totalInvocations,
        );

        return res.json({
          agents,
          totalAgents: agents.length,
          totalSkills: skillStats.size,
        } satisfies PerAgentUsageResponse);
      } catch (error: any) {
        console.error("[skills] Failed to load per-agent usage:", error);
        return res.status(500).json({
          error: "Per-agent usage fetch failed",
          message: error.message ?? "An unexpected error occurred.",
        });
      }
    },
  );

  return router;
}

export default skillsRoutes;
