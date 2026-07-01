/**
 * Skills API Client — typed client for Skills catalog endpoints.
 *
 * Endpoints:
 *   perAgentUsage  — GET /api/companies/:cid/skills/per-agent-usage
 */

import { api } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AgentSkillEntry {
  skillName: string;
  invocations: number;
  successRate: number;
}

export interface PerAgentUsageItem {
  agentId: string;
  agentName: string;
  skills: AgentSkillEntry[];
  totalInvocations: number;
}

export interface PerAgentUsageResponse {
  agents: PerAgentUsageItem[];
  totalAgents: number;
  totalSkills: number;
}

// ── Client ─────────────────────────────────────────────────────────────────

export const SKILLS = {
  /** Per-agent skill usage breakdown */
  perAgentUsage: (companyId: string) =>
    api.get<PerAgentUsageResponse>(
      `/api/companies/${companyId}/skills/per-agent-usage`,
    ),
};

export default SKILLS;
