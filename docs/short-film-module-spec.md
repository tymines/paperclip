# Paperclip Short Film Module — Spec

**Status:** Draft v1 · 2026-06-07 · for Tyler review

**Goal:** add a viral-content video generation capability to Paperclip. Take a persona + a one-line idea → output a 15-60s vertical reel ready to post to Instagram Reels / TikTok / YouTube Shorts.

**Why:** Tyler's persona pipeline currently produces stills only. Video unlocks 10-100x engagement on social (algorithmic preference for video), deeper character development for personas, and a content velocity boost (one prompt → multi-scene reel). Reference points: Renoise (renoise.ai, "Three characters. Three personalities. One prompt") and AI Video (@appaivideo, 50K followers monetizing AI-generated viral shorts).

---

## 1. User flow (single page)

```
Persona dropdown:   [Raven ▼]
Idea (one line):    [Raven explores her new gothic apartment, finds a cursed mirror, smirks]
Style preset:       [Cinematic ▼]   Duration: [15s ▼]   Aspect: [9:16 vertical ▼]

[ Generate Reel ]   estimated cost ~$5
```

→ Backend runs the pipeline in ~3-5 minutes → output appears in the Reels Library tab with a preview player, the auto-generated scene breakdown (editable), and a Post / Save / Regenerate menu.

---

## 2. Pipeline (4 stages)

```
[ one-line idea + persona ]
            │
            ▼
┌─────────────────────────┐
│ 1. SCENE DIRECTOR (LLM) │   DeepSeek V4 Flash, ~$0.001
│  Breaks idea into 4-8   │
│  beats with shot specs  │
└─────────────────────────┘
            │
            ▼
┌─────────────────────────┐
│ 2. KEYFRAME GEN          │   WaveSpeed Klein + persona LoRA, ~$0.10 (4-8 × $0.015)
│  Generate still for     │   OR self-hosted Klein for explicit personas
│  each scene with        │
│  consistent character   │
└─────────────────────────┘
            │
            ▼
┌─────────────────────────┐
│ 3. IMAGE-TO-VIDEO       │   Seedance 2.0 via Atlas (your prepaid credit) ~$2-4
│  Each keyframe → 3-5s   │   OR WAN 2.1 / Kling 2.0 as alternatives
│  video clip             │
└─────────────────────────┘
            │
            ▼
┌─────────────────────────┐
│ 4. STITCH + AUDIO       │   FFmpeg locally (free) + Suno API for music ~$0.50
│  Concatenate clips,     │
│  add music, captions,   │
│  export 9:16 1080×1920  │
└─────────────────────────┘
            │
            ▼
   [ saved reel.mp4 ]
```

**Cost per 15s reel: ~$3-5** at WaveSpeed image gen. **~$5-10 for a 30s reel** with self-hosted explicit Klein.

**Stage timing:**
- Scene director: ~5s
- 6 keyframes: ~60s
- 6 video clips × 30s gen each: ~3 min (most expensive in wall time)
- Stitch + audio: ~30s
- **Total: ~5 min end-to-end**

---

## 3. Sidebar integration

Add new tab to Paperclip's sidebar between **Image Studio** and **Library**:

| Existing Primary 6 | Insert here | Existing MORE 12 |
|---|---|---|
| Inbox, Dashboard, Personas, Image Studio, **REELS** ← new, Library | (between Image Studio and Library) | (Skills, Costs, Activity, etc. — unchanged) |

Icon suggestion: filmstrip or play-button overlaid on a portrait frame.

Page structure:
- **Reels Library** (default view): grid of generated reels with thumbnail + duration + engagement stats
- **New Reel** (CTA button top-right): the single-page user flow above
- **Templates** (sub-tab): saved style presets and scene patterns (e.g., "Day in the Life", "Get Ready With Me", "Cursed Object")
- **Series** (sub-tab): multi-reel narratives where character continuity matters

---

## 4. Database schema

Add four tables to `@paperclipai/db`:

