/**
 * Social scheduler worker.
 *
 * Polls `social_posts` for rows that have come due (status='scheduled' AND
 * scheduled_at <= NOW()), claims them with FOR UPDATE SKIP LOCKED so multiple
 * server processes don't double-publish, then publishes each row's targets
 * via the per-platform adapter.publishPost().
 *
 * Per-target retry/backoff lives on `social_post_targets`
 * (attempt_count, next_attempt_at, claimed_at, idempotency_key). The worker
 * gives each target up to MAX_ATTEMPTS tries with exponential backoff. The
 * parent post is rolled up to `published` / `failed` / `partial_failed`
 * once every target has reached a terminal state.
 *
 * Data honesty: when an adapter throws `BlockedNoCredentialError` (account
 * has no real token / platform credential), the target is marked `blocked`
 * — terminal, NO retries or backoff — with errorMessage prefixed
 * `blocked_no_credential: `. Retrying a call that can never succeed would
 * only burn attempts; `fireNow` (the explicit admin bypass) resets blocked
 * targets so a re-connect + fire-now re-attempts them.
 *
 * Diagnostics (lastTickAt, postsProcessedLast5min, lastError) are exposed
 * via getDiagnostics() and surfaced through `GET /api/social/scheduler/health`.
 * `fireNow(postId)` is the admin-bypass path used by the test endpoint.
 */
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { socialAccounts, socialPosts, socialPostTargets } from "@paperclipai/db";
import type { SocialAccount, SocialPlatform } from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";
import {
  BlockedNoCredentialError,
  ensureFreshToken,
  getSocialAdapter,
  type PostDraftPayload,
} from "../services/social-scheduler/index.js";

const DEFAULT_TICK_INTERVAL_MS = 30_000;
const DEFAULT_BATCH_SIZE = 10;
const MAX_ATTEMPTS = 3;
// 1 min → 5 min → 15 min
const BACKOFF_SCHEDULE_MS = [60_000, 5 * 60_000, 15 * 60_000];

export interface SocialSchedulerOptions {
  db: Db;
  tickIntervalMs?: number;
  batchSize?: number;
}

export interface SocialSchedulerDiagnostics {
  running: boolean;
  startedAt: Date | null;
  lastTickAt: Date | null;
  lastTickDurationMs: number | null;
  tickCount: number;
  postsProcessedLast5min: number;
  lastError: { at: Date; message: string } | null;
  inFlightPostIds: string[];
}

interface ProcessedRecord {
  at: number;
}

export interface SocialScheduler {
  start(): void;
  stop(): void;
  tickOnce(): Promise<{ claimed: number; published: number; failed: number }>;
  fireNow(postId: string): Promise<{ ok: boolean; published: number; failed: number; reason?: string }>;
  getDiagnostics(): SocialSchedulerDiagnostics;
}

