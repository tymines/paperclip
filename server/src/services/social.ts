import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { socialAccounts, socialPosts, socialPostTargets } from "@paperclipai/db";

export function socialService(db: Db) {
  return {
    // ── Accounts ──────────────────────────────────────────────────────────────
    listAccounts: (companyId: string) =>
      db
        .select()
        .from(socialAccounts)
        .where(eq(socialAccounts.companyId, companyId))
        .orderBy(desc(socialAccounts.createdAt)),

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
    ) => {
      // Drizzle PgTimestamp expects Date objects, not ISO strings
      const insertData = { ...data, companyId } as Record<string, unknown>;
      if (insertData.scheduledAt && typeof insertData.scheduledAt === "string") {
        insertData.scheduledAt = new Date(insertData.scheduledAt as string);
      }
      if (insertData.publishedAt && typeof insertData.publishedAt === "string") {
        insertData.publishedAt = new Date(insertData.publishedAt as string);
      }
      const [post] = await db
        .insert(socialPosts)
        .values(insertData as typeof socialPosts.$inferInsert)
        .returning();

      if (accountIds.length > 0) {
        // Look up account platforms
        const accounts = await db
          .select({ id: socialAccounts.id, platform: socialAccounts.platform })
          .from(socialAccounts)
          .where(
            and(
              eq(socialAccounts.companyId, companyId),
              inArray(socialAccounts.id, accountIds),
            ),
          );

        if (accounts.length > 0) {
          await db.insert(socialPostTargets).values(
            accounts.map((account) => ({
              postId: post.id,
              accountId: account.id,
              platform: account.platform,
              status: data.scheduledAt ? "scheduled" : "draft",
            })),
          );
        }
      }

      const targets = await db
        .select()
        .from(socialPostTargets)
        .where(eq(socialPostTargets.postId, post.id));

      return { ...post, targets };
    },

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
