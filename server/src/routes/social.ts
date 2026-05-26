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
  getSocialAdapter,
  listSupportedSocialPlatforms,
  socialCredentialsService,
  testCredentialFormat,
} from "../services/social-scheduler/index.js";
import { SOCIAL_PLATFORMS, type SocialPlatform } from "@paperclipai/shared";
import { notFound, badRequest } from "../errors.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

function isSocialPlatform(value: string): value is SocialPlatform {
  return (SOCIAL_PLATFORMS as readonly string[]).includes(value);
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

export function socialRoutes(db: Db) {
  const router = Router();
  const svc = socialService(db);
  const credentials = socialCredentialsService(db);

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
  // Returns { ok, supported, handle?, details?, reason? }.
  router.get("/companies/:companyId/social/accounts/:accountId/verify", async (req, res) => {
    const companyId = req.params.companyId as string;
    const accountId = req.params.accountId as string;
    assertCompanyAccess(req, companyId);
    const account = await svc.getAccount(accountId);
    if (!account || account.companyId !== companyId) {
      throw notFound("Social account not found");
    }
    const adapter = getSocialAdapter(account.platform as SocialPlatform);
    if (!adapter?.verifyAccount) {
      res.json({ ok: false, supported: false, reason: "verify not supported for this platform" });
      return;
    }
    try {
      const result = await adapter.verifyAccount(
        account as unknown as Parameters<NonNullable<typeof adapter.verifyAccount>>[0],
      );
      res.json({ ...result, supported: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // 200 (not 5xx) so the dot UI gets a JSON body — it differentiates
      // by `ok: false` + `reason` rather than HTTP status.
      res.status(200).json({ ok: false, supported: true, reason: message });
    }
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
  // Body: { platform }
  // Returns { authUrl, state } — caller redirects user to authUrl.
  router.post("/companies/:companyId/social/oauth/start", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const platform = String(req.body?.platform ?? "");
    if (!isSocialPlatform(platform)) throw badRequest(`unknown platform: ${platform}`);
    const adapter = getSocialAdapter(platform);
    if (!adapter) throw badRequest(`platform ${platform} is not yet wired`);
    const redirectUri =
      typeof req.body?.redirectUri === "string"
        ? req.body.redirectUri
        : `${req.protocol}://${req.get("host")}/social/oauth/callback`;
    const start = await adapter.startConnect({ companyId, redirectUri });
    res.json(start);
  });

  // POST /companies/:companyId/social/oauth/finish
  // Body: { platform, code, state }
  // Returns the persisted SocialAccount row (token redacted).
  router.post("/companies/:companyId/social/oauth/finish", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const platform = String(req.body?.platform ?? "");
    const code = String(req.body?.code ?? "");
    const state = String(req.body?.state ?? "");
    if (!isSocialPlatform(platform)) throw badRequest(`unknown platform: ${platform}`);
    const adapter = getSocialAdapter(platform);
    if (!adapter) throw badRequest(`platform ${platform} is not yet wired`);

    const stubAccount = await adapter.finishConnect({ code, state, companyId });
    const actor = getActorInfo(req);
    // Persist into our DB so the rest of the UI can use the account.
    const persisted = await svc.createAccount(companyId, {
      platform: stubAccount.platform,
      platformAccountId: stubAccount.platformAccountId,
      displayName: stubAccount.displayName,
      username: stubAccount.username,
      avatarUrl: stubAccount.avatarUrl,
      accessToken: stubAccount.accessToken,
      refreshToken: stubAccount.refreshToken,
      tokenExpiresAt: stubAccount.tokenExpiresAt,
      status: stubAccount.status,
      metadata: stubAccount.metadata as Record<string, unknown> | null,
      createdBy: actor.actorId,
    });
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "social.account.connected",
      entityType: "social_account",
      entityId: persisted.id,
      details: { platform, stub: true },
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

    // Cast: socialAccounts rows store platform as `text` so TS widens to
    // `string` even though we only ever insert values from SocialPlatform.
    const adapterAccount = account as unknown as Parameters<typeof adapter.listRecentPosts>[0];
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

  // GET /companies/:companyId/social/inbox?accountId=...
  router.get("/companies/:companyId/social/inbox", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const accountId = typeof req.query.accountId === "string" ? req.query.accountId : null;

    const accounts = await svc.listAccounts(companyId);
    const targets = accountId
      ? accounts.filter((a) => a.id === accountId)
      : accounts.filter((a) => a.status === "connected");

    const out: Array<{ accountId: string; platform: string; threads: unknown[] }> = [];
    for (const account of targets) {
      const adapter = getSocialAdapter(account.platform as SocialPlatform);
      if (!adapter?.listDirectMessageThreads) {
        out.push({ accountId: account.id, platform: account.platform, threads: [] });
        continue;
      }
      try {
        const threads = await adapter.listDirectMessageThreads(
          account as unknown as Parameters<NonNullable<typeof adapter.listDirectMessageThreads>>[0],
          { limit: 30 },
        );
        out.push({ accountId: account.id, platform: account.platform, threads });
      } catch (err) {
        out.push({
          accountId: account.id,
          platform: account.platform,
          threads: [],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
      }
    }
    res.json(out);
  });

  // GET /companies/:companyId/social/inbox/:accountId/:threadId
  router.get("/companies/:companyId/social/inbox/:accountId/:threadId", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const accountId = req.params.accountId as string;
    const threadId = req.params.threadId as string;
    const account = await svc.getAccount(accountId);
    if (!account || account.companyId !== companyId) throw notFound("account");
    const adapter = getSocialAdapter(account.platform as SocialPlatform);
    if (!adapter?.listDirectMessages) {
      res.json([]);
      return;
    }
    const messages = await adapter.listDirectMessages(
      account as unknown as Parameters<NonNullable<typeof adapter.listDirectMessages>>[0],
      threadId,
    );
    res.json(messages);
  });

  // POST /companies/:companyId/social/inbox/:accountId/:threadId/send
  // Body: { text }
  router.post("/companies/:companyId/social/inbox/:accountId/:threadId/send", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const accountId = req.params.accountId as string;
    const threadId = req.params.threadId as string;
    const text = typeof req.body?.text === "string" ? req.body.text : "";
    if (!text.trim()) throw badRequest("text is required");
    const account = await svc.getAccount(accountId);
    if (!account || account.companyId !== companyId) throw notFound("account");
    const adapter = getSocialAdapter(account.platform as SocialPlatform);
    if (!adapter?.sendDirectMessage) throw badRequest("platform does not support sending DMs");
    const message = await adapter.sendDirectMessage(
      account as unknown as Parameters<NonNullable<typeof adapter.sendDirectMessage>>[0],
      threadId,
      text,
    );
    res.status(201).json(message);
  });

  // GET /companies/:companyId/social/competitors/search?platform=...&q=...
  router.get("/companies/:companyId/social/competitors/search", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const platform = String(req.query.platform ?? "");
    const query = String(req.query.q ?? "");
    if (!isSocialPlatform(platform)) throw badRequest(`unknown platform: ${platform}`);
    const adapter = getSocialAdapter(platform);
    if (!adapter?.searchCompetitors) {
      res.json([]);
      return;
    }
    const results = await adapter.searchCompetitors(query);
    res.json(results);
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
      res.json({ byDay: [], topPosts: [] });
      return;
    }
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 86_400_000);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    const metrics = await adapter.getCompetitorMetrics(handle, { from, to });
    res.json(metrics);
  });

  // GET /companies/:companyId/social/analytics?accountId=...&from=...&to=...
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
      res.json({ followers: [], engagement: [], bestTimes: [], topPosts: [], topHashtags: [] });
      return;
    }
    const adapter = getSocialAdapter(account.platform as SocialPlatform);
    if (!adapter?.getAccountAnalytics) {
      res.json({ followers: [], engagement: [], bestTimes: [], topPosts: [], topHashtags: [] });
      return;
    }
    const result = await adapter.getAccountAnalytics(
      account as unknown as Parameters<NonNullable<typeof adapter.getAccountAnalytics>>[0],
      { from, to },
    );
    res.json(result);
  });

  // POST /companies/:companyId/social/hashtags/suggest
  // Body: { platform, text, niche? }
  router.post("/companies/:companyId/social/hashtags/suggest", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const platform = String(req.body?.platform ?? "");
    const text = String(req.body?.text ?? "");
    const niche = typeof req.body?.niche === "string" ? req.body.niche : undefined;
    if (!isSocialPlatform(platform)) throw badRequest(`unknown platform: ${platform}`);
    const adapter = getSocialAdapter(platform);
    if (!adapter?.suggestHashtags) {
      res.json([]);
      return;
    }
    const suggestions = await adapter.suggestHashtags({ text, niche });
    res.json(suggestions);
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
   * grants consent. In v2 we don't actually exchange the code for tokens
   * against the live API (that requires Tyler to have real apps in App
   * Review); instead we record the connect as successful, persist a
   * stub-shaped row tagged `connectMethod: "wizard"`, and let the publish
   * worker pull tokens from credentials when it's time to call the API.
   *
   * In v3+ the wizard will hit the platform's token endpoint here using
   * the stored client secret, then store the encrypted tokens on the
   * social_accounts row.
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
          }));
        return;
      }
      if (!state) {
        res
          .status(400)
          .send(callbackHtml({ ok: false, platform, message: "Missing state parameter" }));
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
          }));
        return;
      }
      const spec = getWizardSpec(platform);

      const stubAccount = await adapter.finishConnect({
        code: code || "wizard_stub_code",
        state,
        companyId: entry.companyId,
      });
      const persisted = await svc.createAccount(entry.companyId, {
        platform: stubAccount.platform,
        platformAccountId: stubAccount.platformAccountId,
        displayName: stubAccount.displayName,
        username: stubAccount.username,
        avatarUrl: stubAccount.avatarUrl,
        accessToken: stubAccount.accessToken,
        refreshToken: stubAccount.refreshToken,
        tokenExpiresAt: stubAccount.tokenExpiresAt,
        status: stubAccount.status,
        metadata: stubAccount.metadata as Record<string, unknown> | null,
        scopes: spec?.oauth.scopes ?? [],
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
        details: { platform, method: "wizard" },
      });

      res.status(200).send(callbackHtml({
        ok: true,
        platform,
        message: `Connected ${spec?.label ?? platform}. You can close this tab.`,
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
      var payload = { type: "paperclip-social-callback", ok: ${opts.ok ? "true" : "false"}, platform: ${JSON.stringify(opts.platform)}, accountId: ${JSON.stringify(opts.accountId ?? null)}, message: ${JSON.stringify(opts.message)} };
      try { if (window.opener) window.opener.postMessage(payload, "*"); } catch (e) {}
      setTimeout(function () { try { window.close(); } catch (e) {} }, 2000);
    })();
  </script>
</body>
</html>`;
}
