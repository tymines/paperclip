import { randomBytes } from "node:crypto";
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createSocialAccountSchema,
  updateSocialAccountSchema,
  createSocialPostSchema,
  updateSocialPostSchema,
  buildOAuthAuthorizeUrl,
  getWizardSpec,
  WIZARD_PLATFORM_SPECS,
  PAPERCLIP_SOCIAL_CALLBACK_BASE,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { socialService, logActivity } from "../services/index.js";
import {
  buildConnectedAccountFromTokens,
  describeFeatureGate,
  ensureFreshToken,
  exchangeCodeForTokens,
  getHomeworkForPlatform,
  getSocialAdapter,
  listSupportedSocialPlatforms,
  socialCredentialsService,
  testCredentialFormat,
  TokenExchangeError,
  verifyAccessToken,
  type DirectMessage,
  type DirectMessageThread,
} from "../services/social-scheduler/index.js";
import {
  SOCIAL_PLATFORMS,
  type SocialFeatureAvailability,
  type SocialPlatform,
} from "@paperclipai/shared";
import { notFound, badRequest } from "../errors.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import type { SocialScheduler } from "../workers/social-scheduler.js";
import type { SocialDmPoller } from "../workers/social-dm-poller.js";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { socialDms } from "@paperclipai/db";

