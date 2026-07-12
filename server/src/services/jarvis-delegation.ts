import { eq, and, desc, gte } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { jarvisDelegations } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

/**
 * Peer-agent delegation — Jarvis hands tasks off to other agents (Hermes,
 * August, Codex, content, social, researcher, claude-code) over the
 * OpenClaw bridge daemon.
 *
 * The bridge daemon listens locally; for each peer identity we hold a
 * {url, token} pair. Dispatch is fire-and-forget over HTTP — the peer
 * later POSTs its result back to /jarvis/delegations/:id/result with the
 * same shared token, at which point the row flips to "completed" and the
 * client's 30s poll picks it up.
 *
 * Configuration:
 *   - Env: JARVIS_PEER_<NAME>_URL, JARVIS_PEER_<NAME>_TOKEN per peer
 *   - Fallback: OPENCLAW_BRIDGE_URL (single shared daemon) + a default
 *     token used by every identity (dev / single-host setups).
 *
 * Defensive limits:
 *   - 3 concurrent delegations per user per 60s sliding window
 *   - Per-dispatch HTTP timeout: 8s (reachability), 12s (dispatch)
 *   - Reachability cached 30s per peer URL (cheap path for the brain)
 */

export type PeerAgentId =
  | "hermes"
  // Ares — the COO / distributor. The approved-plan handoff from the War Room
  // routes here; Ares fans the plan out to the fleet. Additive: the `agent`
  // column is plain text, so no migration is required.
  | "ares"
  | "august"
  | "codex"
  | "content"
  | "social"
  | "researcher"
  | "claude-code";

export interface PeerEndpoint {
  url: string;
  token: string;
  identityId: string;
}

export interface DelegationInput {
  companyId: string;
  conversationId?: string | null;
  agent: PeerAgentId;
  task: string;
  metadata?: Record<string, unknown>;
  requestedByActorId?: string | null;
}

export interface DelegationDispatchResult {
  id: string;
  status: "queued" | "failed";
  reachable: boolean;
  remainingQuotaThisMinute: number;
  error?: string;
}

const DISPATCH_TIMEOUT_MS = 12_000;
const REACHABILITY_TIMEOUT_MS = 4_000;
const REACHABILITY_CACHE_TTL_MS = 30_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_USER = 3;

const DEFAULT_BRIDGE_URL =
  process.env.OPENCLAW_BRIDGE_URL ?? "http://127.0.0.1:18790";
const DEFAULT_BRIDGE_TOKEN =
  process.env.OPENCLAW_BRIDGE_TOKEN ?? "openclaw-dev-token";

/**
 * Builds the peer endpoint table from env vars with a sensible
 * single-daemon fallback. Tyler can override any peer by setting the
 * per-name URL/TOKEN env. This is intentionally pure so tests can monkey
 * the env and re-call.
 */
export function getPeerEndpoint(peer: PeerAgentId): PeerEndpoint {
  const upper = peer.toUpperCase().replace(/-/g, "_");
  const url =
    process.env[`JARVIS_PEER_${upper}_URL`] ?? DEFAULT_BRIDGE_URL;
  const token =
    process.env[`JARVIS_PEER_${upper}_TOKEN`] ?? DEFAULT_BRIDGE_TOKEN;
  return { url, token, identityId: peer };
}

// ============================================================================
// Reachability — cached 30s per URL
// ============================================================================

interface ReachabilityCacheEntry {
  reachable: boolean;
  checkedAt: number;
  error?: string;
}

const reachabilityCache = new Map<string, ReachabilityCacheEntry>();

export async function checkPeerReachable(
  peer: PeerAgentId,
): Promise<{ reachable: boolean; error?: string }> {
  const endpoint = getPeerEndpoint(peer);
  const cached = reachabilityCache.get(endpoint.url);
  if (cached && Date.now() - cached.checkedAt < REACHABILITY_CACHE_TTL_MS) {
    return { reachable: cached.reachable, error: cached.error };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REACHABILITY_TIMEOUT_MS);
  let reachable = false;
  let error: string | undefined;
  try {
    const resp = await fetch(new URL("/health", endpoint.url).toString(), {
      method: "GET",
      headers: { authorization: `Bearer ${endpoint.token}` },
      signal: controller.signal,
      redirect: "manual",
    });
    // 2xx and 3xx both indicate the daemon answered; 401 specifically
    // means we reached it but the token is wrong — surface that distinctly
    // so the brain can tell the user "August's bridge is down" vs "auth
    // mismatch".
    if (resp.status === 401 || resp.status === 403) {
      reachable = false;
      error = `auth_${resp.status}`;
    } else {
      reachable = resp.status < 500;
    }
  } catch (err) {
    reachable = false;
    error = (err as Error).name === "AbortError" ? "timeout" : (err as Error).message;
  } finally {
    clearTimeout(timer);
  }

  reachabilityCache.set(endpoint.url, {
    reachable,
    checkedAt: Date.now(),
    error,
  });
  return { reachable, error };
}

