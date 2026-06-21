/**
 * Reels Orchestrator — drives the short-film pipeline.
 *
 * Modeled after `replicate-generator.ts` which polls + claims atomically.
 *
 * Pipeline (v2 with compliance gate):
 *   queued
 *     → directing                  (scene-director LLM — uses template scaffold)
 *     → compliance_check           (Kimi K2.5 gate, BEFORE media spend)
 *     → generating_keyframes       (parallel image gen via image-providers)
 *     → generating_video           (parallel image-to-video via video-providers)
 *     → stitching                  (FFmpeg concat + scale + optional caption burn)
 *     → posting                    (Zernio via AgentAugi sub-agent — async, not blocking)
 *     → complete | failed | needs_human_review
 *
 * The compliance check runs BEFORE any media spend so we don't burn $0.50+
 * on rejected scripts. For "safe" niches (tech, fashion, food, etc) the
 * template's complianceCheckPrompt is null and the gate auto-passes.
 *
 * Concurrency cap: REEL_CONCURRENCY env (default 8) — raised from 2 because
 * we now run 10 niches across multiple companies. Set higher if you have the
 * provider quota.
 *
 * Status transitions are atomic via Drizzle `update().where(status=oldStatus)`
 * to prevent double-processing across multiple gateway processes.
 */
import type { Db } from "@paperclipai/db";
import { reels, reelScenes } from "@paperclipai/db";
import { and, eq, inArray, asc } from "drizzle-orm";
import { directScenes } from "./scene-director.js";
import { runComplianceGate } from "./compliance-gate.js";
import { generateKeyframes } from "./keyframe-generator.js";
import { generateVideoClips } from "./video-clip-generator.js";
import { stitchReel } from "./stitcher.js";

// Default 8 (raised from 2). Caps per-process concurrent reels; tune via env.
const CONCURRENCY_CAP = parseInt(process.env.REEL_CONCURRENCY ?? "8", 10);

const IN_FLIGHT_STATUSES = [
  "directing",
  "compliance_check",
  "generating_keyframes",
  "generating_video",
  "stitching",
  "posting",
] as const;

let tickInFlight: Promise<void> | null = null;

/**
 * Public entrypoint called by the route after inserting a queued reel.
 * Fire-and-forget — actual work happens in the ticker.
 */
export async function enqueueReel(db: Db, _reelId: string): Promise<void> {
  // The reel is already in the DB with status='queued'. Kick the tick.
  await kickReelQueue(db);
}

/**
 * Run a single ticker iteration. Safe to call concurrently — serialised by
 * the in-flight promise guard.
 */
export async function kickReelQueue(db: Db): Promise<void> {
  if (tickInFlight) return tickInFlight;
  tickInFlight = runTick(db).finally(() => {
    tickInFlight = null;
  });
  return tickInFlight;
}

async function runTick(db: Db): Promise<void> {
  // 1. Advance in-flight reels through their state machine
  const inFlight = await db
    .select()
    .from(reels)
    .where(inArray(reels.status, [...IN_FLIGHT_STATUSES]));

  for (const reel of inFlight) {
    try {
      await advanceReel(db, reel.id);
    } catch (err) {
      console.error(`[reels-orchestrator] advance failed for ${reel.id}:`, err);
      await markFailed(db, reel.id, (err as Error).message);
    }
  }

  // 2. Pick up new queued reels up to the concurrency cap
  const stillInFlight = await db
    .select({ id: reels.id })
    .from(reels)
    .where(inArray(reels.status, [...IN_FLIGHT_STATUSES]));
  const slots = CONCURRENCY_CAP - stillInFlight.length;
  if (slots <= 0) return;

  const queued = await db
    .select()
    .from(reels)
    .where(eq(reels.status, "queued"))
    .orderBy(asc(reels.createdAt))
    .limit(slots);

  for (const reel of queued) {
    // Atomically claim queued → directing
    const claimed = await db
      .update(reels)
      .set({ status: "directing", startedAt: new Date() })
      .where(and(eq(reels.id, reel.id), eq(reels.status, "queued")))
      .returning({ id: reels.id });
    if (claimed.length === 0) continue; // another worker grabbed it
    try {
      await advanceReel(db, reel.id);
    } catch (err) {
      console.error(`[reels-orchestrator] initial advance failed for ${reel.id}:`, err);
      await markFailed(db, reel.id, (err as Error).message);
    }
  }
}