```ts
// packages/db/src/schema/reels.ts

export const reels = pgTable("reels", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  personaId: uuid("persona_id").notNull().references(() => personaGroups.id),
  title: text("title"),
  prompt: text("prompt").notNull(),
  stylePreset: text("style_preset"),         // cinematic | viral_meme | day_in_life | ...
  durationSeconds: integer("duration_seconds").notNull(),
  aspectRatio: text("aspect_ratio").notNull(),  // "9:16" | "16:9" | "1:1"
  status: text("status").notNull(),          // queued | directing | generating_keyframes | generating_video | stitching | complete | failed
  finalVideoUrl: text("final_video_url"),
  thumbnailUrl: text("thumbnail_url"),
  totalCost: numeric("total_cost", { precision: 10, scale: 4 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  errorMessage: text("error_message"),
});

export const reelScenes = pgTable("reel_scenes", {
  id: uuid("id").primaryKey().defaultRandom(),
  reelId: uuid("reel_id").notNull().references(() => reels.id, { onDelete: "cascade" }),
  sceneIndex: integer("scene_index").notNull(),
  description: text("description").notNull(),       // LLM's shot description
  cameraFraming: text("camera_framing"),            // "wide" | "medium" | "close-up" | "POV"
  emotion: text("emotion"),
  durationSeconds: numeric("duration_seconds", { precision: 4, scale: 2 }),
  keyframePrompt: text("keyframe_prompt").notNull(),
  keyframeImageUrl: text("keyframe_image_url"),
  videoClipUrl: text("video_clip_url"),
  status: text("status").notNull(),                 // pending | keyframe_ready | video_ready | failed
});

export const reelTemplates = pgTable("reel_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").references(() => companies.id),  // null = global preset
  name: text("name").notNull(),
  stylePreset: text("style_preset").notNull(),
  promptScaffold: text("prompt_scaffold").notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  aspectRatio: text("aspect_ratio").notNull(),
  defaultMusicMood: text("default_music_mood"),
});

export const reelSeries = pgTable("reel_series", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  personaId: uuid("persona_id").notNull().references(() => personaGroups.id),
  title: text("title").notNull(),
  narrativeArc: text("narrative_arc"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Many-to-many: reels in series with ordering
export const reelSeriesEntries = pgTable("reel_series_entries", {
  seriesId: uuid("series_id").notNull().references(() => reelSeries.id, { onDelete: "cascade" }),
  reelId: uuid("reel_id").notNull().references(() => reels.id, { onDelete: "cascade" }),
  episodeIndex: integer("episode_index").notNull(),
  pk: primaryKey({ columns: [t.seriesId, t.reelId] }),
});
```

---

## 5. API contract

New routes under `server/src/routes/reels.ts`:

```
POST   /api/companies/:cid/reels
       Body: { personaId, prompt, stylePreset?, durationSeconds?, aspectRatio? }
       Returns: { reelId, status: "queued" }
       Side effect: enqueues reel job, ticker picks it up

GET    /api/companies/:cid/reels
       Query: ?personaId, ?status, ?limit, ?cursor
       Returns: paginated list of reels

GET    /api/companies/:cid/reels/:reelId
       Returns: reel + scenes + cost breakdown

PATCH  /api/companies/:cid/reels/:reelId
       Body: { title?, sceneEdits? }  // allow editing scene prompts before video gen
       Returns: updated reel

POST   /api/companies/:cid/reels/:reelId/regenerate-scene/:sceneIdx
       Regenerates a single scene's keyframe + video without redoing the whole reel

POST   /api/companies/:cid/reels/:reelId/post
       Body: { platforms: ["instagram"|"tiktok"|"youtube_shorts"], caption?, scheduleAt? }
       Hooks into existing Paperclip distribution layer

GET    /api/companies/:cid/reel-templates
POST   /api/companies/:cid/reel-templates

POST   /api/companies/:cid/reel-series
GET    /api/companies/:cid/reel-series
GET    /api/companies/:cid/reel-series/:seriesId
POST   /api/companies/:cid/reel-series/:seriesId/episodes
```

---

## 6. Service layer

New services under `server/src/services/reels/`:

```
reels/
├── scene-director.ts         // LLM call to break prompt into scene specs
├── keyframe-generator.ts     // Reuses image-providers/ for image gen
├── video-providers/          // NEW: parallel to image-providers/ pattern
│   ├── index.ts              //   provider registry
│   ├── seedance.ts           //   Atlas-hosted Seedance 2.0
│   ├── wan.ts                //   WAN 2.1 (alternative)
│   ├── kling.ts              //   Kling 2.0 (alternative)
│   └── types.ts
├── stitcher.ts               // FFmpeg wrapper, runs in worker
├── music-generator.ts        // Suno API or fal.ai music gen
├── reel-orchestrator.ts      // ties it all together as a job
└── reel-cost-tracker.ts      // aggregates costs across providers per reel
```

### Pipeline ticker (analogous to `replicate-generator.ts`)

Modeled on your existing `replicate-generator.ts`:
- Polls `reels` table for `status: queued`
- Claims atomic transition queued → directing
- Runs scene-director → updates to `generating_keyframes`
- Fires keyframes in parallel via image-providers
- On all keyframes ready → fires video clips in parallel via video-providers
- On all clips ready → stitcher runs locally, saves final mp4
- Updates `status: complete` + `finalVideoUrl`

