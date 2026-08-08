import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { socialAccounts, socialPosts, socialPostTargets } from "@paperclipai/db";
import type { CreatorSocialPublishCapability, SocialAccount, SocialPlatform } from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../errors.js";
import { getSocialAdapter, hasRealAccessToken } from "./social-scheduler/index.js";

export function socialPublishCapability(account: SocialAccount): CreatorSocialPublishCapability {
  if (account.status !== "connected") {
    return { available: false, reason: `Reconnect ${account.displayName} in Social: the account status is ${account.status}.` };
  }
  if (!getSocialAdapter(account.platform as SocialPlatform)) {
    return { available: false, reason: `${account.platform} publishing is unavailable because no server adapter is configured.` };
  }
  if (!hasRealAccessToken(account)) {
    return { available: false, reason: `Reconnect ${account.displayName} in Social: no real platform access token is available.` };
  }
  return { available: true, reason: null };
}

export function socialService(db: Db) {
  return {
    // ── Accounts ──────────────────────────────────────────────────────────────
    listAccounts: (companyId: string) =>
      db
        .select()
        .from(socialAccounts)
        .where(eq(socialAccounts.companyId, companyId))
        .orderBy(desc(socialAccounts.createdAt)),

    listAccountsWithPublishCapability: async (companyId: string) => {
      const accounts = await db.select().from(socialAccounts)
        .where(eq(socialAccounts.companyId, companyId))
        .orderBy(desc(socialAccounts.createdAt));
      return accounts.map((account) => ({
        ...account,
        publishCapability: socialPublishCapability(account as unknown as SocialAccount),
      }));
    },

    getAccount: (id: string) =>
      db
        .select()
        .from(socialAccounts)
        .where(eq(socialAccounts.id, id))
        .then((rows) => rows[0] ?? null),

    createAccount: (companyId: string, data: Omit<typeof socialAccounts.$inferInsert, "companyId">) =>
      db
        .insert(socialAccounts)
        .values({ ...data, companyId })
        .returning()
        .then((rows) => rows[0]),

    updateAccount: (id: string, data: Partial<typeof socialAccounts.$inferInsert>) =>
      db
        .update(socialAccounts)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(socialAccounts.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),

    deleteAccount: (id: string) =>
      db
        .delete(socialAccounts)
        .where(eq(socialAccounts.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),

    // ── Posts ─────────────────────────────────────────────────────────────────
    listPosts: (companyId: string, status?: string) => {
      const conditions = [eq(socialPosts.companyId, companyId)];
      if (status) conditions.push(eq(socialPosts.status, status));
      return db
        .select()
        .from(socialPosts)
        .where(and(...conditions))
        .orderBy(desc(socialPosts.createdAt));
    },

    getPost: (id: string) =>
      db
        .select()
        .from(socialPosts)
        .where(eq(socialPosts.id, id))
        .then((rows) => rows[0] ?? null),

    getPostTargets: (postId: string) =>
      db
        .select()
        .from(socialPostTargets)
        .where(eq(socialPostTargets.postId, postId))
        .orderBy(socialPostTargets.createdAt),

    createPost: async (
      companyId: string,
      data: Omit<typeof socialPosts.$inferInsert, "companyId">,
      accountIds: string[],
    ) => db.transaction(async (tx) => {
      // Drizzle PgTimestamp expects Date objects, not ISO strings
      const insertData = { ...data, companyId } as Record<string, unknown>;
      if (insertData.scheduledAt && typeof insertData.scheduledAt === "string") {
        insertData.scheduledAt = new Date(insertData.scheduledAt as string);
      }
      if (insertData.publishedAt && typeof insertData.publishedAt === "string") {
        insertData.publishedAt = new Date(insertData.publishedAt as string);
      }
      const uniqueAccountIds = [...new Set(accountIds)];
      const accounts = uniqueAccountIds.length > 0
        ? await tx
          .select({ id: socialAccounts.id, platform: socialAccounts.platform })
          .from(socialAccounts)
          .where(and(eq(socialAccounts.companyId, companyId), inArray(socialAccounts.id, uniqueAccountIds)))
        : [];
      if (accounts.length !== uniqueAccountIds.length) {
        throw unprocessable("Every target account must belong to this company");
      }
      if (insertData.scheduledAt && accounts.length === 0) {
        throw unprocessable("Scheduled posts require at least one target account");
      }
      const [post] = await tx
        .insert(socialPosts)
        .values(insertData as typeof socialPosts.$inferInsert)
        .returning();

      if (accounts.length > 0) {
          await tx.insert(socialPostTargets).values(
            accounts.map((account) => ({
              postId: post.id,
              accountId: account.id,
              platform: account.platform,
              status: data.scheduledAt ? "scheduled" : "draft",
            })),
          );
      }

      const targets = await tx
        .select()
        .from(socialPostTargets)
        .where(eq(socialPostTargets.postId, post.id));

      return { ...post, targets };
    }),

    scheduleExistingDraft: (
      companyId: string,
      postId: string,
      accountIds: string[],
      scheduledAt: Date,
      publishConfirmedAt: Date,
    ) => db.transaction(async (tx) => {
      const uniqueAccountIds = [...new Set(accountIds)];
      if (uniqueAccountIds.length === 0) throw unprocessable("Select at least one target account");
      const post = await tx.select().from(socialPosts)
        .where(and(eq(socialPosts.id, postId), eq(socialPosts.companyId, companyId)))
        .then((rows) => rows[0] ?? null);
      if (!post) throw notFound("Social draft not found");
      if (post.status !== "draft") throw conflict("Only drafts can be scheduled");
      const existingTargets = await tx.select({ id: socialPostTargets.id }).from(socialPostTargets)
        .where(eq(socialPostTargets.postId, postId));
      if (existingTargets.length > 0) throw conflict("Draft already has target accounts");
      const accounts = await tx.select()
        .from(socialAccounts)
        .where(and(
          eq(socialAccounts.companyId, companyId),
          inArray(socialAccounts.id, uniqueAccountIds),
        ));
      if (accounts.length !== uniqueAccountIds.length) {
        throw unprocessable("Every target must be an account owned by this company");
      }
      const unavailable = accounts
        .map((account) => ({ account, capability: socialPublishCapability(account as unknown as SocialAccount) }))
        .find(({ capability }) => !capability.available);
      if (unavailable) {
        throw unprocessable(unavailable.capability.reason ?? `Reconnect ${unavailable.account.displayName} in Social before scheduling.`);
      }
      const [updated] = await tx.update(socialPosts).set({
        status: "scheduled",
        scheduledAt,
        metadata: {
          ...((post.metadata && typeof post.metadata === "object") ? post.metadata : {}),
          creatorPublishConfirmedAt: publishConfirmedAt.toISOString(),
        },
        updatedAt: new Date(),
      }).where(and(eq(socialPosts.id, postId), eq(socialPosts.status, "draft"))).returning();
      if (!updated) throw conflict("Draft was scheduled concurrently");
      const targets = await tx.insert(socialPostTargets).values(accounts.map((account) => ({
        postId,
        accountId: account.id,
        platform: account.platform,
        status: "scheduled",
      }))).returning();
      return { ...updated, targets };
    }),

    updatePost: (id: string, data: Partial<typeof socialPosts.$inferInsert>) => {
      const setData = { ...data, updatedAt: new Date() } as Record<string, unknown>;
      if (setData.scheduledAt && typeof setData.scheduledAt === "string") {
        setData.scheduledAt = new Date(setData.scheduledAt as string);
      }
      if (setData.publishedAt && typeof setData.publishedAt === "string") {
        setData.publishedAt = new Date(setData.publishedAt as string);
      }
      return db
        .update(socialPosts)
        .set(setData as Partial<typeof socialPosts.$inferInsert>)
        .where(eq(socialPosts.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
    },

    deletePost: (id: string) =>
      db
        .delete(socialPosts)
        .where(eq(socialPosts.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),

    // ── Post Targets ─────────────────────────────────────────────────────────
    updatePostTarget: (id: string, data: Partial<typeof socialPostTargets.$inferInsert>) =>
      db
        .update(socialPostTargets)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(socialPostTargets.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),

    addPostTarget: (data: typeof socialPostTargets.$inferInsert) =>
      db
        .insert(socialPostTargets)
        .values(data)
        .returning()
        .then((rows) => rows[0]),

    removePostTarget: (id: string) =>
      db
        .delete(socialPostTargets)
        .where(eq(socialPostTargets.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),
  };
}
