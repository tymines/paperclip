import { api } from "./client";

export interface GymAgentCard {
  name: string;
  status: "active" | "idle" | "paused";
  lastActive: string;
  skillCount: number;
}

export interface EvolutionRun {
  id: string;
  targetSkill: string;
  beforeScore: number;
  afterScore: number;
  delta: number;
  status: "awaiting_approval" | "approved" | "rejected";
  createdAt: string;
  diff: string | null;
  rationale: string | null;
  details: Record<string, unknown> | null;
}

export interface SkillStat {
  skill: string;
  score: number;
  lastImproved: string;
}

export const gymApi = {
  listAgents: (companyId: string): Promise<GymAgentCard[]> =>
    api.get(`/companies/${companyId}/gym/agents`),

  listEvolutionRuns: (companyId: string): Promise<EvolutionRun[]> =>
    api.get(`/companies/${companyId}/gym/evolution-runs`),

  listSkillStats: (companyId: string): Promise<SkillStat[]> =>
    api.get(`/companies/${companyId}/gym/skills-stats`),
};
