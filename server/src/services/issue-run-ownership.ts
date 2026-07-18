import { and, eq, gt, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { heartbeatRuns, issues } from "@paperclipai/db";
import { conflict } from "../errors.js";

export type IssueRunOwnership = { agentId: string; runId: string };
type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function assertIssueRunOwnership(
  tx: DbTransaction,
  issueId: string,
  companyId: string,
  ownership?: IssueRunOwnership,
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
        gt(issues.leaseExpiresAt, sql`now()`),
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
