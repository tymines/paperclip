/**
 * Smoke test for the X DM poller worker.
 *
 * Stubs X's /2/dm_events response with a small fixture (one regular DM,
 * one verified-sender DM, one with the "collab" hot keyword) and confirms:
 *
 *   - inbound rows land in social_dms with the expected first-contact /
 *     verified / keyword flags
 *   - jarvis_alerts get a row for each "interesting" inbound DM
 *   - the (platform, message_id) unique index prevents duplicate inserts
 *     when the same payload comes through on the next tick
 *   - the account's metadata.x.dmsSinceId cursor advances
 *
 * Run from /Users/augi/paperclip:
 *   pnpm --filter @paperclipai/server exec tsx scripts/verify-social-dm-poller.ts
 */
import { createDb, socialAccounts, socialDms, jarvisAlerts } from "@paperclipai/db";
import { and, desc, eq } from "drizzle-orm";
import { createSocialDmPoller } from "../src/workers/social-dm-poller.js";

const DATABASE_URL = "postgresql://paperclip:paperclip@localhost:54329/paperclip";
const X_ACCOUNT = "3bc80e0b-8e14-4df7-a3ad-48ad8201ac06";

const FAKE_USERS = {
  "u-sidney": { id: "u-sidney", username: "sidneyfan42", name: "Sidney Fan", verified: false },
  "u-newsdesk": { id: "u-newsdesk", username: "newsdesk", name: "Newsdesk", verified: true },
  "u-brand": { id: "u-brand", username: "brandmgr", name: "Brand Manager", verified: false },
};

const FIRST_PAGE = {
  data: [
    {
      id: "1900000000000000001",
      event_type: "MessageCreate",
      text: "hey, big fan!",
      created_at: new Date(Date.now() - 60_000).toISOString(),
      sender_id: "u-sidney",
      dm_conversation_id: "c1",
    },
    {
      id: "1900000000000000002",
      event_type: "MessageCreate",
      text: "official ping for verification",
      created_at: new Date(Date.now() - 30_000).toISOString(),
      sender_id: "u-newsdesk",
      dm_conversation_id: "c2",
    },
    {
      id: "1900000000000000003",
      event_type: "MessageCreate",
      text: "open to a collab? we have a brand deal in mind",
      created_at: new Date(Date.now() - 10_000).toISOString(),
      sender_id: "u-brand",
      dm_conversation_id: "c3",
    },
  ],
  includes: { users: Object.values(FAKE_USERS) },
};

function makeFakeFetch() {
  let calls = 0;
  return async (_url: string, _init?: RequestInit): Promise<Response> => {
    calls += 1;
    return new Response(JSON.stringify(FIRST_PAGE), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

async function main() {
  const db = createDb(DATABASE_URL);

  console.log("[verify] cleaning prior verify rows");
  await db.delete(socialDms).where(eq(socialDms.socialAccountId, X_ACCOUNT));
  await db.delete(jarvisAlerts).where(eq(jarvisAlerts.source, "social-dm-poller"));

  // Make sure the account looks like a connected X account with dm.read scope.
  await db
    .update(socialAccounts)
    .set({
      status: "connected",
      accessToken: "fake-token-for-verify",
      tokenExpiresAt: new Date(Date.now() + 60 * 60_000),
      metadata: { connectMethod: "verify-script", scope: "tweet.read dm.read dm.write" },
      updatedAt: new Date(),
    })
    .where(eq(socialAccounts.id, X_ACCOUNT));

  const poller = createSocialDmPoller({
    db,
    tickIntervalMs: 60_000,
    fetchImpl: makeFakeFetch() as unknown as typeof fetch,
  });

  console.log("[verify] running poller.tickOnce() (first pass)");
  const first = await poller.tickOnce();
  console.log("[verify] first result =", first);

  console.log("[verify] running poller.tickOnce() (second pass — should be a no-op due to since_id + uniq idx)");
  const second = await poller.tickOnce();
  console.log("[verify] second result =", second);

  const dms = await db
    .select()
    .from(socialDms)
    .where(eq(socialDms.socialAccountId, X_ACCOUNT))
    .orderBy(desc(socialDms.sentAt));
  console.log(
    "[verify] DM rows =",
    dms.map((d) => ({
      handle: d.senderHandle,
      verified: d.senderVerified,
      firstContact: d.senderIsFirstContact,
      text: d.text,
    })),
  );

  const alerts = await db
    .select()
    .from(jarvisAlerts)
    .where(eq(jarvisAlerts.source, "social-dm-poller"))
    .orderBy(desc(jarvisAlerts.createdAt));
  console.log(
    "[verify] Jarvis alerts =",
    alerts.map((a) => ({ kind: a.kind, severity: a.severity, title: a.title })),
  );

  const accountAfter = await db
    .select()
    .from(socialAccounts)
    .where(eq(socialAccounts.id, X_ACCOUNT))
    .then((rows) => rows[0]);
  console.log("[verify] account.metadata.x.dmsSinceId =", (accountAfter?.metadata as any)?.x?.dmsSinceId);

  console.log("[verify] poller diagnostics =", poller.getDiagnostics());

  poller.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error("[verify] FAILED:", err);
  process.exit(1);
});