function isSocialPlatform(value: string): value is SocialPlatform {
  return (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

/**
 * Honest keyed-off response for an expansion feature that has no real
 * backing source on this platform yet. Reason + homework link come from
 * `feasibility.ts` (single source of truth) — routes never serve stub data
 * in place of this.
 */
function unavailable(
  feature: string,
  platform: SocialPlatform,
): Extract<SocialFeatureAvailability<never>, { available: false }> {
  const homework = getHomeworkForPlatform(platform);
  return {
    available: false,
    reason: describeFeatureGate(feature, platform),
    ...(homework ? { homework } : {}),
  };
}

/** Strip token fields before sending to client */
function redactAccount(account: Record<string, unknown>) {
  const { accessToken, refreshToken, ...safe } = account;
  return safe;
}

/**
 * In-memory mapping of OAuth `state` → { companyId, platform }, used by
 * the SocialConnectWizard step 4 → /auth/social-callback/:platform flow.
 *
 * State tokens expire after 10 minutes; the map is bounded to the most
 * recent 500 entries to prevent unbounded growth in dev. Production
 * deployments with multiple replicas would back this with Redis — the
 * wizard does one round-trip per Connect, so a single-process map is
 * good enough for v2.
 */
interface OAuthStateEntry {
  companyId: string;
  platform: SocialPlatform;
  redirectUri: string;
  createdAt: number;
}
const oauthStateStore = new Map<string, OAuthStateEntry>();
const OAUTH_STATE_TTL_MS = 10 * 60_000;
const OAUTH_STATE_MAX_SIZE = 500;

function rememberOAuthState(state: string, entry: OAuthStateEntry) {
  // Drop oldest entries first if we exceed the cap.
  if (oauthStateStore.size >= OAUTH_STATE_MAX_SIZE) {
    const oldestKey = oauthStateStore.keys().next().value;
    if (oldestKey !== undefined) oauthStateStore.delete(oldestKey);
  }
  oauthStateStore.set(state, entry);
}

function consumeOAuthState(state: string): OAuthStateEntry | null {
  const entry = oauthStateStore.get(state);
  if (!entry) return null;
  oauthStateStore.delete(state);
  if (Date.now() - entry.createdAt > OAUTH_STATE_TTL_MS) return null;
  return entry;
}

export function __testing_oauthStateStore() {
  return { rememberOAuthState, consumeOAuthState, oauthStateStore };
}

export function socialRoutes(
  db: Db,
  opts: { scheduler?: SocialScheduler; dmPoller?: SocialDmPoller } = {},
) {
  const router = Router();
  const svc = socialService(db);
  const credentials = socialCredentialsService(db);
  const scheduler = opts.scheduler ?? null;
  const dmPoller = opts.dmPoller ?? null;

  // ── Scheduler ────────────────────────────────────────────────────────────

  // GET /social/scheduler/health — runtime diagnostics for the social
  // scheduler worker. Returns 503 when the worker hasn't been wired into
  // this server process (e.g. tests that build a router without it).
  router.get("/social/scheduler/health", (_req, res) => {
    if (!scheduler) {
      res.status(503).json({ enabled: false, reason: "social scheduler not started in this process" });
      return;
    }
    const diag = scheduler.getDiagnostics();
    res.json({ enabled: true, ...diag });
  });

  // ── DM Poller ────────────────────────────────────────────────────────────

  // GET /social/dms/poller/health — runtime diagnostics for the X DM
  // poller worker. 503 if the poller isn't wired into this process.
  router.get("/social/dms/poller/health", (_req, res) => {
    if (!dmPoller) {
      res.status(503).json({ enabled: false, reason: "DM poller not started in this process" });
      return;
    }
    const diag = dmPoller.getDiagnostics();
    res.json({ enabled: true, ...diag });
  });

  // GET /companies/:companyId/social/dms?accountId=&unreadOnly=&limit=
  // Returns the most-recent DMs across the company's connected accounts.
  router.get("/companies/:companyId/social/dms", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const accountId = typeof req.query.accountId === "string" ? req.query.accountId : null;
    const unreadOnly =
      req.query.unreadOnly === "true" || req.query.unreadOnly === "1";
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));

    const accounts = await svc.listAccounts(companyId);
    const accountIds = accounts.map((a) => a.id);
    if (accountIds.length === 0) {
      res.json([]);
      return;
    }
    if (accountId && !accountIds.includes(accountId)) {
      throw notFound("account");
    }

    const conditions = [
      accountId
        ? eq(socialDms.socialAccountId, accountId)
        : sql`${socialDms.socialAccountId} = ANY(${accountIds}::uuid[])`,
    ];
    if (unreadOnly) conditions.push(isNull(socialDms.readAt));

    const rows = await db
      .select()
      .from(socialDms)
      .where(and(...conditions))
      .orderBy(desc(socialDms.sentAt))
      .limit(limit);
    res.json(rows);
  });

  // POST /companies/:companyId/social/dms/:dmId/mark-read
  router.post("/companies/:companyId/social/dms/:dmId/mark-read", async (req, res) => {
    const companyId = req.params.companyId as string;
    const dmId = req.params.dmId as string;
    assertCompanyAccess(req, companyId);
    const row = await db
      .select()
      .from(socialDms)
      .where(eq(socialDms.id, dmId))
      .then((rows) => rows[0] ?? null);
    if (!row) throw notFound("dm");
    const account = await svc.getAccount(row.socialAccountId);
    if (!account || account.companyId !== companyId) throw notFound("dm");
    const now = new Date();
    await db
      .update(socialDms)
      .set({ readAt: now })
      .where(eq(socialDms.id, dmId));
    res.json({ id: dmId, readAt: now.toISOString() });
  });

  // GET /companies/:companyId/social/dms/unread-count — sidebar badge.
  // This fires on every page load, so it must never 500: a failure here would
  // surface as a loud console error on every navigation. We use Drizzle's
  // `inArray` (an `IN (...)` list) rather than a raw `ANY($1::uuid[])` — the
  // postgres.js driver binds a JS array to a single uuid[] placeholder as a
  // scalar, which Postgres rejects as a "malformed array literal". Any
  // unexpected failure falls back to a safe `{ unread: 0 }`.
  router.get("/companies/:companyId/social/dms/unread-count", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    try {
      const accounts = await svc.listAccounts(companyId);
      const accountIds = accounts.map((a) => a.id);
      if (accountIds.length === 0) {
        res.json({ unread: 0 });
        return;
      }
      const result = await db
        .select({ unread: sql<number>`count(*)::int` })
        .from(socialDms)
        .where(
          and(
            inArray(socialDms.socialAccountId, accountIds),
            isNull(socialDms.readAt),
            eq(socialDms.direction, "inbound"),
          ),
        );
      res.json({ unread: result[0]?.unread ?? 0 });
    } catch (err) {
      // Never break a page load over a badge count — degrade to zero.
      req.log?.error?.({ err }, "social/dms/unread-count failed; returning 0");
      res.json({ unread: 0 });
    }
  });

  // POST /social/scheduler/fire-now/:postId — admin/test bypass that runs
  // the publish pipeline immediately for one post, ignoring scheduled_at.
  router.post("/social/scheduler/fire-now/:postId", async (req, res, next) => {
    try {
      if (!scheduler) {
        res.status(503).json({ ok: false, reason: "social scheduler not started in this process" });
        return;
      }
      const postId = req.params.postId as string;
      const post = await svc.getPost(postId);
      if (!post) throw notFound("Social post not found");
      assertCompanyAccess(req, post.companyId);
      const result = await scheduler.fireNow(postId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // ── Accounts ─────────────────────────────────────────────────────────────

  // GET /companies/:companyId/social/accounts
  router.get("/companies/:companyId/social/accounts", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const accounts = await svc.listAccounts(companyId);
    res.json(accounts.map(redactAccount));
  });

  // POST /companies/:companyId/social/accounts
  router.post(
    "/companies/:companyId/social/accounts",
    validate(createSocialAccountSchema),
    async (req, res, next) => {
      try {
        const companyId = req.params.companyId as string;
        assertCompanyAccess(req, companyId);
        const actor = getActorInfo(req);
        const account = await svc.createAccount(companyId, {
          ...req.body,
          createdBy: actor.actorId,
        });
        try {
          await logActivity(db, {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            action: "social.account.created",
            entityType: "social_account",
            entityId: account.id,
            details: { platform: account.platform, displayName: account.displayName },
          });
        } catch (e) {
          console.error("[social] logActivity error:", e);
        }
        res.status(201).json(redactAccount(account as unknown as Record<string, unknown>));
      } catch (err) {
        console.error("[social] create account error:", err);
        next(err);
      }
    },
  );

  // GET /companies/:companyId/social/accounts/:accountId
  router.get("/companies/:companyId/social/accounts/:accountId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const accountId = req.params.accountId as string;
    assertCompanyAccess(req, companyId);
    const account = await svc.getAccount(accountId);
    if (!account || account.companyId !== companyId) {
      throw notFound("Social account not found");
    }
    res.json(redactAccount(account as unknown as Record<string, unknown>));
  });

  // GET /companies/:companyId/social/accounts/:accountId/verify
  // Hits the platform's /me-style endpoint to confirm the stored token is
  // still good. Used by the Accounts dot (green = ok, red = re-auth).
  //
  // Refreshes the token first if it's within 5 min of expiring, then
  // prefers the adapter's `verifyAccount()` (Reddit has karma metrics
  // worth surfacing) and falls back to the platform-agnostic
  // `verifyAccessToken()` for adapters that haven't overridden it.
  //
  // Returns { ok, supported, handle?, details?, reason? }.
  router.get("/companies/:companyId/social/accounts/:accountId/verify", async (req, res) => {
    const companyId = req.params.companyId as string;
    const accountId = req.params.accountId as string;
    assertCompanyAccess(req, companyId);
    const account = await svc.getAccount(accountId);
    if (!account || account.companyId !== companyId) {
      throw notFound("Social account not found");
    }
    if (!account.accessToken) {
      res.json({ ok: false, supported: true, reason: "no access token stored" });
      return;
    }
    // Best-effort refresh — don't fail verify if refresh itself errors.
    let working = account;
    try {
      working = (await ensureFreshToken(
        db,
        account as unknown as Parameters<typeof ensureFreshToken>[1],
      )) as unknown as typeof account;
    } catch {
      /* fall through to the existing token */
    }
    const adapter = getSocialAdapter(working.platform as SocialPlatform);
    if (adapter?.verifyAccount) {
      try {
        const result = await adapter.verifyAccount(
          working as unknown as Parameters<NonNullable<typeof adapter.verifyAccount>>[0],
        );
        res.json({ ...result, supported: true });
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // 200 (not 5xx) so the dot UI gets a JSON body — it differentiates
        // by `ok: false` + `reason` rather than HTTP status.
        res.status(200).json({ ok: false, supported: true, reason: message });
        return;
      }
    }
    // Fall back to the generic /me hit via token-exchange.ts.
    const generic = await verifyAccessToken(
      working.platform as SocialPlatform,
      working.accessToken ?? "",
    );
    res.json({
      ok: generic.ok,
      supported: true,
      handle: generic.identity?.platformUserName ?? null,
      details: generic.identity ?? null,
      reason: generic.error,
    });
  });

  // PATCH /companies/:companyId/social/accounts/:accountId
  router.patch(
    "/companies/:companyId/social/accounts/:accountId",
    validate(updateSocialAccountSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const accountId = req.params.accountId as string;
      assertCompanyAccess(req, companyId);
      const existing = await svc.getAccount(accountId);
      if (!existing || existing.companyId !== companyId) {
        throw notFound("Social account not found");
      }
      const account = await svc.updateAccount(accountId, req.body);
      if (!account) throw notFound("Social account not found");
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "social.account.updated",
        entityType: "social_account",
        entityId: account.id,
        details: req.body,
      });
      res.json(redactAccount(account as unknown as Record<string, unknown>));
    },
  );

  // DELETE /companies/:companyId/social/accounts/:accountId
  router.delete("/companies/:companyId/social/accounts/:accountId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const accountId = req.params.accountId as string;
    assertCompanyAccess(req, companyId);
    const existing = await svc.getAccount(accountId);
    if (!existing || existing.companyId !== companyId) {
      throw notFound("Social account not found");
    }
    const account = await svc.deleteAccount(accountId);
    if (!account) throw notFound("Social account not found");
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "social.account.deleted",
      entityType: "social_account",
      entityId: account.id,
    });
    res.json(redactAccount(account as unknown as Record<string, unknown>));
  });

  // ── Posts ────────────────────────────────────────────────────────────────

  // GET /companies/:companyId/social/posts
  router.get("/companies/:companyId/social/posts", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const status = req.query.status as string | undefined;
    const posts = await svc.listPosts(companyId, status);
    // Attach target info for each post
    const result = await Promise.all(
      posts.map(async (post) => {
        const targets = await svc.getPostTargets(post.id);
        return {
          ...post,
          targetCount: targets.length,
          platforms: [...new Set(targets.map((t) => t.platform))],
        };
      }),
    );
    res.json(result);
  });

  // POST /companies/:companyId/social/posts
  router.post(
    "/companies/:companyId/social/posts",
    validate(createSocialPostSchema),
    async (req, res, next) => {
      try {
        const companyId = req.params.companyId as string;
        assertCompanyAccess(req, companyId);
        const actor = getActorInfo(req);
        const { accountIds, ...postData } = req.body;
        const status = postData.scheduledAt ? "scheduled" : "draft";
        const post = await svc.createPost(
          companyId,
          { ...postData, status, createdBy: actor.actorId },
          accountIds,
        );
        try {
          await logActivity(db, {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            action: "social.post.created",
            entityType: "social_post",
            entityId: post.id,
            details: { status, postType: post.postType, targetCount: post.targets.length },
          });
        } catch (e) {
          console.error("[social] logActivity error:", e);
        }
        res.status(201).json(post);
      } catch (err) {
        console.error("[social] create post error:", err);
        next(err);
      }
    },
  );

  // GET /companies/:companyId/social/posts/:postId
  router.get("/companies/:companyId/social/posts/:postId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const postId = req.params.postId as string;
    assertCompanyAccess(req, companyId);
    const post = await svc.getPost(postId);
    if (!post || post.companyId !== companyId) {
      throw notFound("Social post not found");
    }
    const targets = await svc.getPostTargets(postId);
    res.json({ ...post, targets });
  });

  // PATCH /companies/:companyId/social/posts/:postId
  router.patch(
    "/companies/:companyId/social/posts/:postId",
    validate(updateSocialPostSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const postId = req.params.postId as string;
      assertCompanyAccess(req, companyId);
      const existing = await svc.getPost(postId);
      if (!existing || existing.companyId !== companyId) {
        throw notFound("Social post not found");
      }
      const post = await svc.updatePost(postId, req.body);
      if (!post) throw notFound("Social post not found");
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "social.post.updated",
        entityType: "social_post",
        entityId: post.id,
        details: req.body,
      });
      const targets = await svc.getPostTargets(postId);
      res.json({ ...post, targets });
    },
  );

  // DELETE /companies/:companyId/social/posts/:postId
  router.delete("/companies/:companyId/social/posts/:postId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const postId = req.params.postId as string;
    assertCompanyAccess(req, companyId);
    const existing = await svc.getPost(postId);
    if (!existing || existing.companyId !== companyId) {
      throw notFound("Social post not found");
    }
    const post = await svc.deletePost(postId);
    if (!post) throw notFound("Social post not found");
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "social.post.deleted",
      entityType: "social_post",
      entityId: post.id,
    });
    res.json(post);
  });

  // ── Scheduler (multi-platform) ────────────────────────────────────────────

  // GET /social/platforms — which platforms have a server adapter wired?
  // Used by UI to render only-supported platforms in compose / connect flow.
  router.get("/social/platforms", (_req, res) => {
    res.json({
      all: SOCIAL_PLATFORMS,
      supported: listSupportedSocialPlatforms(),
    });
  });

  // GET /social/feasibility — feature matrix + homework + banned list.
  // Single source of truth for what each platform actually supports
  // today, sourced from Hermes's `social-platform-apis.md` research.
  router.get("/social/feasibility", async (_req, res) => {
    const { SOCIAL_FEATURE_MATRIX, TYLER_HOMEWORK, BANNED_FEATURES } =
      await import("../services/social-scheduler/feasibility.js");
    res.json({
      matrix: SOCIAL_FEATURE_MATRIX,
      homework: TYLER_HOMEWORK,
      banned: BANNED_FEATURES,
    });
  });

  // POST /companies/:companyId/social/oauth/start
  // Body: { platform, redirectUri? }
  // Returns { authUrl, state } — a REAL authorize URL built from the saved
  // app credentials (same state store as the wizard's authorize endpoint).
  // Data honesty: no saved credentials → 400 pointing at the wizard. The
  // legacy stub connect path (fake authUrl + `@stub_*` accounts) is gone.
  router.post("/companies/:companyId/social/oauth/start", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const platform = String(req.body?.platform ?? "");
    if (!isSocialPlatform(platform)) throw badRequest(`unknown platform: ${platform}`);
    const spec = getWizardSpec(platform);
    if (!spec) throw badRequest(`${platform} is not yet supported by the connect wizard`);
    const creds = await credentials.get(platform);
    if (!creds) {
      throw badRequest(
        `Save ${platform} app credentials (Accounts → Connect Wizard) before starting OAuth`,
      );
    }
    const redirectUri =
      typeof req.body?.redirectUri === "string" && req.body.redirectUri
        ? req.body.redirectUri
        : creds.redirectUri ?? `${PAPERCLIP_SOCIAL_CALLBACK_BASE}/${platform}`;
    const state = randomBytes(24).toString("base64url");
    rememberOAuthState(state, { companyId, platform, redirectUri, createdAt: Date.now() });
    const authUrl = buildOAuthAuthorizeUrl({
      spec,
      clientId: creds.clientId,
      redirectUri,
      state,
    });
    res.json({ authUrl, state });
  });

  // POST /companies/:companyId/social/oauth/finish
  // Body: { platform, code, state }
  // Exchanges the auth code for REAL tokens (token-exchange.ts) and persists
  // the connected account. Returns the persisted row (tokens redacted).
  router.post("/companies/:companyId/social/oauth/finish", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const platform = String(req.body?.platform ?? "");
    const code = String(req.body?.code ?? "");
    const state = String(req.body?.state ?? "");
    if (!isSocialPlatform(platform)) throw badRequest(`unknown platform: ${platform}`);
    if (!code) throw badRequest("code is required");
    const entry = consumeOAuthState(state);
    if (!entry || entry.platform !== platform || entry.companyId !== companyId) {
      throw badRequest("OAuth state expired or did not match — restart the connect flow");
    }
    const creds = await credentials.getDecrypted(platform);
    if (!creds) {
      throw badRequest(
        `Save ${platform} app credentials (Accounts → Connect Wizard) before finishing OAuth`,
      );
    }

    let exchanged;
    try {
      exchanged = await exchangeCodeForTokens({
        platform,
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        code,
        redirectUri: entry.redirectUri,
      });
    } catch (err) {
      const message =
        err instanceof TokenExchangeError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      throw badRequest(`Token exchange failed: ${message}`);
    }

    const spec = getWizardSpec(platform);
    const account = buildConnectedAccountFromTokens({ platform, companyId, tokens: exchanged });
    const actor = getActorInfo(req);
    const persisted = await svc.createAccount(companyId, {
      platform: account.platform,
      platformAccountId: account.platformAccountId,
      displayName: account.displayName,
      username: account.username,
      avatarUrl: account.avatarUrl,
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      tokenExpiresAt: account.tokenExpiresAt,
      status: account.status,
      metadata: account.metadata as Record<string, unknown> | null,
      scopes: exchanged.scope
        ? exchanged.scope.split(/[\s,]+/).filter(Boolean)
        : spec?.oauth.scopes ?? [],
      connectMethod: "api",
      createdBy: actor.actorId,
    } as unknown as Parameters<typeof svc.createAccount>[1]);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "social.account.connected",
      entityType: "social_account",
      entityId: persisted.id,
      details: { platform, method: "api", handle: account.username, scope: exchanged.scope },
    });
    res.status(201).json(redactAccount(persisted));
  });

  // POST /companies/:companyId/social/posts/validate
  // Body: { platforms: SocialPlatform[], post: PostDraftPayload }
  // Returns { [platform]: PostValidation } so the composer can render
  // per-platform warnings/errors as the user types.
  router.post("/companies/:companyId/social/posts/validate", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const platforms: unknown = req.body?.platforms;
    const post = req.body?.post;
    if (!Array.isArray(platforms) || !post || typeof post !== "object") {
      throw badRequest("validate requires { platforms: string[], post: object }");
    }
    const out: Record<string, unknown> = {};
    for (const raw of platforms) {
      const platform = String(raw);
      if (!isSocialPlatform(platform)) continue;
      const adapter = getSocialAdapter(platform);
      if (!adapter) {
        out[platform] = { ok: false, errors: [`platform ${platform} is not wired`], warnings: [] };
        continue;
      }
      out[platform] = adapter.validatePost({
        baseCaption: typeof post.baseCaption === "string" ? post.baseCaption : "",
        caption: typeof post.caption === "string" ? post.caption : null,
        postType: post.postType ?? "text",
        mediaUrls: Array.isArray(post.mediaUrls) ? post.mediaUrls : [],
        firstComment: typeof post.firstComment === "string" ? post.firstComment : null,
        metadata: typeof post.metadata === "object" && post.metadata ? post.metadata : {},
      });
    }
    res.json(out);
  });

  // GET /companies/:companyId/social/feed/:platform?accountId=...&limit=...
  // For the IG grid: returns published posts from the platform + any
  // scheduled-but-not-yet-published Paperclip posts targeting that account.
  router.get("/companies/:companyId/social/feed/:platform", async (req, res) => {
    const companyId = req.params.companyId as string;
    const platform = String(req.params.platform);
    assertCompanyAccess(req, companyId);
    if (!isSocialPlatform(platform)) throw badRequest(`unknown platform: ${platform}`);
    const adapter = getSocialAdapter(platform);
    if (!adapter) throw badRequest(`platform ${platform} is not yet wired`);

    const accountId = typeof req.query.accountId === "string" ? req.query.accountId : null;
    const limit = Math.min(60, Math.max(6, Number.parseInt(String(req.query.limit ?? "33"), 10) || 33));

    const accounts = await svc.listAccounts(companyId);
    const account = accountId
      ? accounts.find((a) => a.id === accountId)
      : accounts.find((a) => a.platform === platform && a.status === "connected");
    if (!account) {
      res.json({ published: [], scheduled: [], hasAccount: false });
      return;
    }

    // Best-effort refresh before the platform read — don't fail the feed if
    // refresh itself errors, the read will surface the real auth failure.
    let working = account;
    try {
      working = (await ensureFreshToken(
        db,
        account as unknown as Parameters<typeof ensureFreshToken>[1],
      )) as unknown as typeof account;
    } catch {
      /* fall through to the existing token */
    }

    // Cast: socialAccounts rows store platform as `text` so TS widens to
    // `string` even though we only ever insert values from SocialPlatform.
    const adapterAccount = working as unknown as Parameters<typeof adapter.listRecentPosts>[0];
    const [{ posts: publishedRaw }, scheduledPosts] = await Promise.all([
      adapter.listRecentPosts(adapterAccount, { limit }),
      svc.listPosts(companyId, "scheduled"),
    ]);

    // Project scheduled rows down to the same lightweight shape as published
    // so the UI can merge into a single grid sorted by publishAt DESC.
    const scheduledForAccount = scheduledPosts.filter((p) =>
      Array.isArray(p.mediaUrls) && p.mediaUrls.length > 0,
    );

    res.json({
      hasAccount: true,
      account: redactAccount(account),
      published: publishedRaw,
      scheduled: scheduledForAccount.map((p) => ({
        id: p.id,
        scheduledAt: p.scheduledAt,
        caption: p.content,
        mediaUrl: Array.isArray(p.mediaUrls) ? (p.mediaUrls as string[])[0] ?? null : null,
      })),
    });
  });

  // ── Expansion-pass: Inbox / Competitors / Analytics / Hashtags ─────────
  //
  // Data-honesty contract: each of these returns
  //   { available: true, data: <payload> }
  // when a real backing source exists (X DMs come from the `social_dms`
  // table the DM poller fills), and
  //   { available: false, reason, homework? }
  // otherwise — reason/homework wired from `feasibility.ts`. Stub adapters
  // never feed these routes.

  /**
   * Fold the account's `social_dms` rows (most-recent-first) into
   * DirectMessageThread summaries for the Inbox list.
   */
  async function buildDmThreadsFromDb(
    accountId: string,
    limit: number,
  ): Promise<DirectMessageThread[]> {
    const rows = await db
      .select()
      .from(socialDms)
      .where(eq(socialDms.socialAccountId, accountId))
      .orderBy(desc(socialDms.sentAt))
      .limit(500);
    const threads = new Map<string, DirectMessageThread>();
    for (const row of rows) {
      let thread = threads.get(row.threadId);
      if (!thread) {
        // Rows arrive newest-first, so the first row per thread is the
        // latest message.
        thread = {
          threadId: row.threadId,
          participantHandle: row.senderHandle ?? row.senderDisplayName ?? row.threadId,
          participantAvatarUrl: row.senderAvatarUrl ?? null,
          lastMessageAt: row.sentAt,
          lastMessagePreview: (row.text ?? "").slice(0, 140),
          unreadCount: 0,
          canReply: true,
        };
        threads.set(row.threadId, thread);
      }
      if (row.direction === "inbound") {
        if (row.senderHandle && thread.participantHandle === row.threadId) {
          thread.participantHandle = row.senderHandle;
        }
        if (!thread.participantAvatarUrl && row.senderAvatarUrl) {
          thread.participantAvatarUrl = row.senderAvatarUrl;
        }
        if (!row.readAt) thread.unreadCount += 1;
      }
    }
    return [...threads.values()].slice(0, limit);
  }

  // GET /companies/:companyId/social/inbox?accountId=...
  // Per-account entries: X threads come from social_dms (real, poller-fed);
  // platforms without DM wiring return available:false with the homework
  // that unlocks them — never mock threads.
  router.get("/companies/:companyId/social/inbox", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const accountId = typeof req.query.accountId === "string" ? req.query.accountId : null;

    const accounts = await svc.listAccounts(companyId);
    const targets = accountId
      ? accounts.filter((a) => a.id === accountId)
      : accounts.filter((a) => a.status === "connected");

    const out: Array<
      { accountId: string; platform: string } & SocialFeatureAvailability<DirectMessageThread[]>
    > = [];
    for (const account of targets) {
      const platform = account.platform as SocialPlatform;
      if (platform === "x") {
        const threads = await buildDmThreadsFromDb(account.id, 30);
        out.push({ accountId: account.id, platform, available: true, data: threads });
      } else {
        out.push({ accountId: account.id, platform, ...unavailable("Read DMs", platform) });
      }
    }
    res.json(out);
  });

  // GET /companies/:companyId/social/inbox/:accountId/:threadId
  // Message stream for one thread. X reads from social_dms; other platforms
  // return the keyed-off state.
  router.get("/companies/:companyId/social/inbox/:accountId/:threadId", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const accountId = req.params.accountId as string;
    const threadId = req.params.threadId as string;
    const account = await svc.getAccount(accountId);
    if (!account || account.companyId !== companyId) throw notFound("account");
    const platform = account.platform as SocialPlatform;
    if (platform !== "x") {
      res.json(unavailable("Read DMs", platform));
      return;
    }
    const rows = await db
      .select()
      .from(socialDms)
      .where(and(eq(socialDms.socialAccountId, accountId), eq(socialDms.threadId, threadId)))
      .orderBy(asc(socialDms.sentAt))
      .limit(200);
    const messages: DirectMessage[] = rows.map((row) => ({
      id: row.id,
      threadId: row.threadId,
      direction: row.direction === "outbound" ? "outbound" : "inbound",
      sentAt: row.sentAt,
      text: row.text ?? "",
      attachments: Array.isArray(row.mediaUrls) ? (row.mediaUrls as string[]) : [],
    }));
    res.json({ available: true, data: messages });
  });

  // POST /companies/:companyId/social/inbox/:accountId/:threadId/send
  // Body: { text } — real X DM send via the adapter (dm.write, PPU); the
  // outbound message is mirrored into social_dms so the thread view stays
  // complete. Platforms without a real send path 400 with the reason.
  router.post("/companies/:companyId/social/inbox/:accountId/:threadId/send", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const accountId = req.params.accountId as string;
    const threadId = req.params.threadId as string;
    const text = typeof req.body?.text === "string" ? req.body.text : "";
    if (!text.trim()) throw badRequest("text is required");
    const account = await svc.getAccount(accountId);
    if (!account || account.companyId !== companyId) throw notFound("account");
    const platform = account.platform as SocialPlatform;
    const adapter = getSocialAdapter(platform);
    if (!adapter?.sendDirectMessage) {
      throw badRequest(describeFeatureGate("Send DMs", platform));
    }
    // Best-effort refresh — the send itself surfaces real auth failures.
    let working = account;
    try {
      working = (await ensureFreshToken(
        db,
        account as unknown as Parameters<typeof ensureFreshToken>[1],
      )) as unknown as typeof account;
    } catch {
      /* fall through to the existing token */
    }
    const message = await adapter.sendDirectMessage(
      working as unknown as Parameters<NonNullable<typeof adapter.sendDirectMessage>>[0],
      threadId,
      text,
    );
    // Mirror the outbound DM into social_dms (idempotent on platform+id).
    try {
      await db
        .insert(socialDms)
        .values({
          socialAccountId: account.id,
          platform: account.platform,
          threadId,
          messageId: message.id,
          direction: "outbound",
          senderPlatformUserId: account.platformAccountId,
          text,
          mediaUrls: [],
          sentAt: message.sentAt,
          rawPayload: null,
        })
        .onConflictDoNothing({ target: [socialDms.platform, socialDms.messageId] });
    } catch (err) {
      req.log?.warn?.({ err, accountId, threadId }, "failed to mirror outbound DM into social_dms");
    }
    res.status(201).json(message);
  });

  // GET /companies/:companyId/social/competitors/search?platform=...&q=...
  // Available only when the platform adapter has a real searchCompetitors
  // implementation (none do yet) — otherwise the keyed-off state.
  router.get("/companies/:companyId/social/competitors/search", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const platform = String(req.query.platform ?? "");
    const query = String(req.query.q ?? "");
    if (!isSocialPlatform(platform)) throw badRequest(`unknown platform: ${platform}`);
    const adapter = getSocialAdapter(platform);
    if (!adapter?.searchCompetitors) {
      res.json(unavailable("Competitor profile fetch", platform));
      return;
    }
    const results = await adapter.searchCompetitors(query);
    res.json({ available: true, data: results });
  });

  // GET /companies/:companyId/social/competitors/:platform/:handle?from=&to=
  router.get("/companies/:companyId/social/competitors/:platform/:handle", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const platform = String(req.params.platform);
    const handle = String(req.params.handle);
    if (!isSocialPlatform(platform)) throw badRequest(`unknown platform: ${platform}`);
    const adapter = getSocialAdapter(platform);
    if (!adapter?.getCompetitorMetrics) {
      res.json(unavailable("Competitor profile fetch", platform));
      return;
    }
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 86_400_000);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    const metrics = await adapter.getCompetitorMetrics(handle, { from, to });
    res.json({ available: true, data: metrics });
  });

  // GET /companies/:companyId/social/analytics?accountId=...&from=...&to=...
  // Available only when the platform adapter has a real getAccountAnalytics
  // implementation (none do yet — X owned reads / Meta Insights land per
  // the feasibility matrix) — otherwise the keyed-off state.
  router.get("/companies/:companyId/social/analytics", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const accountId = typeof req.query.accountId === "string" ? req.query.accountId : null;
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 86_400_000);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();

    const accounts = await svc.listAccounts(companyId);
    const account = accountId
      ? accounts.find((a) => a.id === accountId)
      : accounts.find((a) => a.status === "connected");
    if (!account) {
      res.json({
        available: false,
        reason: "No connected social account — connect one in the Accounts tab.",
      });
      return;
    }
    const platform = account.platform as SocialPlatform;
    const adapter = getSocialAdapter(platform);
    if (!adapter?.getAccountAnalytics) {
      res.json(unavailable("Own analytics (per-post)", platform));
      return;
    }
    const result = await adapter.getAccountAnalytics(
      account as unknown as Parameters<NonNullable<typeof adapter.getAccountAnalytics>>[0],
      { from, to },
    );
    res.json({ available: true, data: result });
  });

  // POST /companies/:companyId/social/hashtags/suggest
  // Body: { platform, text, niche? }
  // The self-built hashtag corpus (per the feasibility matrix) doesn't
  // exist yet, so no adapter implements suggestHashtags — keyed-off state
  // until the corpus lands. AI captions (DeepSeek) are separate and real.
  router.post("/companies/:companyId/social/hashtags/suggest", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const platform = String(req.body?.platform ?? "");
    const text = String(req.body?.text ?? "");
    const niche = typeof req.body?.niche === "string" ? req.body.niche : undefined;
    if (!isSocialPlatform(platform)) throw badRequest(`unknown platform: ${platform}`);
    const adapter = getSocialAdapter(platform);
    if (!adapter?.suggestHashtags) {
      res.json(unavailable("Hashtag suggestions", platform));
      return;
    }
    const suggestions = await adapter.suggestHashtags({ text, niche });
    res.json({ available: true, data: suggestions });
  });

  // GET /companies/:companyId/social/queue?accountId=...
  // Returns the per-account chronological queue (scheduled + draft) for the
  // Buffer-style queue view.
  router.get("/companies/:companyId/social/queue", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const accountId = typeof req.query.accountId === "string" ? req.query.accountId : null;

    const scheduled = await svc.listPosts(companyId, "scheduled");
    const drafts = await svc.listPosts(companyId, "draft");
    const all = [...scheduled, ...drafts];

    if (!accountId) {
      res.json(all);
      return;
    }
    // Filter to posts that target the requested account via post_targets.
    const withTargets = await Promise.all(
      all.map(async (p) => ({ post: p, targets: await svc.getPostTargets(p.id) })),
    );
    const filtered = withTargets
      .filter(({ targets }) => targets.some((t) => t.accountId === accountId))
      .map(({ post }) => post);
    res.json(filtered);
  });

  // ── Connect Wizard: per-platform app credentials ───────────────────────
  //
  // The SocialConnectWizard (UI) reads + writes these. Client secrets are
  // AES-256-GCM encrypted at rest; the API only returns the last 4 chars
  // for confirmation. One row per platform — credentials are instance-
  // wide (Tyler's Meta App / X app / Reddit app are shared across all
  // companies he runs from this instance).

  router.get("/social/wizard/specs", (_req, res) => {
    res.json({
      callbackBase: PAPERCLIP_SOCIAL_CALLBACK_BASE,
      specs: WIZARD_PLATFORM_SPECS,
    });
  });

  router.get("/social/credentials", async (_req, res) => {
    const all = await credentials.list();
    res.json(all);
  });

  router.get("/social/credentials/:platform", async (req, res) => {
    const platform = String(req.params.platform);
    if (!isSocialPlatform(platform)) throw badRequest(`unknown platform: ${platform}`);
    const row = await credentials.get(platform);
    if (!row) {
      res.json(null);
      return;
    }
    res.json(row);
  });

  router.put("/social/credentials/:platform", async (req, res) => {
    const platform = String(req.params.platform);
    if (!isSocialPlatform(platform)) throw badRequest(`unknown platform: ${platform}`);
    const clientId = typeof req.body?.clientId === "string" ? req.body.clientId.trim() : "";
    const clientSecret =
      typeof req.body?.clientSecret === "string" ? req.body.clientSecret.trim() : "";
    if (!clientId) throw badRequest("clientId is required");
    if (!clientSecret) throw badRequest("clientSecret is required");
    const actor = getActorInfo(req);
    const saved = await credentials.save({
      platform,
      clientId,
      clientSecret,
      redirectUri:
        typeof req.body?.redirectUri === "string"
          ? req.body.redirectUri
          : `${PAPERCLIP_SOCIAL_CALLBACK_BASE}/${platform}`,
      createdBy: actor.actorId,
    });
    res.status(201).json(saved);
  });

  router.delete("/social/credentials/:platform", async (req, res) => {
    const platform = String(req.params.platform);
    if (!isSocialPlatform(platform)) throw badRequest(`unknown platform: ${platform}`);
    const ok = await credentials.delete(platform);
    res.json({ deleted: ok });
  });

  router.post("/social/credentials/:platform/test", async (req, res) => {
    const platform = String(req.params.platform);
    if (!isSocialPlatform(platform)) throw badRequest(`unknown platform: ${platform}`);
    const clientId = typeof req.body?.clientId === "string" ? req.body.clientId : "";
    const clientSecret =
      typeof req.body?.clientSecret === "string" ? req.body.clientSecret : "";
    const result = testCredentialFormat(platform, clientId, clientSecret);
    const existing = await credentials.get(platform);
    if (existing) {
      await credentials.markValidation(platform, result);
    }
    res.json(result);
  });

  // ── Wizard step 4: launch + finish OAuth on platform's consent screen ─

  router.post("/companies/:companyId/social/wizard/:platform/authorize", async (req, res) => {
    const companyId = req.params.companyId as string;
    const platform = String(req.params.platform);
    assertCompanyAccess(req, companyId);
    if (!isSocialPlatform(platform)) throw badRequest(`unknown platform: ${platform}`);
    const spec = getWizardSpec(platform);
    if (!spec) throw badRequest(`${platform} is not yet supported by the connect wizard`);
    const creds = await credentials.get(platform);
    if (!creds) throw badRequest(`Save ${platform} app credentials before authorizing`);

    const state = randomBytes(24).toString("base64url");
    const redirectUri = creds.redirectUri ?? `${PAPERCLIP_SOCIAL_CALLBACK_BASE}/${platform}`;
    rememberOAuthState(state, {
      companyId,
      platform,
      redirectUri,
      createdAt: Date.now(),
    });
    const authUrl = buildOAuthAuthorizeUrl({
      spec,
      clientId: creds.clientId,
      redirectUri,
      state,
    });
    res.json({ authUrl, state, scopes: spec.oauth.scopes });
  });

  /**
   * OAuth callback — the platform redirects Tyler's browser here after he
   * grants consent. We exchange the `code` for real tokens against the
   * platform's token endpoint (Reddit + Meta family + X) and persist
   * accessToken / refreshToken / tokenExpiresAt / scope /
   * platformAccountId / username / displayName onto a `social_accounts`
   * row tagged `connectMethod: "wizard"`.
   *
   * Errors (`invalid_grant`, `redirect_uri_mismatch`, `invalid_scope`,
   * etc.) come back as a `TokenExchangeError` — the message gets rendered
   * into the callback HTML, which postMessages it to the wizard opener,
   * which renders it inline on the wizard's step-4 surface.
   */
  router.get("/auth/social-callback/:platform", async (req, res, next) => {
    try {
      const platform = String(req.params.platform);
      if (!isSocialPlatform(platform)) throw badRequest(`unknown platform: ${platform}`);
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const errorParam = typeof req.query.error === "string" ? req.query.error : null;
      const errorDescription =
        typeof req.query.error_description === "string" ? req.query.error_description : null;

      if (errorParam) {
        res
          .status(400)
          .send(callbackHtml({
            ok: false,
            platform,
            message: errorDescription ?? errorParam,
            errorCode: errorParam,
          }));
        return;
      }
      if (!state) {
        res
          .status(400)
          .send(callbackHtml({
            ok: false,
            platform,
            message: "Missing state parameter",
            errorCode: "missing_state",
          }));
        return;
      }
      const entry = consumeOAuthState(state);
      if (!entry || entry.platform !== platform) {
        res
          .status(400)
          .send(callbackHtml({
            ok: false,
            platform,
            message: "OAuth state expired or did not match — restart the wizard",
            errorCode: "invalid_state",
          }));
        return;
      }
      if (!code) {
        res
          .status(400)
          .send(callbackHtml({
            ok: false,
            platform,
            message: "Platform did not return an authorization code",
            errorCode: "missing_code",
          }));
        return;
      }

      const adapter = getSocialAdapter(platform);
      if (!adapter) {
        res
          .status(400)
          .send(callbackHtml({
            ok: false,
            platform,
            message: `${platform} adapter is not wired yet`,
            errorCode: "no_adapter",
          }));
        return;
      }
      const spec = getWizardSpec(platform);

      // Decrypt the app credentials Tyler saved in step 3 of the wizard.
      const creds = await credentials.getDecrypted(platform);
      if (!creds) {
        res
          .status(400)
          .send(callbackHtml({
            ok: false,
            platform,
            message: `Save ${platform} app credentials in the wizard before authorizing`,
            errorCode: "no_credentials",
          }));
        return;
      }

      // Real token exchange against the platform's token endpoint.
      let exchanged;
      try {
        exchanged = await exchangeCodeForTokens({
          platform,
          clientId: creds.clientId,
          clientSecret: creds.clientSecret,
          code,
          redirectUri: entry.redirectUri,
        });
      } catch (err) {
        const xerr =
          err instanceof TokenExchangeError
            ? err
            : new TokenExchangeError({
                platform,
                code: "unknown",
                status: 500,
                message: err instanceof Error ? err.message : String(err),
              });
        res
          .status(400)
          .send(callbackHtml({
            ok: false,
            platform,
            message: `Token exchange failed: ${xerr.message}`,
            errorCode: xerr.code,
          }));
        return;
      }

      const account = buildConnectedAccountFromTokens({
        platform,
        companyId: entry.companyId,
        tokens: exchanged,
      });

      const persisted = await svc.createAccount(entry.companyId, {
        platform: account.platform,
        platformAccountId: account.platformAccountId,
        displayName: account.displayName,
        username: account.username,
        avatarUrl: account.avatarUrl,
        accessToken: account.accessToken,
        refreshToken: account.refreshToken,
        tokenExpiresAt: account.tokenExpiresAt,
        status: account.status,
        metadata: account.metadata as Record<string, unknown> | null,
        scopes: exchanged.scope
          ? exchanged.scope.split(/[\s,]+/).filter(Boolean)
          : spec?.oauth.scopes ?? [],
        connectMethod: "wizard",
        createdBy: null,
      } as unknown as Parameters<typeof svc.createAccount>[1]);

      await logActivity(db, {
        companyId: entry.companyId,
        actorType: "system",
        actorId: "social-oauth-callback",
        action: "social.account.connected",
        entityType: "social_account",
        entityId: persisted.id,
        details: {
          platform,
          method: "wizard",
          handle: account.username,
          scope: exchanged.scope,
        },
      });

      res.status(200).send(callbackHtml({
        ok: true,
        platform,
        message: `Connected ${spec?.label ?? platform}${account.username ? ` (${account.username})` : ""}. You can close this tab.`,
        accountId: persisted.id,
      }));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/**
 * Tiny HTML page rendered into the OAuth callback popup/tab. Posts a
 * message back to the opener (the wizard) and auto-closes after 2s.
 */
function callbackHtml(opts: {
  ok: boolean;
  platform: string;
  message: string;
  accountId?: string;
  /** Machine-readable failure code (e.g. `invalid_grant`). */
  errorCode?: string;
}): string {
  const safeMessage = opts.message.replace(/[<>&"]/g, (ch) => {
    switch (ch) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "\"": return "&quot;";
      default: return ch;
    }
  });
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Paperclip — ${opts.platform} ${opts.ok ? "connected" : "error"}</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
      font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
      background: radial-gradient(circle at top, #1a1d2b, #0a0b13);
      color: #f4f4f5;
    }
    .card {
      max-width: 380px;
      padding: 2rem;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 14px;
      backdrop-filter: blur(8px);
      text-align: center;
    }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.6rem;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      background: ${opts.ok ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)"};
      color: ${opts.ok ? "#6ee7b7" : "#fca5a5"};
    }
    h1 { font-size: 1.1rem; margin: 1rem 0 0.5rem; }
    p { color: rgba(244,244,245,0.7); font-size: 0.92rem; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card" role="status">
    <span class="badge">${opts.ok ? "Connected" : "Error"}</span>
    <h1>Paperclip · ${opts.platform}</h1>
    <p>${safeMessage}</p>
  </div>
  <script>
    (function () {
      var payload = { type: "paperclip-social-callback", ok: ${opts.ok ? "true" : "false"}, platform: ${JSON.stringify(opts.platform)}, accountId: ${JSON.stringify(opts.accountId ?? null)}, message: ${JSON.stringify(opts.message)}, errorCode: ${JSON.stringify(opts.errorCode ?? null)} };
      try { if (window.opener) window.opener.postMessage(payload, "*"); } catch (e) {}
      setTimeout(function () { try { window.close(); } catch (e) {} }, 2000);
    })();
  </script>
</body>
</html>`;
}
