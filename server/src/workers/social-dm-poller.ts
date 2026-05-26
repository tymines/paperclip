/**
 * X DM poller worker.
 *
 * For every connected X account that holds the `dm.read` scope, poll
 * `GET https://api.twitter.com/2/dm_events` once per tick, upsert each
 * event into `social_dms` (idempotent on `(platform, message_id)`), and
 * write a Jarvis alert for inbound DMs that look interesting (first
 * contact, verified sender, or hot-keyword match).
 *
 * Cursor: we persist the highest seen X `dm_event.id` in the account's
 * `metadata.x.dmsSinceId` so the next tick passes it as `since_id` and
 * X only returns newer events. On first poll (no cursor) we ask for
 * the most recent 50 events and let the unique index drop duplicates.
 *
 * Diagnostics live behind `GET /api/social/dms/poller/health` via
 * `getDiagnostics()` — mirrors social-scheduler's shape so the
 * dashboard rendering is shared.
 *
 * Same patterns as `social-scheduler.ts`: one in-flight tick at a time,
 * `unref()`d interval, per-account try/catch so one broken account
 * can't take down the rest.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { jarvisAlerts, socialAccounts, socialDms } from "@paperclipai/db";
import type { SocialAccount } from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";
import { ensureFreshToken } from "../services/social-scheduler/index.js";

const DEFAULT_TICK_INTERVAL_MS = 60_000;
const DEFAULT_MAX_RESULTS = 50;
const X_DM_EVENTS_URL = "https://api.twitter.com/2/dm_events";

/**
 * Inbound DMs that match any of these substrings (case-insensitive) get a
 * Jarvis alert tagged "hot_keyword". Seed list matches the brief —
 * Tyler-tunable later via a settings row.
 */
const HOT_KEYWORDS = ["collab", "partnership", "sponsorship", "brand deal", "rate"];

export interface SocialDmPollerOptions {
  db: Db;
  tickIntervalMs?: number;
  maxResultsPerAccount?: number;
  /** Test-only fetch override. */
  fetchImpl?: typeof fetch;
}

export interface SocialDmPollerDiagnostics {
  running: boolean;
  startedAt: Date | null;
  lastTickAt: Date | null;
  lastTickDurationMs: number | null;
  tickCount: number;
  accountsPolledLastTick: number;
  dmsInsertedLastTick: number;
  alertsEmittedLastTick: number;
  lastError: { at: Date; message: string; accountId?: string } | null;
}

export interface SocialDmPoller {
  start(): void;
  stop(): void;
  tickOnce(): Promise<{ accountsPolled: number; dmsInserted: number; alertsEmitted: number }>;
  getDiagnostics(): SocialDmPollerDiagnostics;
}

interface XDmEvent {
  id: string;
  event_type?: string;
  text?: string;
  created_at?: string;
  sender_id?: string;
  dm_conversation_id?: string;
  attachments?: { media_keys?: string[] };
}

interface XDmUser {
  id: string;
  username?: string;
  name?: string;
  verified?: boolean;
  profile_image_url?: string;
}

interface XDmResponse {
  data?: XDmEvent[];
  includes?: { users?: XDmUser[] };
  meta?: { next_token?: string; result_count?: number; newest_id?: string; oldest_id?: string };
  errors?: Array<{ title?: string; detail?: string }>;
}