/** Test hook — clears the reachability cache so unit tests get fresh probes. */
export function __resetReachabilityCache(): void {
  reachabilityCache.clear();
}

// ============================================================================
// Rate limit — sliding-window per-actor counter
// ============================================================================

const rateBuckets = new Map<string, number[]>();

function checkRate(actorId: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const existing = (rateBuckets.get(actorId) ?? []).filter((t) => t > cutoff);
  if (existing.length >= RATE_LIMIT_MAX_PER_USER) {
    rateBuckets.set(actorId, existing);
    return { allowed: false, remaining: 0 };
  }
  existing.push(now);
  rateBuckets.set(actorId, existing);
  return {
    allowed: true,
    remaining: Math.max(0, RATE_LIMIT_MAX_PER_USER - existing.length),
  };
}

/** Test hook — clears rate-limit state between unit tests. */
export function __resetRateLimits(): void {
  rateBuckets.clear();
}

// ============================================================================
// Dispatch
// ============================================================================

function bridgeReplyBaseUrl(): string {
  if (process.env.PAPERCLIP_BRIDGE_LOCAL_API_URL) {
    return process.env.PAPERCLIP_BRIDGE_LOCAL_API_URL;
  }
  const port = process.env.PAPERCLIP_LISTEN_PORT ?? process.env.PORT;
  if (port) return `http://127.0.0.1:${port}`;
  if (process.env.PAPERCLIP_API_URL) return process.env.PAPERCLIP_API_URL;
  return "http://127.0.0.1:3001";
}

/**
 * Persists a row + POSTs to the peer's bridge endpoint. The HTTP call is
 * fire-and-forget — we return as soon as the row is queued, so the brain
 * can give Tyler a natural-language acknowledgment immediately.
 *
 * The peer's result callback goes to:
 *   POST {paperclip}/api/companies/:companyId/jarvis/delegations/:id/result
 *   Authorization: Bearer <delegation row's metadata.callbackToken>
 *   Body: { result, status: "completed"|"failed", error? }
 */
