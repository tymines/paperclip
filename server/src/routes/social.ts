import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createSocialAccountSchema,
  updateSocialAccountSchema,
  createSocialPostSchema,
  updateSocialPostSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { socialService, logActivity } from "../services/index.js";
import {
  getSocialAdapter,
  listSupportedSocialPlatforms,
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

export function socialRoutes(db: Db) {
  const router = Router();
  const svc = socialService(db);

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

  return router;
}