Concurrency cap: `REEL_CONCURRENCY=2` (heavy on GPU credits, want to limit).

---

## 7. Video providers (new abstraction layer)

Mirror the existing `image-providers/` pattern. Each provider implements:

```ts
export interface VideoProvider {
  isConfigured(): Promise<boolean>;
  submit(input: VideoGenInput): Promise<{ jobId: string; estimatedCost: number }>;
  poll(jobId: string): Promise<VideoGenStatus>;
  costPerSecond: number;
}

export type VideoGenInput = {
  imageUrl: string;        // keyframe to animate
  durationSeconds: number; // 3-5 typical
  motionPrompt?: string;   // "subject turns toward camera, smiles"
  aspectRatio: "9:16" | "16:9" | "1:1";
  seed?: number;
};
```

**Initial providers to wire:**

| Provider | Model | Cost | Why |
|---|---|---|---|
| **Atlas Cloud** | `seedance-v1.5-pro-spicy` (Augi's earlier catalog research confirmed it exists) | ~$0.50/clip | Burns Tyler's prepaid Atlas credit, no NSFW filter on "spicy" variant |
| **WaveSpeed** | `wavespeed-ai/wan-2.1-i2v-720p` | ~$0.40/clip | Use WaveSpeed credit, SFW only |
| **fal.ai** | Multiple options | $0.50-1.00/clip | Skip for now per content policy concerns |
| **RunPod self-hosted** | WAN 2.1 or Kling open weights | $0.10-0.20/clip | Future cost-saver once volume justifies |

Default for SFW reels: Atlas Seedance. Default for explicit-persona reels: Atlas spicy variant or RunPod self-hosted (once Phase 5 of the RunPod runbook is done).

---

## 8. Scene Director prompt template

The LLM (DeepSeek V4 Flash via existing OpenClaw bridge — fast and cheap) gets:

```
You are a viral short-film director. Take a one-line idea and a persona profile,
break it into 4-8 cinematic beats for a {duration}s vertical reel.

PERSONA:
{persona_brand_voice}
{persona_visual_anchor}    e.g. "jet black hair, pale skin, choker, gothic aesthetic"
{persona_camera_lean}      e.g. "moody, low-light, intimate framing"

IDEA: {user_one_line_idea}

STYLE PRESET: {style_preset}   # cinematic | viral_meme | day_in_life | thirst_trap | story_arc

CONSTRAINTS:
- Total duration must sum to {duration}s ± 2s
- Each beat is 2-5 seconds
- Specify camera framing (wide / medium / close-up / POV)
- Specify character emotion per beat
- Write a self-contained keyframe prompt for each beat that an image model can render
  (include persona visual anchor every time so character stays consistent)
- Optionally describe motion within the beat for the video model

Output JSON ONLY:
{
  "title": "<3-5 word reel title>",
  "scenes": [
    {
      "index": 1,
      "description": "<brief beat description>",
      "camera_framing": "wide",
      "emotion": "curious",
      "duration_seconds": 3.0,
      "keyframe_prompt": "<full image prompt with persona anchor>",
      "motion_hint": "<what changes during the 3s clip>"
    },
    ...
  ],
  "music_mood": "<e.g. 'dark synthwave', 'lo-fi melancholic'>",
  "estimated_cost_usd": <number>
}
```

This gives the user something to review BEFORE expensive video gen kicks off. UI shows scene breakdown with edit affordances.

---

## 9. Stitcher (FFmpeg, runs in worker)

Self-contained Node service wrapping FFmpeg. Inputs: list of clip URLs + music URL + duration map. Output: single mp4.

```typescript
// services/reels/stitcher.ts
import { execFile } from "node:child_process";

export async function stitchReel(input: {
  clips: Array<{ url: string; duration: number }>;
  musicUrl?: string;
  outputPath: string;
  width: number;
  height: number;
}): Promise<{ path: string; durationSeconds: number }> {
  // 1. Download clips + music to tmpdir
  // 2. Build FFmpeg filter graph: concat + scale to 1080x1920 + audio mix
  // 3. Execute ffmpeg -i ... output.mp4
  // 4. Return final path + duration
}
```

Runs in a separate worker process (heavy CPU). Job queue picks it up after all video clips are ready.

---

## 10. UI components

New components under `web/src/components/reels/`:

- `ReelLibraryGrid.tsx` — card layout, thumbnails, status badges, regenerate/post/delete menu
- `NewReelForm.tsx` — single-page form (persona / idea / preset / duration / aspect)
- `ReelGeneratorStatus.tsx` — live progress UI showing each pipeline stage
- `SceneEditor.tsx` — table of scene breakdowns with inline-editable prompts
- `ReelPreviewPlayer.tsx` — 9:16 video player with play/pause + scene timeline scrubber
- `PostReelDialog.tsx` — caption editor, platform pickers, schedule timer
- `TemplateLibrary.tsx` — saved style presets, fork-to-edit pattern

---

## 11. Phased rollout

**Phase 1 — MVP CLI (1-2 days)** ← start here
Build `make_raven_reel.py` script first. Hardcode persona = Raven, single style preset. Atlas Seedance for video gen. FFmpeg local stitch. Output 15s reel. **Prove the pipeline end-to-end before any UI work.**

**Phase 2 — Backend services (3-5 days)**
Build the reels DB schema + service layer + ticker + video-providers abstraction. Expose API. Reels are creatable via curl/Postman only, no UI yet.

**Phase 3 — Minimal UI (3-5 days)**
Wire `NewReelForm` + `ReelLibraryGrid` + status polling. Skip Templates and Series for now. Tyler can generate + view reels in Paperclip web.

**Phase 4 — Polish + post (3-5 days)**
Scene editing UI, post-to-platform integration via existing distribution layer, music mood picker, regenerate-single-scene.

**Phase 5 — Templates + Series (2-3 days)**
Saved presets, multi-episode narratives with character continuity tracking.

**Total: ~3 weeks for full module.** MVP Phase 1 is ~1-2 days and proves the concept before any commitment.

---

## 12. Open questions for Tyler

1. **Music**: Suno API ($0.50/track, high quality) vs. fal.ai music gen ($0.10/track, lower quality) vs. licensed library (Epidemic Sound subscription you may already pay for)?
2. **Posting**: integrate with your existing Paperclip distribution flow, OR build a separate posting queue for reels with platform-specific formatting (TikTok prefers different caption style than IG)?
3. **Persona series**: do you want narrative continuity (Raven's "Day 3 of cursed apartment") tracked as a structured arc, or just freeform per-reel?
4. **NSFW reel platform routing**: most reels go to IG/TikTok/Shorts (SFW). Explicit-persona reels go to OnlyFans / Fanvue / private channels. The UI should default to safe platforms and require a "spicy" toggle to even SURFACE explicit posting options. Confirm that's the right policy.
5. **Cost ceiling per reel**: cap auto-generation at $X to prevent runaway? Suggest $10/reel as default ceiling, configurable per persona.

---

## 13. Risks

1. **Video gen is slow** (~30s per 5s clip on Seedance). A 30s reel = 6 clips = 3 min of GPU time. Concurrency cap matters.
2. **Character consistency across video clips** is harder than across stills. Each Seedance/WAN/Kling render reinterprets the character slightly. Mitigations: identity LoRA in keyframe gen (you'll have Raven-Klein soon), strong "motion_hint" prompts that minimize face/body interpretation drift, accept that there'll be a "feel" not "frame-perfect identity".
3. **Music licensing** if posting commercially: Suno's commercial license requires their paid tier. Worth checking before launch.
4. **Aspect ratio mismatch**: 9:16 keyframe gen on Flux 2 Klein isn't native (1024×1024 default). Need to render at 768×1344 or upscale 9:16-crop a 1024×1024 with attention to faces not getting cropped. Test early.
5. **Sora-like quality is not there yet** with current open i2v models. WAN 2.1, Kling 2.0, Seedance are all good but not Hollywood. Set expectations: this is for viral social content, not film. AI Video at 50K followers is the benchmark, not Pixar.

---

## 14. Why this is the right next bet for Paperclip

- **Image is solved**: you have the persona pipeline working (v19 hit 6/10 on Replicate, WaveSpeed Klein delivering at scale, Raven-Klein LoRA training in flight, RunPod self-host planned)
- **Video is the next 10x in engagement** on every major social platform's algorithm
- **Existing infra reuse**: persona DB, image-providers abstraction, distribution layer, cost tracking are all in place — you're adding a sibling pipeline, not a parallel platform
- **Market validation**: @appaivideo at 50K followers + Renoise as paid product prove people will pay for / engage with this
- **First-mover within your persona business**: Tyler's 5-persona roster is exactly the right scale for one operator to manage video output across (vs. trying to do this with a stable of human-shot influencers, which doesn't scale)

---

## Next step

Approve this spec or push back on specific sections. Once approved, I can:
- Start with the `make_raven_reel.py` MVP script (Phase 1, 1-2 days)
- OR scaffold the DB schema + service layer first (Phase 2) if you'd rather build foundation first
- OR write a detailed Plan doc for an external dev to take this on if you want to delegate the build
