import {
  pgTable,
  uuid,
  text,
  numeric,
  integer,
  timestamp,
  index,
  primaryKey,
  jsonb,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { personaGroups } from "./persona_groups.js";

/**
 * reels — one row per short-form video reel generated for a persona.
 *
 * Pipeline (per the short-film module spec at docs/short-film-module-spec.md):
 *   queued → directing → generating_keyframes → generating_video → stitching → complete | failed
 *
 * A reel has many reel_scenes (one per beat in the LLM-generated shot list).
 * Each scene rolls up a keyframe image (via image-providers) + a video clip
 * (via video-providers/Atlas Seedance etc). The stitcher service runs FFmpeg
 * locally to concatenate clips into the final 9:16 mp4.
 *
 * Modeled after `generation_jobs` pattern so the reels-orchestrator ticker
 * can reuse the same atomic-claim and cost-tracking shape.
 */
export const reels = pgTable(
  "reels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    personaId: uuid("persona_id")
      .notNull()
      .references(() => personaGroups.id, { onDelete: "cascade" }),

    // User-provided
    title: text("title"),
    prompt: text("prompt").notNull(), // one-line idea from user
    stylePreset: text("style_preset"), // cinematic | viral_meme | day_in_life | thirst_trap | story_arc
    durationSeconds: integer("duration_seconds").notNull(), // target total length
    aspectRatio: text("aspect_ratio").notNull(), // "9:16" | "16:9" | "1:1"

    // LLM scene director output
    directorTitle: text("director_title"), // LLM-generated 3-5 word title
    musicMood: text("music_mood"),

    // Status machine
    status: text("status").notNull(), // queued|directing|generating_keyframes|generating_video|stitching|complete|failed
    errorMessage: text("error_message"),

    // Outputs
    finalVideoUrl: text("final_video_url"),
    finalVideoLocalPath: text("final_video_local_path"), // path on host filesystem
    thumbnailUrl: text("thumbnail_url"),
    finalDurationSeconds: numeric("final_duration_seconds", {
      precision: 6,
      scale: 2,
    }),

    // Cost tracking — rolled up from scenes + stitcher + music
    totalCostUsd: numeric("total_cost_usd", { precision: 10, scale: 4 }),

    // Lineage to enable regeneration & posting
    postedToPlatforms: text("posted_to_platforms").array(), // ['instagram','tiktok',...]

    createdAt: timestamp("created_at").defaultNow().notNull(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
  },
  (t) => ({
    companyIdx: index("reels_company_idx").on(t.companyId),
    personaIdx: index("reels_persona_idx").on(t.personaId),
    statusIdx: index("reels_status_idx").on(t.status),
  }),
);

/**
 * reel_scenes — one row per beat in a reel.
 *
 * Per-scene state machine: pending → keyframe_ready → video_ready → failed.
 * Both keyframe gen and video gen are async with separate provider job IDs
 * so the orchestrator can poll them independently.
 */
export const reelScenes = pgTable(
  "reel_scenes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reelId: uuid("reel_id")
      .notNull()
      .references(() => reels.id, { onDelete: "cascade" }),
    sceneIndex: integer("scene_index").notNull(), // ordered position

    // From scene director
    description: text("description").notNull(),
    cameraFraming: text("camera_framing"), // wide|medium|close-up|POV
    emotion: text("emotion"),
    sceneDurationSeconds: numeric("scene_duration_seconds", {
      precision: 4,
      scale: 2,
    }).notNull(),
    keyframePrompt: text("keyframe_prompt").notNull(),
    motionHint: text("motion_hint"), // what changes during the clip

    // Keyframe gen
    keyframeJobId: text("keyframe_job_id"), // provider-side prediction id
    keyframeProviderHost: text("keyframe_provider_host"), // 'wavespeedai'|'replicate'|'runpod'
    keyframeImageUrl: text("keyframe_image_url"),
    keyframeImageLocalPath: text("keyframe_image_local_path"),
    keyframeCostUsd: numeric("keyframe_cost_usd", { precision: 8, scale: 4 }),

    // Video gen
    videoJobId: text("video_job_id"), // Atlas task_id or equivalent
    videoProviderHost: text("video_provider_host"), // 'atlascloud'|'wavespeedai'|'runpod'
    videoModel: text("video_model"), // e.g. 'bytedance/seedance-v1.5-pro/image-to-video'
    videoClipUrl: text("video_clip_url"),
    videoClipLocalPath: text("video_clip_local_path"),
    videoCostUsd: numeric("video_cost_usd", { precision: 8, scale: 4 }),

    // Status machine
    status: text("status").notNull(), // pending|keyframe_submitted|keyframe_ready|video_submitted|video_ready|failed
    errorMessage: text("error_message"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    reelIdx: index("reel_scenes_reel_idx").on(t.reelId),
    statusIdx: index("reel_scenes_status_idx").on(t.status),
  }),
);