export function createSocialScheduler(opts: SocialSchedulerOptions): SocialScheduler {
  const db = opts.db;
  const tickIntervalMs = Math.max(5_000, opts.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS);
  const batchSize = Math.max(1, Math.min(100, opts.batchSize ?? DEFAULT_BATCH_SIZE));
  const log = logger.child({ worker: "social-scheduler" });

  let timer: NodeJS.Timeout | null = null;
  let ticking = false;
  let startedAt: Date | null = null;
  let lastTickAt: Date | null = null;
  let lastTickDurationMs: number | null = null;
  let tickCount = 0;
  let lastError: { at: Date; message: string } | null = null;
  const inFlight = new Set<string>();
  const processed: ProcessedRecord[] = [];

  function recordProcessed(n: number) {
    const now = Date.now();
    for (let i = 0; i < n; i += 1) processed.push({ at: now });
    const cutoff = now - 5 * 60_000;
    while (processed.length > 0 && processed[0].at < cutoff) processed.shift();
  }

  function start() {
    if (timer) return;
    startedAt = new Date();
    log.info({ tickIntervalMs, batchSize }, "social scheduler starting");
    // Kick a tick immediately so a freshly-due post doesn't have to wait
    // tickIntervalMs after server boot.
    void runTick().catch((err) => log.error({ err }, "initial tick failed"));
    timer = setInterval(() => {
      void runTick().catch((err) => log.error({ err }, "tick failed"));
    }, tickIntervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    log.info("social scheduler stopped");
  }

  async function runTick(): Promise<{ claimed: number; published: number; failed: number }> {
    if (ticking) return { claimed: 0, published: 0, failed: 0 };
    ticking = true;
    const start = Date.now();
    try {
      tickCount += 1;
      const result = await tickInternal();
      lastTickAt = new Date();
      lastTickDurationMs = Date.now() - start;
      if (result.claimed > 0) {
        log.info(result, "tick processed due posts");
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastError = { at: new Date(), message };
      log.error({ err }, "tick error");
      throw err;
    } finally {
      ticking = false;
    }
  }

  /**
   * Claim up to batchSize due posts atomically, then publish each one's
   * targets. Uses FOR UPDATE SKIP LOCKED so two replicas (or a fire-now and
   * a periodic tick) never see the same row.
   */
  async function tickInternal() {
    const claimedPostIds = await claimDuePosts(batchSize);
    let published = 0;
    let failed = 0;
    for (const postId of claimedPostIds) {
      inFlight.add(postId);
      try {
        const outcome = await publishPostTargets(postId);
        published += outcome.published;
        failed += outcome.failed;
        recordProcessed(outcome.published + outcome.failed);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ err, postId }, "publishPostTargets crashed");
        lastError = { at: new Date(), message };
        await markPostFailed(postId, message);
      } finally {
        inFlight.delete(postId);
      }
    }
    return { claimed: claimedPostIds.length, published, failed };
  }

  /**
   * Atomically pick up to `limit` posts that have come due and flip them to
   * `publishing` so a concurrent ticker skips them. Targets stay `scheduled`
   * until publishPostTargets() claims each one individually.
   *
   * Uses `NOW()` rather than binding a JS Date because postgres.js's prepared-
   * statement bind path doesn't accept Date for raw `sql` templates — and the
   * DB clock is the right authority for "is this row due" anyway.
   */
  async function claimDuePosts(limit: number): Promise<string[]> {
    const rows = await db.execute(sql<{ id: string }>`
      WITH due AS (
        SELECT id
        FROM social_posts
        WHERE status = 'scheduled'
          AND scheduled_at IS NOT NULL
          AND scheduled_at <= NOW()
        ORDER BY scheduled_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE social_posts
      SET status = 'publishing', updated_at = NOW()
      WHERE id IN (SELECT id FROM due)
      RETURNING id
    `);
    return extractIds(rows);
  }

  async function publishPostTargets(postId: string): Promise<{ published: number; failed: number }> {
    const postRow = await db
      .select()
      .from(socialPosts)
      .where(eq(socialPosts.id, postId))
      .then((rows) => rows[0] ?? null);
    if (!postRow) return { published: 0, failed: 0 };

    // Pick up any target that is still actionable: never attempted (scheduled
    // or draft) or eligible for retry (failed with attempts left and the
    // backoff window has elapsed).
    const targets = await db
      .select()
      .from(socialPostTargets)
      .where(
        and(
          eq(socialPostTargets.postId, postId),
          or(
            eq(socialPostTargets.status, "scheduled"),
            eq(socialPostTargets.status, "draft"),
            and(
              eq(socialPostTargets.status, "failed"),
              lte(socialPostTargets.attemptCount, MAX_ATTEMPTS - 1),
              or(
                isNull(socialPostTargets.nextAttemptAt),
                lte(socialPostTargets.nextAttemptAt, new Date()),
              ),
            ),
          ),
        ),
      );

    let published = 0;
    let failed = 0;
    for (const target of targets) {
      const outcome = await publishOneTarget(postRow, target);
      if (outcome === "published") published += 1;
      else if (outcome === "failed") failed += 1;
    }

    await rollupParentStatus(postId);
    return { published, failed };
  }

  /**
   * @returns "published" on success, "failed" on terminal failure,
   *          "retry" when we set up the next backoff window.
   */
  async function publishOneTarget(
    post: typeof socialPosts.$inferSelect,
    target: typeof socialPostTargets.$inferSelect,
  ): Promise<"published" | "failed" | "retry"> {
    const attempt = (target.attemptCount ?? 0) + 1;
    const idempotencyKey = `${post.id}:${target.id}:${attempt}`;

    // Claim the target row so a concurrent fire-now doesn't re-fire it.
    await db
      .update(socialPostTargets)
      .set({
        status: "publishing",
        claimedAt: new Date(),
        attemptCount: attempt,
        idempotencyKey,
        updatedAt: new Date(),
      })
      .where(eq(socialPostTargets.id, target.id));

    const account = await db
      .select()
      .from(socialAccounts)
      .where(eq(socialAccounts.id, target.accountId))
      .then((rows) => rows[0] ?? null);
    if (!account) {
      return failTarget(target.id, attempt, "social_account row missing");
    }

    const platform = account.platform as SocialPlatform;
    const adapter = getSocialAdapter(platform);
    if (!adapter) {
      return failTarget(target.id, attempt, `no adapter for platform ${platform}`, /*terminal=*/ true);
    }

    let working: SocialAccount;
    try {
      working = (await ensureFreshToken(db, account as unknown as SocialAccount)) ?? (account as unknown as SocialAccount);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return failTarget(target.id, attempt, `token refresh failed: ${message}`);
    }

    const draft: PostDraftPayload = {
      baseCaption: post.content,
      postType: post.postType as PostDraftPayload["postType"],
      mediaUrls: Array.isArray(post.mediaUrls) ? (post.mediaUrls as string[]) : [],
      metadata: (post.metadata ?? undefined) as Record<string, unknown> | undefined,
    };

    try {
      const result = await adapter.publishPost(working, draft);
      await db
        .update(socialPostTargets)
        .set({
          status: "published",
          platformPostId: result.platformPostId,
          platformUrl: result.platformUrl ?? null,
          publishedAt: result.publishedAt ?? new Date(),
          errorMessage: null,
          nextAttemptAt: null,
          updatedAt: new Date(),
        })
        .where(eq(socialPostTargets.id, target.id));
      log.info(
        { postId: post.id, targetId: target.id, platform, attempt },
        "published social post target",
      );
      return "published";
    } catch (err) {
      if (err instanceof BlockedNoCredentialError) {
        return blockTarget(target.id, err.message);
      }
      const message = err instanceof Error ? err.message : String(err);
      return failTarget(target.id, attempt, message);
    }
  }

  /**
   * Terminal no-credential state — the adapter refused to publish because
   * the account has no real token. No retries/backoff: the call can never
   * succeed until Tyler reconnects the account, at which point `fireNow`
   * resets the target back to `scheduled`.
   */
  async function blockTarget(targetId: string, message: string): Promise<"failed"> {
    await db
      .update(socialPostTargets)
      .set({
        status: "blocked",
        errorMessage: `blocked_no_credential: ${message}`.slice(0, 1000),
        nextAttemptAt: null,
        updatedAt: new Date(),
      })
      .where(eq(socialPostTargets.id, targetId));
    log.warn({ targetId, message }, "social post target blocked (no credential)");
    return "failed";
  }

  async function failTarget(
    targetId: string,
    attempt: number,
    message: string,
    terminalOverride = false,
  ): Promise<"failed" | "retry"> {
    const exhausted = terminalOverride || attempt >= MAX_ATTEMPTS;
    const nextAttemptAt = exhausted
      ? null
      : new Date(Date.now() + (BACKOFF_SCHEDULE_MS[attempt - 1] ?? BACKOFF_SCHEDULE_MS[BACKOFF_SCHEDULE_MS.length - 1]));
    await db
      .update(socialPostTargets)
      .set({
        status: "failed",
        errorMessage: message.slice(0, 1000),
        nextAttemptAt,
        updatedAt: new Date(),
      })
      .where(eq(socialPostTargets.id, targetId));
    log.warn(
      { targetId, attempt, exhausted, nextAttemptAt, message },
      "social post target failed",
    );
    return exhausted ? "failed" : "retry";
  }

  /**
   * After all targets for a post have hit a terminal state (published,
   * blocked, or failed with no retries left), roll the parent row up to the
   * right final status. If any target is still in `publishing` or `failed`-
   * with-retries-left, leave the post in `publishing` so the next tick
   * re-enters. `blocked` is terminal: a post with blocked targets and no
   * successes rolls up to `failed`; blocked alongside successes rolls up to
   * `partial_failed`.
   */
  async function rollupParentStatus(postId: string) {
    const targets = await db
      .select({ status: socialPostTargets.status, attemptCount: socialPostTargets.attemptCount })
      .from(socialPostTargets)
      .where(eq(socialPostTargets.postId, postId));
    if (targets.length === 0) {
      await db
        .update(socialPosts)
        .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
        .where(eq(socialPosts.id, postId));
      return;
    }
    const stillPending = targets.some(
      (t) =>
        t.status === "publishing" ||
        t.status === "scheduled" ||
        (t.status === "failed" && (t.attemptCount ?? 0) < MAX_ATTEMPTS),
    );
    if (stillPending) return;

    const allPublished = targets.every((t) => t.status === "published");
    const anyPublished = targets.some((t) => t.status === "published");
    const finalStatus = allPublished ? "published" : anyPublished ? "partial_failed" : "failed";
    await db
      .update(socialPosts)
      .set({
        status: finalStatus,
        publishedAt: allPublished ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(socialPosts.id, postId));
    log.info({ postId, finalStatus }, "social post rolled up");
  }

  async function markPostFailed(postId: string, message: string) {
    try {
      await db
        .update(socialPosts)
        .set({
          status: "failed",
          metadata: sql`jsonb_set(coalesce(metadata, '{}'::jsonb), '{lastError}', ${JSON.stringify(message.slice(0, 1000))}::jsonb)`,
          updatedAt: new Date(),
        })
        .where(eq(socialPosts.id, postId));
    } catch (err) {
      log.error({ err, postId }, "failed to mark post as failed");
    }
  }

  /**
   * Admin/test bypass — claim a single post regardless of scheduled_at and
   * try to publish it now. Useful for the
   * `POST /api/social/scheduler/fire-now/:postId` endpoint.
   */
  async function fireNow(postId: string) {
    const rows = await db.execute(sql<{ id: string; status: string }>`
      UPDATE social_posts
      SET status = 'publishing', updated_at = NOW()
      WHERE id = ${postId}
        AND status IN ('scheduled', 'draft', 'failed', 'publishing', 'partial_failed')
      RETURNING id, status
    `);
    const claimed = extractIds(rows);
    if (claimed.length === 0) {
      return { ok: false, published: 0, failed: 0, reason: "post not found or already in terminal state" };
    }
    inFlight.add(postId);
    try {
      // Reset any failed targets so fireNow re-attempts them immediately.
      await db
        .update(socialPostTargets)
        .set({ nextAttemptAt: new Date(0), updatedAt: new Date() })
        .where(eq(socialPostTargets.postId, postId));
      // Blocked targets are terminal for the periodic ticker, but fireNow
      // is the explicit admin bypass — reset them to `scheduled` so a
      // freshly-reconnected account gets a clean attempt budget.
      await db
        .update(socialPostTargets)
        .set({
          status: "scheduled",
          attemptCount: 0,
          errorMessage: null,
          nextAttemptAt: new Date(0),
          updatedAt: new Date(),
        })
        .where(
          and(eq(socialPostTargets.postId, postId), eq(socialPostTargets.status, "blocked")),
        );
      const result = await publishPostTargets(postId);
      recordProcessed(result.published + result.failed);
      return { ok: true, published: result.published, failed: result.failed };
    } finally {
      inFlight.delete(postId);
    }
  }

  function getDiagnostics(): SocialSchedulerDiagnostics {
    return {
      running: timer !== null,
      startedAt,
      lastTickAt,
      lastTickDurationMs,
      tickCount,
      postsProcessedLast5min: processed.length,
      lastError,
      inFlightPostIds: [...inFlight],
    };
  }

  return { start, stop, tickOnce: runTick, fireNow, getDiagnostics };
}

/**
 * `db.execute()` returns a driver-specific row shape (object-of-arrays for
 * node-postgres, array-of-objects for some others). Walk both shapes.
 */
function extractIds(result: unknown): string[] {
  if (Array.isArray(result)) {
    return result.map((row) => (row as { id?: string })?.id).filter((id): id is string => typeof id === "string");
  }
  const maybeRows = (result as { rows?: unknown })?.rows;
  if (Array.isArray(maybeRows)) {
    return maybeRows
      .map((row) => (row as { id?: string })?.id)
      .filter((id): id is string => typeof id === "string");
  }
  return [];
}
