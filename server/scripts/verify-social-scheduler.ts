/**
 * Smoke test for the social scheduler worker.
 *
 * Inserts a scheduled-now social_post for Tyler Co / Twitter, runs the
 * scheduler's tickOnce() against the live embedded Postgres, then reports
 * the resulting target status + diagnostics. Cleans up the test rows.
 *
 * Run from /Users/augi/paperclip:
 *   pnpm --filter @paperclipai/server exec tsx scripts/verify-social-scheduler.ts
 */
import { createDb, socialPosts, socialPostTargets } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { createSocialScheduler } from "../src/workers/social-scheduler.js";

const DATABASE_URL = "postgresql://paperclip:paperclip@localhost:54329/paperclip";
const TYLER_CO = "414c172d-7013-4728-b781-aad604d8e2d7";
const TWITTER_ACCOUNT = "3bc80e0b-8e14-4df7-a3ad-48ad8201ac06";

async function main() {
  const db = createDb(DATABASE_URL);
  const scheduler = createSocialScheduler({ db });

  console.log("[verify] inserting test scheduled post for Tyler Co / Twitter");
  const [post] = await db
    .insert(socialPosts)
    .values({
      companyId: TYLER_CO,
      title: "scheduler-verify",
      content: "scheduler verify @ " + new Date().toISOString(),
      postType: "text",
      status: "scheduled",
      scheduledAt: new Date(Date.now() - 5_000),
      mediaUrls: [],
      tags: [],
      metadata: { source: "verify-social-scheduler" },
      createdBy: "verify-script",
    })
    .returning();

  await db.insert(socialPostTargets).values({
    postId: post.id,
    accountId: TWITTER_ACCOUNT,
    platform: "twitter",
    status: "scheduled",
  });

  console.log("[verify] post id =", post.id);
  console.log("[verify] initial diagnostics =", scheduler.getDiagnostics());

  console.log("[verify] running scheduler.tickOnce()");
  const result = await scheduler.tickOnce();
  console.log("[verify] tickOnce result =", result);

  const finalPost = await db.select().from(socialPosts).where(eq(socialPosts.id, post.id)).then((r) => r[0]);
  const targets = await db.select().from(socialPostTargets).where(eq(socialPostTargets.postId, post.id));
  console.log("[verify] final post status =", finalPost?.status);
  console.log(
    "[verify] final targets =",
    targets.map((t) => ({
      id: t.id,
      status: t.status,
      attemptCount: t.attemptCount,
      nextAttemptAt: t.nextAttemptAt,
      errorMessage: t.errorMessage,
      idempotencyKey: t.idempotencyKey,
    })),
  );
  console.log("[verify] post-tick diagnostics =", scheduler.getDiagnostics());

  console.log("[verify] cleaning up test rows");
  await db.delete(socialPostTargets).where(eq(socialPostTargets.postId, post.id));
  await db.delete(socialPosts).where(eq(socialPosts.id, post.id));

  scheduler.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error("[verify] FAILED:", err);
  process.exit(1);
});