/**
 * reel_templates — niche-aware reusable presets.
 *
 * companyId = null indicates a global system preset shipped with Paperclip
 * (finance, tech, beauty, fashion, etc). companyId = X indicates a
 * user's saved custom template.
 *
 * The `niche` column lets the UI filter templates by content vertical (matches
 * the 10-niche taxonomy seeded in db/seed/reel_templates.ts). The `metadata`
 * jsonb bag carries niche-specific config:
 *   {
 *     hookPatterns: string[],              // ["contrarian", "transformation", "warning"]
 *     sceneCount: number,                  // typical scenes per reel for this niche
 *     targetCutDurationSeconds: number,    // 2.0 for fast-cut, 4.0 for slow
 *     bannedWords: string[],               // compliance: words that auto-reject scripts
 *     requiredDisclaimer: string | null,   // auto-appended to caption (FTC / "not financial advice")
 *     recommendedClips: {                  // which model for which clip type
 *       talking_head: string,              // e.g. "hedra-character-3"
 *       broll: string,                     // e.g. "kling-3.0-pro"
 *       product_shot: string,
 *     },
 *     compatiblePersonas: string[],        // persona names that brand-fit
 *     defaultHashtagPack: string[],        // niche hashtags
 *     complianceCheckPrompt: string | null // LLM prompt run before fire to check script
 *   }
 */
export const reelTemplates = pgTable(
  "reel_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, {
      onDelete: "cascade",
    }), // null = global system preset
    niche: text("niche"), // 'finance' | 'tech' | 'legal' | 'medical' | 'b2b' | 'real_estate' | 'beauty' | 'fashion' | 'fitness' | 'food'
    name: text("name").notNull(),
    description: text("description"),
    stylePreset: text("style_preset").notNull(),
    promptScaffold: text("prompt_scaffold").notNull(), // template injected into scene director
    durationSeconds: integer("duration_seconds").notNull(),
    aspectRatio: text("aspect_ratio").notNull(),
    defaultMusicMood: text("default_music_mood"),
    defaultVideoProvider: text("default_video_provider"),
    metadata: jsonb("metadata"), // niche-specific config bag (see docstring above)
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    nicheIdx: index("reel_templates_niche_idx").on(t.niche),
    companyIdx: index("reel_templates_company_idx").on(t.companyId),
  }),
);

/**
 * reel_series — narrative arcs that span multiple reels with character continuity.
 *
 * E.g. "Day in the Life of Raven" might be 5 reels (Day 1, Day 2, ...) all using
 * the same persona, locations, and tone for cumulative character development.
 */
export const reelSeries = pgTable("reel_series", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  personaId: uuid("persona_id")
    .notNull()
    .references(() => personaGroups.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  narrativeArc: text("narrative_arc"), // freeform story description
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * reel_series_entries — many-to-many with episode ordering.
 */
export const reelSeriesEntries = pgTable(
  "reel_series_entries",
  {
    seriesId: uuid("series_id")
      .notNull()
      .references(() => reelSeries.id, { onDelete: "cascade" }),
    reelId: uuid("reel_id")
      .notNull()
      .references(() => reels.id, { onDelete: "cascade" }),
    episodeIndex: integer("episode_index").notNull(),
    addedAt: timestamp("added_at").defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.seriesId, t.reelId] }),
    episodeIdx: index("reel_series_entries_episode_idx").on(
      t.seriesId,
      t.episodeIndex,
    ),
  }),
);

export type Reel = typeof reels.$inferSelect;
export type NewReel = typeof reels.$inferInsert;
export type ReelScene = typeof reelScenes.$inferSelect;
export type NewReelScene = typeof reelScenes.$inferInsert;
export type ReelTemplate = typeof reelTemplates.$inferSelect;
export type ReelSeries = typeof reelSeries.$inferSelect;
export type NewReelSeries = typeof reelSeries.$inferInsert;
export type ReelSeriesEntry = typeof reelSeriesEntries.$inferSelect;
export type NewReelSeriesEntry = typeof reelSeriesEntries.$inferInsert;
