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
import { notFound } from "../errors.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

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

  return router;
}