export function createSocialDmPoller(opts: SocialDmPollerOptions): SocialDmPoller {
  const db = opts.db;
  const tickIntervalMs = Math.max(10_000, opts.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS);
  const maxResults = Math.max(5, Math.min(100, opts.maxResultsPerAccount ?? DEFAULT_MAX_RESULTS));
  const httpFetch = opts.fetchImpl ?? fetch;
  const log = logger.child({ worker: "social-dm-poller" });

  let timer: NodeJS.Timeout | null = null;
  let ticking = false;
  let startedAt: Date | null = null;
  let lastTickAt: Date | null = null;
  let lastTickDurationMs: number | null = null;
  let tickCount = 0;
  let accountsPolledLastTick = 0;
  let dmsInsertedLastTick = 0;
  let alertsEmittedLastTick = 0;
  let lastError: SocialDmPollerDiagnostics["lastError"] = null;

  function start() {
    if (timer) return;
    startedAt = new Date();
    log.info({ tickIntervalMs, maxResults }, "social DM poller starting");
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
    log.info("social DM poller stopped");
  }

  async function runTick() {
    if (ticking) return { accountsPolled: 0, dmsInserted: 0, alertsEmitted: 0 };
    ticking = true;
    const tickStart = Date.now();
    try {
      tickCount += 1;
      const result = await tickInternal();
      lastTickAt = new Date();
      lastTickDurationMs = Date.now() - tickStart;
      accountsPolledLastTick = result.accountsPolled;
      dmsInsertedLastTick = result.dmsInserted;
      alertsEmittedLastTick = result.alertsEmitted;
      if (result.dmsInserted > 0 || result.alertsEmitted > 0) {
        log.info(result, "DM poller tick processed new DMs");
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastError = { at: new Date(), message };
      log.error({ err }, "DM poller tick error");
      throw err;
    } finally {
      ticking = false;
    }
  }

  async function tickInternal() {
    const accounts = await db
      .select()
      .from(socialAccounts)
      .where(and(eq(socialAccounts.platform, "x"), eq(socialAccounts.status, "connected")));

    let accountsPolled = 0;
    let dmsInserted = 0;
    let alertsEmitted = 0;
    for (const row of accounts) {
      const account = row as unknown as SocialAccount;
      const scopes = readScopes(account);
      if (!scopes.includes("dm.read")) continue;
      try {
        const outcome = await pollAccount(account);
        accountsPolled += 1;
        dmsInserted += outcome.dmsInserted;
        alertsEmitted += outcome.alertsEmitted;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        lastError = { at: new Date(), message, accountId: account.id };
        log.warn({ err, accountId: account.id }, "DM poll failed for account");
      }
    }
    return { accountsPolled, dmsInserted, alertsEmitted };
  }

  async function pollAccount(account: SocialAccount) {
    const fresh = (await ensureFreshToken(db, account)) ?? account;
    if (!fresh.accessToken) return { dmsInserted: 0, alertsEmitted: 0 };

    const sinceId = readSinceId(fresh);
    const url = new URL(X_DM_EVENTS_URL);
    url.searchParams.set("max_results", String(maxResults));
    url.searchParams.set(
      "dm_event.fields",
      "id,event_type,text,created_at,sender_id,dm_conversation_id,attachments,referenced_tweets",
    );
    url.searchParams.set("user.fields", "verified,username,name,profile_image_url");
    url.searchParams.set("expansions", "sender_id,referenced_tweets.id");
    if (sinceId) url.searchParams.set("since_id", sinceId);

    const res = await httpFetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${fresh.accessToken}`,
        "User-Agent": "Paperclip-DM-Poller/1.0",
      },
    });
    if (res.status === 401 || res.status === 403) {
      await db
        .update(socialAccounts)
        .set({ status: "reauth_required", updatedAt: new Date() })
        .where(eq(socialAccounts.id, fresh.id));
      throw new Error(`X DM poll auth failed (${res.status})`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`X DM poll HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const payload = (await res.json().catch(() => ({}))) as XDmResponse;
    const events = Array.isArray(payload.data) ? payload.data : [];
    if (events.length === 0) return { dmsInserted: 0, alertsEmitted: 0 };

    const userById = new Map<string, XDmUser>();
    for (const u of payload.includes?.users ?? []) userById.set(u.id, u);

    let dmsInserted = 0;
    let alertsEmitted = 0;
    let newestId = sinceId ?? "";
    for (const event of events) {
      if (!event.id) continue;
      if (compareSnowflake(event.id, newestId) > 0) newestId = event.id;
      const isOutbound = event.sender_id != null && event.sender_id === fresh.platformAccountId;
      if (isOutbound) continue;

      const inserted = await upsertEvent(fresh, event, userById.get(event.sender_id ?? ""));
      if (inserted) {
        dmsInserted += 1;
        if (inserted.shouldAlert) {
          await emitJarvisAlert(fresh, inserted);
          alertsEmitted += 1;
        }
      }
    }

    if (newestId && newestId !== sinceId) {
      await db
        .update(socialAccounts)
        .set({
          metadata: sql`jsonb_set(
            jsonb_set(coalesce(${socialAccounts.metadata}, '{}'::jsonb), '{x}', coalesce(${socialAccounts.metadata}->'x', '{}'::jsonb), true),
            '{x,dmsSinceId}', ${JSON.stringify(newestId)}::jsonb, true
          )`,
          updatedAt: new Date(),
        })
        .where(eq(socialAccounts.id, fresh.id));
    }
    return { dmsInserted, alertsEmitted };
  }

  interface UpsertedDm {
    id: string;
    threadId: string;
    senderHandle: string | null;
    senderDisplayName: string | null;
    senderVerified: boolean;
    senderIsFirstContact: boolean;
    text: string | null;
    shouldAlert: boolean;
    matchedKeyword: string | null;
  }

  async function upsertEvent(
    account: SocialAccount,
    event: XDmEvent,
    sender: XDmUser | undefined,
  ): Promise<UpsertedDm | null> {
    const threadId = event.dm_conversation_id ?? `dm:${event.sender_id ?? "unknown"}`;
    const sentAt = event.created_at ? new Date(event.created_at) : new Date();
    const text = typeof event.text === "string" ? event.text : null;
    const firstContact = await isFirstContact(account.id, event.sender_id ?? null);
    const senderVerified = Boolean(sender?.verified);
    const matchedKeyword = pickHotKeyword(text);

    const inserted = await db
      .insert(socialDms)
      .values({
        socialAccountId: account.id,
        platform: "x",
        threadId,
        messageId: event.id,
        direction: "inbound",
        senderPlatformUserId: event.sender_id ?? null,
        senderHandle: sender?.username ?? null,
        senderDisplayName: sender?.name ?? null,
        senderAvatarUrl: sender?.profile_image_url ?? null,
        senderVerified,
        senderIsFirstContact: firstContact,
        text,
        mediaUrls: [],
        sentAt,
        rawPayload: event as unknown as Record<string, unknown>,
      })
      .onConflictDoNothing({ target: [socialDms.platform, socialDms.messageId] })
      .returning({ id: socialDms.id });

    if (inserted.length === 0) return null;

    const shouldAlert = firstContact || senderVerified || matchedKeyword != null;
    return {
      id: inserted[0].id,
      threadId,
      senderHandle: sender?.username ?? null,
      senderDisplayName: sender?.name ?? null,
      senderVerified,
      senderIsFirstContact: firstContact,
      text,
      shouldAlert,
      matchedKeyword,
    };
  }

  async function isFirstContact(accountId: string, senderId: string | null): Promise<boolean> {
    if (!senderId) return false;
    const prior = await db
      .select({ id: socialDms.id })
      .from(socialDms)
      .where(
        and(
          eq(socialDms.socialAccountId, accountId),
          eq(socialDms.senderPlatformUserId, senderId),
        ),
      )
      .limit(1);
    return prior.length === 0;
  }

  async function emitJarvisAlert(account: SocialAccount, dm: UpsertedDm) {
    const handleLabel = dm.senderHandle ? `@${dm.senderHandle}` : dm.senderDisplayName ?? "unknown sender";
    const reasonBits: string[] = [];
    if (dm.senderIsFirstContact) reasonBits.push("first contact");
    if (dm.senderVerified) reasonBits.push("verified");
    if (dm.matchedKeyword) reasonBits.push(`mentions "${dm.matchedKeyword}"`);
    const reasonLabel = reasonBits.length > 0 ? ` (${reasonBits.join(", ")})` : "";
    const previewLabel = dm.text ? ` — "${truncate(dm.text, 120)}"` : "";
    await db.insert(jarvisAlerts).values({
      companyId: account.companyId,
      source: "social-dm-poller",
      kind: dm.matchedKeyword ? "x_dm_hot_keyword" : dm.senderIsFirstContact ? "x_dm_first_contact" : "x_dm_verified",
      title: `New X DM from ${handleLabel}${reasonLabel}`,
      body: dm.text ?? null,
      refType: "social_dm",
      refId: dm.id,
      metadata: {
        platform: "x",
        accountId: account.id,
        threadId: dm.threadId,
        senderHandle: dm.senderHandle,
        senderVerified: dm.senderVerified,
        senderIsFirstContact: dm.senderIsFirstContact,
        matchedKeyword: dm.matchedKeyword,
        preview: dm.text ? truncate(dm.text, 200) : null,
      },
      severity: dm.matchedKeyword ? "high" : "info",
    });
    log.info(
      {
        accountId: account.id,
        senderHandle: dm.senderHandle,
        reason: reasonBits,
      },
      `jarvis alert: X DM from ${handleLabel}${previewLabel}`,
    );
  }

  function getDiagnostics(): SocialDmPollerDiagnostics {
    return {
      running: timer !== null,
      startedAt,
      lastTickAt,
      lastTickDurationMs,
      tickCount,
      accountsPolledLastTick,
      dmsInsertedLastTick,
      alertsEmittedLastTick,
      lastError,
    };
  }

  return { start, stop, tickOnce: runTick, getDiagnostics };
}

function readScopes(account: SocialAccount): string[] {
  const md = (account.metadata ?? {}) as Record<string, unknown>;
  const scopeField = md.scope;
  if (typeof scopeField === "string") return scopeField.split(/\s+/).filter(Boolean);
  if (Array.isArray(scopeField)) return scopeField.filter((s): s is string => typeof s === "string");
  return [];
}

function readSinceId(account: SocialAccount): string | null {
  const md = (account.metadata ?? {}) as Record<string, unknown>;
  const x = md.x;
  if (x && typeof x === "object" && "dmsSinceId" in x) {
    const v = (x as { dmsSinceId?: unknown }).dmsSinceId;
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function compareSnowflake(a: string, b: string): number {
  if (!a) return b ? -1 : 0;
  if (!b) return 1;
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

function pickHotKeyword(text: string | null): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const kw of HOT_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

function truncate(s: string, n: number) {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
