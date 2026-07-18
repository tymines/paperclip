import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { heartbeatRuns, issues, issueWorkProducts } from "@paperclipai/db";
import type { IssueWorkProduct } from "@paperclipai/shared";
import { conflict } from "../errors.js";

type IssueWorkProductRow = typeof issueWorkProducts.$inferSelect;

function toIssueWorkProduct(row: IssueWorkProductRow): IssueWorkProduct {
  return {
    id: row.id,
    companyId: row.companyId,
    projectId: row.projectId ?? null,
    issueId: row.issueId,
    executionWorkspaceId: row.executionWorkspaceId ?? null,
    runtimeServiceId: row.runtimeServiceId ?? null,
    type: row.type as IssueWorkProduct["type"],
    provider: row.provider,
    externalId: row.externalId ?? null,
    title: row.title,
    url: row.url ?? null,
    status: row.status,
    reviewState: row.reviewState as IssueWorkProduct["reviewState"],
    isPrimary: row.isPrimary,
    healthStatus: row.healthStatus as IssueWorkProduct["healthStatus"],
    summary: row.summary ?? null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdByRunId: row.createdByRunId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function workProductService(db: Db) {
  type WorkProductTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
  type RunOwnership = { agentId: string; runId: string };

  async function assertRunOwnership(
    tx: WorkProductTransaction,
    issueId: string,
    companyId: string,
    ownership?: RunOwnership,
  ) {
    if (!ownership) return;
    const owned = await tx
      .update(issues)
      .set({ updatedAt: sql`${issues.updatedAt}` })
      .where(
        and(
          eq(issues.id, issueId),
          eq(issues.companyId, companyId),
          eq(issues.status, "in_progress"),
          eq(issues.assigneeAgentId, ownership.agentId),
          eq(issues.checkoutRunId, ownership.runId),
          or(isNull(issues.leaseExpiresAt), gt(issues.leaseExpiresAt, sql`now()`)),
          sql<boolean>`exists (
            select 1 from ${heartbeatRuns}
            where ${heartbeatRuns.id} = ${ownership.runId}
              and ${heartbeatRuns.agentId} = ${ownership.agentId}
              and ${heartbeatRuns.status} = 'running'
          )`,
        ),
      )
      .returning({ id: issues.id })
      .then((rows) => rows[0] ?? null);
    if (!owned) throw conflict("Issue checkout ownership conflict");
  }

  return {
    listForIssue: async (issueId: string) => {
      const rows = await db
        .select()
        .from(issueWorkProducts)
        .where(eq(issueWorkProducts.issueId, issueId))
        .orderBy(desc(issueWorkProducts.isPrimary), desc(issueWorkProducts.updatedAt));
      return rows.map(toIssueWorkProduct);
    },

    getById: async (id: string) => {
      const row = await db
        .select()
        .from(issueWorkProducts)
        .where(eq(issueWorkProducts.id, id))
        .then((rows) => rows[0] ?? null);
      return row ? toIssueWorkProduct(row) : null;
    },

    createForIssue: async (
      issueId: string,
      companyId: string,
      data: Omit<typeof issueWorkProducts.$inferInsert, "issueId" | "companyId">,
      options: { runOwnership?: RunOwnership } = {},
    ) => {
      const row = await db.transaction(async (tx) => {
        await assertRunOwnership(tx, issueId, companyId, options.runOwnership);
        if (data.isPrimary) {
          await tx
            .update(issueWorkProducts)
            .set({ isPrimary: false, updatedAt: new Date() })
            .where(
              and(
                eq(issueWorkProducts.companyId, companyId),
                eq(issueWorkProducts.issueId, issueId),
                eq(issueWorkProducts.type, data.type),
              ),
            );
        }
        return await tx
          .insert(issueWorkProducts)
          .values({
            ...data,
            companyId,
            issueId,
          })
          .returning()
          .then((rows) => rows[0] ?? null);
      });
      return row ? toIssueWorkProduct(row) : null;
    },

    update: async (
      id: string,
      patch: Partial<typeof issueWorkProducts.$inferInsert>,
      options: { runOwnership?: RunOwnership } = {},
    ) => {
      const row = await db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(issueWorkProducts)
          .where(eq(issueWorkProducts.id, id))
          .then((rows) => rows[0] ?? null);
        if (!existing) return null;
        await assertRunOwnership(tx, existing.issueId, existing.companyId, options.runOwnership);

        if (patch.isPrimary === true) {
          await tx
            .update(issueWorkProducts)
            .set({ isPrimary: false, updatedAt: new Date() })
            .where(
              and(
                eq(issueWorkProducts.companyId, existing.companyId),
                eq(issueWorkProducts.issueId, existing.issueId),
                eq(issueWorkProducts.type, existing.type),
              ),
            );
        }

        return await tx
          .update(issueWorkProducts)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(issueWorkProducts.id, id))
          .returning()
          .then((rows) => rows[0] ?? null);
      });
      return row ? toIssueWorkProduct(row) : null;
    },

    remove: async (id: string, options: { runOwnership?: RunOwnership } = {}) => {
      const row = await db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(issueWorkProducts)
          .where(eq(issueWorkProducts.id, id))
          .then((rows) => rows[0] ?? null);
        if (!existing) return null;
        await assertRunOwnership(tx, existing.issueId, existing.companyId, options.runOwnership);
        return tx
          .delete(issueWorkProducts)
          .where(eq(issueWorkProducts.id, id))
          .returning()
          .then((rows) => rows[0] ?? null);
      });
      return row ? toIssueWorkProduct(row) : null;
    },
  };
}

export { toIssueWorkProduct };
