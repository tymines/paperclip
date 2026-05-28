/**
 * Preset macros — one brief in, N design_run rows out, aggregated under a
 * design_preset_run row. Lets Tyler (or a peer agent) say "give me a
 * marketing kit" without picking 5 skills by hand.
 *
 * The set is curated against the actual open-design 0.8.0 catalog (133
 * skills); recipes reference skill ids that exist on the daemon today.
 * Each step is a {skill, briefTemplate}; the macro substitutes {brief}
 * (the user's input) and {persona}/{voice} (optional brand inputs) into
 * the template, then fans out the runs concurrently.
 */
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  designPresetRuns,
  designRuns,
  type DesignPresetRun,
  type DesignRun,
} from "@paperclipai/db";
import type { DesignRunsService } from "./design-runs.js";

export type PresetStep = {
  /** Display label for the UI grid cell. */
  label: string;
  /** Real skill id in the open-design catalog. */
  skill: string;
  /** Mustache-lite template: {brief}, {persona}, {voice}. */
  briefTemplate: string;
};

export type PresetDefinition = {
  slug: string;
  name: string;
  description: string;
  estimateMin: string;
  cardEmoji: string;
  steps: PresetStep[];
};

export const PRESET_DEFINITIONS: PresetDefinition[] = [
  {
    slug: "marketing-kit",
    name: "Marketing kit",
    description:
      "One-pager poster + three social cards (X, Reddit, Xiaohongshu) from one brief.",
    estimateMin: "4–6 min",
    cardEmoji: "kit",
    steps: [
      {
        label: "Poster",
        skill: "poster-hero",
        briefTemplate:
          "Hero one-pager poster for: {brief}\n\nVoice: confident, modern. Highlight the value prop + one CTA. Use a tight palette.",
      },
      {
        label: "X card",
        skill: "social-x-post-card",
        briefTemplate:
          "1080×1080 X post card for: {brief}\n\nPunchy headline, supporting line, brand mark.",
      },
      {
        label: "Reddit card",
        skill: "social-reddit-card",
        briefTemplate:
          "Reddit card visual for: {brief}\n\nTitle-card energy, readable at thumbnail size.",
      },
      {
        label: "Xiaohongshu card",
        skill: "card-xiaohongshu",
        briefTemplate:
          "Xiaohongshu (red book) styled card for: {brief}\n\nWarm tone, lifestyle-leaning.",
      },
    ],
  },
  {
    slug: "landing-page",
    name: "Landing page",
    description:
      "Full single-page HTML landing site with hero / features / CTA. Deployable.",
    estimateMin: "3–5 min",
    cardEmoji: "page",
    steps: [
      {
        label: "Landing page",
        skill: "frontend-dev",
        briefTemplate:
          "Single-file HTML landing page for: {brief}\n\nSections: hero with headline+subhead+primary CTA, three-up feature row, social-proof strip, secondary CTA, footer. Use modern type, generous whitespace, mobile-friendly. Inline all CSS so the file is deployable as-is.",
      },
    ],
  },
  {
    slug: "influencer-post-pack",
    name: "Influencer post pack",
    description:
      "Five carousel posts + three short reels + a caption set. A week of content from one brief.",
    estimateMin: "12–20 min",
    cardEmoji: "pack",
    steps: [
      {
        label: "Carousel 1",
        skill: "card-xiaohongshu",
        briefTemplate:
          "Carousel post 1 of 5 for: {brief}\n\nVoice: {voice}. Open with a hook slide, then 2–3 supporting slides, end with CTA. Use [data-slide] section markers per slide.",
      },
      {
        label: "Carousel 2",
        skill: "card-xiaohongshu",
        briefTemplate:
          "Carousel post 2 of 5 for: {brief}\n\nVoice: {voice}. Counter-intuitive take, 4 slides, evidence-led.",
      },
      {
        label: "Carousel 3",
        skill: "card-xiaohongshu",
        briefTemplate:
          "Carousel post 3 of 5 for: {brief}\n\nVoice: {voice}. Behind-the-scenes / process angle, 5 slides.",
      },
      {
        label: "Carousel 4",
        skill: "card-xiaohongshu",
        briefTemplate:
          "Carousel post 4 of 5 for: {brief}\n\nVoice: {voice}. List format (top 3/5), bold typography.",
      },
      {
        label: "Carousel 5",
        skill: "card-xiaohongshu",
        briefTemplate:
          "Carousel post 5 of 5 for: {brief}\n\nVoice: {voice}. Personal story → lesson, 4 slides, warm.",
      },
      {
        label: "Reel 1",
        skill: "video-hyperframes",
        briefTemplate:
          "Short vertical reel for: {brief}\n\nVoice: {voice}. 5s, 30fps, 1080×1080. Hook in first 1s, payoff by 4s.",
      },
      {
        label: "Reel 2",
        skill: "video-hyperframes",
        briefTemplate:
          "Short vertical reel for: {brief}\n\nVoice: {voice}. Quote-card-with-motion style, 5s.",
      },
      {
        label: "Reel 3",
        skill: "video-hyperframes",
        briefTemplate:
          "Short vertical reel for: {brief}\n\nVoice: {voice}. List-reveal style, 3–5 beats over 5s.",
      },
      {
        label: "Caption set",
        skill: "copywriting",
        briefTemplate:
          "Caption set for an influencer week-of-content drop. Theme: {brief}. Voice: {voice}.\n\nReturn 8 captions (5 for carousels, 3 for reels). Each: hook line, body (max 60 words), 5 hashtags, CTA.",
      },
    ],
  },
  {
    slug: "brand-kit",
    name: "Brand kit",
    description: "Logo concepts + color palette + typography spec from a positioning brief.",
    estimateMin: "5–8 min",
    cardEmoji: "brand",
    steps: [
      {
        label: "Brand guidelines",
        skill: "brand-guidelines",
        briefTemplate:
          "Brand guidelines doc for: {brief}\n\nInclude logo direction, primary/secondary colors with hex, type pair, voice descriptors.",
      },
      {
        label: "Color palette",
        skill: "color-expert",
        briefTemplate:
          "Color palette exploration for: {brief}\n\nPropose 3 candidate palettes (5 colors each) with hex, name, and one-line rationale.",
      },
      {
        label: "Theme tokens",
        skill: "theme-factory",
        briefTemplate:
          "Generate a tokens.css for: {brief}\n\nCSS custom properties for colors / spacing / radius / type scale.",
      },
    ],
  },
  {
    slug: "email-blast",
    name: "Email blast",
    description: "HTML email with hero, body, CTA — inlined CSS, MSO-safe.",
    estimateMin: "2–3 min",
    cardEmoji: "mail",
    steps: [
      {
        label: "HTML email",
        skill: "frontend-dev",
        briefTemplate:
          "Email-safe HTML for: {brief}\n\n600px max width, table-based layout, inline styles, MSO conditional comments, alt text on every image. Sections: hero block, body copy, primary CTA button, footer with unsubscribe placeholder.",
      },
    ],
  },
];

