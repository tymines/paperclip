import type { Db } from "@paperclipai/db";
import { createDesignRunsService } from "./design-runs.js";
import { logger } from "../middleware/logger.js";

/**
 * Subset of open-design skills Jarvis is allowed to invoke by voice.
 * Restricting the enum tames LLM hallucinations: the model picks one of
 * these IDs instead of inventing a slug. Aliases (e.g. `carousel` → real
 * skill id) are resolved on dispatch.
 */
export const DESIGN_TOOL_SKILL_ENUM = [
  "social-carousel",
  "card-xiaohongshu",
  "card-twitter",
  "social-x-post-card",
  "poster-hero",
  "magazine-poster",
  "article-magazine",
  "saas-landing",
  "dashboard",
  "mobile-app",
  "email-marketing",
  "blog-post",
  "frame-glitch-title",
  "frame-light-leak-cinema",
] as const;

const SKILL_ALIAS: Record<string, string> = {
  "social-carousel": "card-xiaohongshu",
  "magazine-poster": "article-magazine",
};

export type DesignToolArgs = {
  skill_id: string;
  prompt: string;
};

export const DESIGN_TOOL_DEF = {
  name: "design_artifact",
  description:
    "Generate a real design artifact (HTML / PNG / MP4) using a locally-running open-design daemon. Use when Tyler asks to design / make / create / mock up a carousel, poster, landing page, mobile prototype, magazine spread, email, dashboard, or social card. Returns a tracking id; the asset shows up in /design and the Design tab. Pick the closest skill_id from the enum and write a self-contained prompt — describe the audience, tone, palette, and any copy you want included.",
  input_schema: {
    type: "object" as const,
    properties: {
      skill_id: {
        type: "string",
        enum: DESIGN_TOOL_SKILL_ENUM,
        description:
          "Which open-design skill to run. 'social-carousel' maps to a 3-card 1080×1080 carousel.",
      },
      prompt: {
        type: "string",
        description:
          "Self-contained brief for the agent — audience, tone, palette, copy. Phrase as instructions, not a reference to this conversation.",
      },
    },
    required: ["skill_id", "prompt"],
  },
};

export async function dispatchDesignTool(
  db: Db,
  companyId: string,
  args: DesignToolArgs,
  createdBy?: string,
): Promise<{ runId: string; skill: string; previewUrl: string }> {
  const service = createDesignRunsService(db);
  const skill = SKILL_ALIAS[args.skill_id] ?? args.skill_id;
  logger.info({ skill, original: args.skill_id }, "jarvis-design-tool: dispatching");
  const run = await service.start({
    companyId,
    skill,
    prompt: args.prompt,
    agentId: "claude",
    createdBy: createdBy ?? undefined,
  });
  return {
    runId: run.id,
    skill,
    previewUrl: `/design?run=${run.id}`,
  };
}

export function designToolAcknowledgment(skill: string): string {
  return `On it — generating a ${skill.replace(/-/g, " ")} now. I'll have it ready in about 30 seconds. Check the Design tab.`;
}
