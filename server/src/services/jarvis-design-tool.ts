import type { Db } from "@paperclipai/db";
import { createDesignRunsService } from "./design-runs.js";
import { createPresetRunsService, lookupPreset, PRESET_DEFINITIONS } from "./design-presets.js";
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

// ─── Batched delegation: "have Sidney generate her next N carousels" ───────
//
// Single design_artifact + count, per-iteration prompt substitution. Lets
// Jarvis fan out a whole week of content in one voice command without
// requiring N round-trips through the LLM.

export const DESIGN_BATCH_TOOL_DEF = {
  name: "design_batch",
  description:
    "Fan out N design runs in one call using the same skill + a prompt template. Use when Tyler says things like 'have Sidney generate her next 3 carousels' or 'queue up 5 reels for the week.' The {n} token in prompt_template is substituted with the 1-based iteration index. Returns the parent batch id and the list of started run ids.",
  input_schema: {
    type: "object" as const,
    properties: {
      skill_id: {
        type: "string",
        enum: DESIGN_TOOL_SKILL_ENUM,
        description: "Which open-design skill to run for each item.",
      },
      prompt_template: {
        type: "string",
        description:
          "Brief that applies to every iteration. Use {n} for the item number. The persona's voice should be baked in directly here (e.g. 'For Sidney's voice: warm, contemporary…').",
      },
      count: {
        type: "integer",
        minimum: 1,
        maximum: 10,
        description: "How many runs to fan out (1–10).",
      },
      persona: {
        type: "string",
        description:
          "Optional persona name (e.g. 'Sidney'). Prepended to the brief so the agent knows whose voice to write in.",
      },
    },
    required: ["skill_id", "prompt_template", "count"],
  },
};

export type DesignBatchArgs = {
  skill_id: string;
  prompt_template: string;
  count: number;
  persona?: string;
};

export async function dispatchDesignBatch(
  db: Db,
  companyId: string,
  args: DesignBatchArgs,
  createdBy?: string,
): Promise<{ runs: Array<{ id: string; skill: string }>; persona: string | null }> {
  const service = createDesignRunsService(db);
  const skill = SKILL_ALIAS[args.skill_id] ?? args.skill_id;
  const persona = args.persona?.trim() || null;
  const runs: Array<{ id: string; skill: string }> = [];
  for (let i = 1; i <= args.count; i += 1) {
    const personaLine = persona
      ? `Persona: ${persona}. Stay in their established voice.\n\n`
      : "";
    const prompt = `${personaLine}${args.prompt_template.replace(/\{n\}/g, String(i))}`;
    const row = await service.start({
      companyId,
      skill,
      prompt,
      agentId: "claude",
      createdBy: createdBy ?? undefined,
    });
    runs.push({ id: row.id, skill });
  }
  logger.info(
    { skill, count: args.count, persona },
    "jarvis-design-tool: dispatched batch",
  );
  return { runs, persona };
}

export function designBatchAcknowledgment(args: {
  count: number;
  skill: string;
  persona: string | null;
}): string {
  const who = args.persona ? `${args.persona}` : "the design agent";
  const what = args.skill.replace(/-/g, " ");
  return `On it — I've queued ${args.count} ${what}${args.count === 1 ? "" : "s"} for ${who}. They'll appear in the Design tab as they land.`;
}

// ─── Preset (pack) delegation: "give me a marketing kit" ───────────────────

export const DESIGN_PRESET_SLUG_ENUM = PRESET_DEFINITIONS.map((p) => p.slug);

export const DESIGN_PACK_TOOL_DEF = {
  name: "design_pack",
  description:
    "Run a Paperclip design preset macro — Marketing kit / Landing page / Influencer post pack / Brand kit / Email blast — from a single brief. Returns the parent preset run id and the started child run ids.",
  input_schema: {
    type: "object" as const,
    properties: {
      preset_slug: {
        type: "string",
        enum: DESIGN_PRESET_SLUG_ENUM,
        description: "Which curated preset to run.",
      },
      brief: {
        type: "string",
        description:
          "One-paragraph creative brief. Pack the audience, angle, tone, and any required copy in here.",
      },
      voice: {
        type: "string",
        description:
          "Optional voice descriptor — e.g. 'Sidney — warm, contemporary'.",
      },
    },
    required: ["preset_slug", "brief"],
  },
};

export type DesignPackArgs = {
  preset_slug: string;
  brief: string;
  voice?: string;
};

export async function dispatchDesignPack(
  db: Db,
  companyId: string,
  args: DesignPackArgs,
  createdBy?: string,
): Promise<{ presetRunId: string; childRunIds: string[]; presetSlug: string }> {
  const runsService = createDesignRunsService(db);
  const presets = createPresetRunsService(db, runsService);
  const def = lookupPreset(args.preset_slug);
  if (!def) throw new Error(`unknown preset ${args.preset_slug}`);
  const result = await presets.start({
    companyId,
    presetSlug: def.slug,
    brief: args.brief,
    voice: args.voice,
    createdBy: createdBy ?? undefined,
  });
  return {
    presetRunId: result.preset.id,
    childRunIds: result.runs.map((r) => r.id),
    presetSlug: def.slug,
  };
}

export function designPackAcknowledgment(slug: string, stepCount: number): string {
  const def = lookupPreset(slug);
  const name = def?.name ?? slug;
  return `On it — running the ${name} preset now. That's ${stepCount} artifact${stepCount === 1 ? "" : "s"} coming through the Design tab.`;
}