export type PresetRunInput = {
  companyId: string | null;
  presetSlug: string;
  brief: string;
  voice?: string;
  persona?: string;
  createdBy?: string;
  /**
   * Optional bearer-token-friendly per-step idempotency seed. Each step gets
   * keyed as `${seed}:${preset}:${stepIndex}` so re-issuing the same call
   * doesn't duplicate work.
   */
  idempotencySeed?: string;
};

export type PresetRunService = ReturnType<typeof createPresetRunsService>;

export function lookupPreset(slug: string): PresetDefinition | null {
  return PRESET_DEFINITIONS.find((p) => p.slug === slug) ?? null;
}

export function createPresetRunsService(db: Db, designRunsService: DesignRunsService) {
  function applyTemplate(tpl: string, vars: Record<string, string>): string {
    return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  }

  async function start(input: PresetRunInput): Promise<{
    preset: DesignPresetRun;
    runs: DesignRun[];
  }> {
    const def = lookupPreset(input.presetSlug);
    if (!def) throw new Error(`unknown preset: ${input.presetSlug}`);

    const inserted = await db
      .insert(designPresetRuns)
      .values({
        companyId: input.companyId ?? null,
        presetSlug: def.slug,
        brief: input.brief,
        status: "running",
        childRunIds: [],
        createdBy: input.createdBy ?? null,
      })
      .returning();
    const presetRow = inserted[0];

    const vars = {
      brief: input.brief,
      voice: input.voice ?? "warm, confident, contemporary",
      persona: input.persona ?? "",
    };

    // Fire all steps in parallel; the design-runs service already handles
    // concurrent runs and idempotency.
    const childRuns: DesignRun[] = [];
    for (let idx = 0; idx < def.steps.length; idx += 1) {
      const step = def.steps[idx];
      const prompt = applyTemplate(step.briefTemplate, vars);
      const idemKey = input.idempotencySeed
        ? `${input.idempotencySeed}:${def.slug}:${idx}`
        : undefined;
      const run = await designRunsService.start({
        companyId: input.companyId ?? null,
        skill: step.skill,
        prompt,
        createdBy: input.createdBy ?? undefined,
        idempotencyKey: idemKey,
        presetRunId: presetRow.id,
      });
      childRuns.push(run);
    }

    await db
      .update(designPresetRuns)
      .set({ childRunIds: childRuns.map((r) => r.id) })
      .where(eq(designPresetRuns.id, presetRow.id));

    return { preset: { ...presetRow, childRunIds: childRuns.map((r) => r.id) }, runs: childRuns };
  }

  async function get(id: string): Promise<{
    preset: DesignPresetRun;
    runs: DesignRun[];
  } | null> {
    const rows = await db
      .select()
      .from(designPresetRuns)
      .where(eq(designPresetRuns.id, id))
      .limit(1);
    if (!rows[0]) return null;
    const preset = rows[0];
    const runs = await db
      .select()
      .from(designRuns)
      .where(eq(designRuns.presetRunId, id));
    // Roll up status — completed if all children terminal, failed if any failed.
    const allTerminal = runs.every((r) =>
      ["completed", "failed", "cancelled"].includes(r.status),
    );
    const anyFailed = runs.some((r) => r.status === "failed");
    const computedStatus = allTerminal
      ? anyFailed
        ? "partial"
        : "completed"
      : "running";
    if (allTerminal && preset.status !== computedStatus) {
      await db
        .update(designPresetRuns)
        .set({ status: computedStatus, completedAt: new Date() })
        .where(eq(designPresetRuns.id, id));
      preset.status = computedStatus;
      preset.completedAt = new Date();
    }
    return { preset, runs };
  }

  async function list(companyId: string | null, limit = 50): Promise<DesignPresetRun[]> {
    if (companyId) {
      return db
        .select()
        .from(designPresetRuns)
        .where(eq(designPresetRuns.companyId, companyId))
        .orderBy(desc(designPresetRuns.createdAt))
        .limit(limit);
    }
    return db
      .select()
      .from(designPresetRuns)
      .orderBy(desc(designPresetRuns.createdAt))
      .limit(limit);
  }

  return { start, get, list };
}