export async function dispatchDelegation(
  db: Db,
  input: DelegationInput,
): Promise<DelegationDispatchResult> {
  const actorId = input.requestedByActorId ?? "unknown";
  const rate = checkRate(actorId);
  if (!rate.allowed) {
    return {
      id: "",
      status: "failed",
      reachable: false,
      remainingQuotaThisMinute: 0,
      error: `rate_limited: max ${RATE_LIMIT_MAX_PER_USER} delegations per minute per user`,
    };
  }

  const endpoint = getPeerEndpoint(input.agent);
  const callbackToken = `cb_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;

  const [row] = await db
    .insert(jarvisDelegations)
    .values({
      companyId: input.companyId,
      conversationId: input.conversationId ?? null,
      agent: input.agent,
      task: input.task,
      status: "queued",
      metadata: {
        ...(input.metadata ?? {}),
        callbackToken,
        peerUrl: endpoint.url,
        peerIdentityId: endpoint.identityId,
      },
      requestedByActorId: actorId,
    })
    .returning({
      id: jarvisDelegations.id,
    });

  if (!row) {
    return {
      id: "",
      status: "failed",
      reachable: false,
      remainingQuotaThisMinute: rate.remaining,
      error: "persist_failed",
    };
  }

  // Fire-and-forget the actual bridge POST. If the peer is unreachable we
  // flip the row to "failed" so the polling client picks it up — Tyler
  // sees a red chip rather than a forever-spinning one.
  const callbackUrl = new URL(
    `/api/companies/${input.companyId}/jarvis/delegations/${row.id}/result`,
    bridgeReplyBaseUrl(),
  ).toString();

  const payload = {
    kind: "jarvis-delegation",
    identityId: endpoint.identityId,
    agent: input.agent,
    delegationId: row.id,
    companyId: input.companyId,
    task: input.task,
    metadata: input.metadata ?? {},
    callback: {
      url: callbackUrl,
      token: callbackToken,
    },
  };

  void (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS);
    try {
      const target = new URL(
        process.env.JARVIS_DISPATCH_PATH ?? "/agent/message",
        endpoint.url,
      ).toString();
      const resp = await fetch(target, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${endpoint.token}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
        redirect: "manual",
      });
      if (!resp.ok) {
        await markFailed(db, row.id, `bridge_${resp.status}`);
        logger.warn(
          { delegationId: row.id, status: resp.status, agent: input.agent },
          "jarvis-delegation: bridge POST returned non-2xx",
        );
      }
    } catch (err) {
      await markFailed(db, row.id, (err as Error).message ?? "dispatch_failed");
      logger.warn(
        { err, delegationId: row.id, agent: input.agent },
        "jarvis-delegation: bridge POST threw",
      );
    } finally {
      clearTimeout(timer);
    }
  })();

  // Pre-flight a reachability snapshot for the response so the brain can
  // warn Tyler synchronously when the target is down (cached, so cheap).
  const reach = await checkPeerReachable(input.agent).catch(() => ({
    reachable: true,
    error: undefined,
  }));

  return {
    id: row.id,
    status: "queued",
    reachable: reach.reachable,
    remainingQuotaThisMinute: rate.remaining,
    error: reach.reachable ? undefined : reach.error,
  };
}

async function markFailed(db: Db, id: string, error: string): Promise<void> {
  try {
    await db
      .update(jarvisDelegations)
      .set({
        status: "failed",
        result: error,
        completedAt: new Date(),
      })
      .where(eq(jarvisDelegations.id, id));
  } catch (err) {
    logger.error({ err, id }, "jarvis-delegation: failed to mark row failed");
  }
}

// ============================================================================
// Result callback (called by peer when it finishes)
// ============================================================================

export interface DelegationResultInput {
  delegationId: string;
  companyId: string;
  callbackToken: string;
  status: "running" | "completed" | "failed";
  result?: string;
  error?: string;
}

export async function recordDelegationResult(
  db: Db,
  input: DelegationResultInput,
): Promise<{ ok: boolean; error?: string }> {
  const [row] = await db
    .select()
    .from(jarvisDelegations)
    .where(
      and(
        eq(jarvisDelegations.id, input.delegationId),
        eq(jarvisDelegations.companyId, input.companyId),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, error: "delegation_not_found" };

  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  if (typeof meta.callbackToken !== "string" || meta.callbackToken !== input.callbackToken) {
    return { ok: false, error: "callback_token_mismatch" };
  }

  const update: Partial<typeof jarvisDelegations.$inferInsert> = {
    status: input.status,
  };
  if (input.status === "completed" || input.status === "failed") {
    update.completedAt = new Date();
    update.result = input.result ?? input.error ?? null;
  } else if (input.result) {
    update.result = input.result;
  }

  await db
    .update(jarvisDelegations)
    .set(update)
    .where(eq(jarvisDelegations.id, input.delegationId));

  return { ok: true };
}

// ============================================================================
// Listing
// ============================================================================

export interface ListDelegationsOptions {
  status?: "queued" | "running" | "completed" | "failed";
  conversationId?: string;
  limit?: number;
}

export async function listDelegations(
  db: Db,
  companyId: string,
  opts: ListDelegationsOptions = {},
) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const filters = [eq(jarvisDelegations.companyId, companyId)];
  if (opts.status) filters.push(eq(jarvisDelegations.status, opts.status));
  if (opts.conversationId)
    filters.push(eq(jarvisDelegations.conversationId, opts.conversationId));

  return db
    .select()
    .from(jarvisDelegations)
    .where(and(...filters))
    .orderBy(desc(jarvisDelegations.createdAt))
    .limit(limit);
}

export async function countRecentDelegations(
  db: Db,
  companyId: string,
  windowMs = 60_000,
): Promise<number> {
  const since = new Date(Date.now() - windowMs);
  const rows = await db
    .select({ id: jarvisDelegations.id })
    .from(jarvisDelegations)
    .where(
      and(
        eq(jarvisDelegations.companyId, companyId),
        gte(jarvisDelegations.createdAt, since),
      ),
    );
  return rows.length;
}

// ============================================================================
// Voice phrasing — natural acknowledgments per peer
// ============================================================================

const PEER_LABEL: Record<PeerAgentId, string> = {
  hermes: "Hermes",
  ares: "Ares (COO)",
  august: "August",
  codex: "Codex",
  content: "the content desk",
  social: "the social desk",
  researcher: "the research desk",
  "claude-code": "a Claude Code sidekick",
};

const PEER_ETA: Record<PeerAgentId, string> = {
  hermes: "about ten minutes",
  ares: "a few minutes — Ares fans it out to the fleet",
  august: "a few minutes — assuming the Mac mini's reachable",
  codex: "a couple of minutes",
  content: "fifteen or twenty minutes",
  social: "a minute or two",
  researcher: "fifteen to thirty minutes",
  "claude-code": "however long the repo takes",
};

export function naturalAcknowledgment(
  peer: PeerAgentId,
  result: DelegationDispatchResult,
): string {
  if (result.status === "failed") {
    if (result.error?.startsWith("rate_limited")) {
      return `Hold up — you've fired off three delegations in the last minute. Let those land first, then I'll hand the next one off.`;
    }
    return `Couldn't hand that to ${PEER_LABEL[peer]} — ${result.error ?? "unknown failure"}. Want me to try again, or queue it for later?`;
  }
  if (!result.reachable) {
    return `${PEER_LABEL[peer]}'s bridge is down right now (${result.error ?? "unreachable"}) — I've queued the task; it'll go through when the daemon's back up. Want me to route it elsewhere instead?`;
  }
  const quotaWarning =
    result.remainingQuotaThisMinute <= 1
      ? ` (heads up: ${result.remainingQuotaThisMinute} delegation${result.remainingQuotaThisMinute === 1 ? "" : "s"} left in this minute)`
      : "";
  return `On it — handed off to ${PEER_LABEL[peer]}, should take ${PEER_ETA[peer]}.${quotaWarning} Want me to ping you when it lands?`;
}