/**
 * Advance a single reel one step through the pipeline based on current status.
 * Each step transitions status when complete.
 */
async function advanceReel(db: Db, reelId: string): Promise<void> {
  const [reel] = await db.select().from(reels).where(eq(reels.id, reelId)).limit(1);
  if (!reel) return;

  switch (reel.status) {
    case "directing":
      await directScenes(db, reel);
      // Don't fall through to media spend — run compliance gate first.
      await db
        .update(reels)
        .set({ status: "compliance_check" })
        .where(eq(reels.id, reelId));
      return advanceReel(db, reelId);

    case "compliance_check": {
      // Load the scenes the director just generated, check against template's
      // banned-word list + LLM gate (Kimi K2.5). For "safe" niches without a
      // complianceCheckPrompt the gate auto-passes in <50ms.
      const scenes = await db
        .select()
        .from(reelScenes)
        .where(eq(reelScenes.reelId, reelId))
        .orderBy(asc(reelScenes.sceneIndex));
      const result = await runComplianceGate(db, reel, scenes);
      if (result.verdict === "PASS") {
        await db
          .update(reels)
          .set({ status: "generating_keyframes" })
          .where(eq(reels.id, reelId));
        return advanceReel(db, reelId);
      }
      // FAIL — flag for human review, do not spend on media gen.
      await db
        .update(reels)
        .set({
          status: "needs_human_review",
          errorMessage: `Compliance gate failed: ${result.reason ?? "no reason"}. Banned words hit: ${result.bannedWordHits.join(", ") || "none"}.`,
          completedAt: new Date(),
        })
        .where(eq(reels.id, reelId));
      return;
    }

    case "generating_keyframes": {
      const scenes = await db
        .select()
        .from(reelScenes)
        .where(eq(reelScenes.reelId, reelId));
      const done = await generateKeyframes(db, reel, scenes);
      if (done) {
        await db
          .update(reels)
          .set({ status: "generating_video" })
          .where(eq(reels.id, reelId));
      }
      return;
    }

    case "generating_video": {
      const scenes = await db
        .select()
        .from(reelScenes)
        .where(eq(reelScenes.reelId, reelId));
      const done = await generateVideoClips(db, reel, scenes);
      if (done) {
        await db
          .update(reels)
          .set({ status: "stitching" })
          .where(eq(reels.id, reelId));
      }
      return;
    }

    case "stitching": {
      const scenes = await db
        .select()
        .from(reelScenes)
        .where(eq(reelScenes.reelId, reelId))
        .orderBy(asc(reelScenes.sceneIndex));
      const result = await stitchReel(reel, scenes);
      await db
        .update(reels)
        .set({
          status: "complete",
          completedAt: new Date(),
          finalVideoUrl: result.url,
          finalVideoLocalPath: result.localPath,
          finalDurationSeconds: result.durationSeconds.toString(),
          totalCostUsd: result.totalCostUsd.toString(),
        })
        .where(eq(reels.id, reelId));
      return;
    }

    default:
      console.warn(
        `[reels-orchestrator] unexpected status ${reel.status} for reel ${reelId}`,
      );
  }
}

async function markFailed(db: Db, reelId: string, message: string): Promise<void> {
  await db
    .update(reels)
    .set({
      status: "failed",
      errorMessage: message.slice(0, 500),
      completedAt: new Date(),
    })
    .where(eq(reels.id, reelId));
}

/**
 * Start the periodic ticker. Call once at gateway boot. Matches the pattern
 * `startBackgroundTrainingPoller` uses elsewhere in the codebase.
 */
export function startReelOrchestrator(db: Db, intervalMs = 15_000): NodeJS.Timeout {
  const handle = setInterval(() => {
    kickReelQueue(db).catch((err) => {
      console.error("[reels-orchestrator] tick failed", err);
    });
  }, intervalMs);
  handle.unref();
  return handle;
}
