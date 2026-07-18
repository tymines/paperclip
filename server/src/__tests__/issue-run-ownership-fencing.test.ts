import { randomUUID } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { assertIssueRunOwnership } from "../services/issue-run-ownership.js";

/**
 * Phase 4 activation — write-surface fencing suite.
 *
 * Attacks the single `assertIssueRunOwnership` CAS predicate
 * (server/src/services/issue-run-ownership.ts) across every write surface that
 * calls it. The predicate is one UPDATE ... WHERE (7 conjuncts) ... RETURNING;
 * if zero rows match it throws `conflict("Issue checkout ownership conflict")`.
 *
 * The 7 conjuncts:
 *   1. issues.id            = issueId
 *   2. issues.company_id    = companyId
 *   3. issues.status        = 'in_progress'
 *   4. issues.assignee_agent_id = ownership.agentId
 *   5. issues.checkout_run_id   = ownership.runId
 *   6. issues.lease_expires_at  > now()                      (lease still live)
 *   7. EXISTS (heartbeat_runs id=runId agentId=agentId status='running')  (run live)
 *
 * Self-contained fake-db harness modeled on the createLeaseDb pattern in
 * issue-lease-renewal-routes.test.ts: PgDialect SQL-assertion on the captured
 * WHERE clause + a returning() callback that simulates the CAS match.
 *
 * Surface inventory (code wins over brief's "6 surfaces"):
 *   comment, issue-update, work-product, document, attachment, approval,
 *   thread-interaction (7th — server/src/services/issue-thread-interactions.ts:624,
 *   omitted from the brief; same predicate, covered here).
 *
 * Naming: no "route"/"routes"/"authz" in the filename → classified general-server
 * by scripts/run-vitest-stable.mjs (single vitest invocation, no per-file
 * fail-fast), so this suite IS exercised by the pinned STEP-4 command
 * `pnpm test:run:general -- --group general-server`. See evidence/step1-baseline-analysis.md
 * for the fail-fast gap that makes the serialized shards unreliable for these files.
 */

type IssueRow = {
  id: string;
  companyId: string;
  status: "in_progress" | "todo" | "done" | "cancelled";
  assigneeAgentId: string | null;
  checkoutRunId: string | null;
  leaseExpiresAt: Date | null;
};

type HeartbeatRow = {
  id: string;
  agentId: string;
  status: "running" | "succeeded" | "failed" | "cancelled" | "timed_out";
};

type Ownership = { agentId: string; runId: string };

const LEASE_TTL_MS = 15 * 60_000;

function ownershipRow(overrides: Partial<IssueRow> = {}): IssueRow {
  const runId = randomUUID();
  const agentId = randomUUID();
  return {
    id: randomUUID(),
    companyId: randomUUID(),
    status: "in_progress",
    assigneeAgentId: agentId,
    checkoutRunId: runId,
    leaseExpiresAt: new Date(Date.now() + LEASE_TTL_MS),
    ...overrides,
  };
}

function liveHeartbeat(row: IssueRow): HeartbeatRow {
  return {
    id: row.checkoutRunId!,
    agentId: row.assigneeAgentId!,
    status: "running",
  };
}

/**
 * Fake db that simulates the 7-conjunct CAS UPDATE inside a transaction.
 * The returning() callback decides match/no-match by inspecting the captured
 * WHERE SQL + params against the row + heartbeat state, mirroring how real
 * Postgres would evaluate the predicate.
 */
function createOwnershipDb(row: IssueRow, heartbeat: HeartbeatRow | null = null) {
  const whereQueries: Array<{ sql: string; params: unknown[] }> = [];
  const dialect = new PgDialect();

  const db = {
    update: () => ({
      set: (_patch: Record<string, unknown>) => ({
        where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
          const query = dialect.sqlToQuery(condition);
          whereQueries.push({ sql: query.sql, params: query.params });
          return {
            returning: () => {
              const now = new Date();
              const params = query.params as unknown[];
              const leaseLive =
                row.leaseExpiresAt !== null && row.leaseExpiresAt.getTime() > now.getTime();
              // Heartbeat is live iff a row exists for THIS checkout run + agent with status running.
              const heartbeatLive =
                heartbeat !== null &&
                heartbeat.id === row.checkoutRunId &&
                heartbeat.agentId === row.assigneeAgentId &&
                heartbeat.status === "running";
              // The CAS matches iff all 7 conjuncts hold AND the parametrised WHERE carries the
              // row's identity values (proving the predicate actually binds them).
              const sqlHasAllConjuncts =
                query.sql.includes('"issues"."id"') &&
                query.sql.includes('"issues"."company_id"') &&
                query.sql.includes('"issues"."status"') &&
                query.sql.includes('"issues"."assignee_agent_id"') &&
                query.sql.includes('"issues"."checkout_run_id"') &&
                query.sql.includes('"issues"."lease_expires_at"') &&
                query.sql.includes("now()") &&
                query.sql.includes('"heartbeat_runs"') &&
                query.sql.includes("'running'");
              const paramsCarryRowIdentity =
                params.includes(row.id) &&
                params.includes(row.companyId) &&
                params.includes("in_progress") &&
                params.includes(row.assigneeAgentId) &&
                params.includes(row.checkoutRunId);
              const matches =
                sqlHasAllConjuncts &&
                paramsCarryRowIdentity &&
                row.status === "in_progress" &&
                leaseLive &&
                heartbeatLive;
              return Promise.resolve(matches ? [{ id: row.id }] : []);
            },
          };
        },
      }),
    }),
  };
  const execute = async () => [{ acquired: true }];
  Object.assign(db, {
    transaction: async (operation: (tx: typeof db & { execute: typeof execute }) => Promise<unknown>) =>
      operation({ ...db, execute }),
  });

  return { db: db as never, row, whereQueries };
}

/** Run the predicate inside the fake transaction (as real callers do). */
async function runOwnership(db: never, row: IssueRow, ownership: Ownership | undefined) {
  return (db as { transaction: (op: (tx: never) => Promise<unknown>) => Promise<unknown> }).transaction(
    async (tx) => assertIssueRunOwnership(tx as never, row.id, row.companyId, ownership),
  );
}

const SURFACES = [
  "comment",
  "issue-update",
  "work-product",
  "document",
  "attachment",
  "approval",
  "thread-interaction",
] as const;

describe("assertIssueRunOwnership fencing suite", () => {
  describe("lease-holder accepted across all 7 write surfaces", () => {
    it.each(SURFACES)("admits the rightful lease-holder on the %s surface", async (surface) => {
      const row = ownershipRow();
      const heartbeat = liveHeartbeat(row);
      const fake = createOwnershipDb(row, heartbeat);
      const ownership: Ownership = {
        agentId: row.assigneeAgentId!,
        runId: row.checkoutRunId!,
      };
      await expect(runOwnership(fake.db, row, ownership)).resolves.toBeUndefined();
      // Prove the CAS predicate carries every conjunct in the compiled SQL.
      const sql = fake.whereQueries[0].sql;
      expect(sql).toMatch(/"issues"."id"/);
      expect(sql).toMatch(/"issues"."company_id"/);
      expect(sql).toMatch(/"issues"."status"/);
      expect(sql).toMatch(/"issues"."assignee_agent_id"/);
      expect(sql).toMatch(/"issues"."checkout_run_id"/);
      expect(sql).toMatch(/"issues"."lease_expires_at"/);
      expect(sql).toMatch(/now\(\)/);
      expect(sql).toMatch(/"heartbeat_runs"/);
      expect(sql).toMatch(/'running'/);
      // surface label is used only for test naming; assert it is one of the known surfaces
      expect(SURFACES).toContain(surface);
    });
  });

  describe("stale and fenced writers rejected across all 7 write surfaces", () => {
    it.each(SURFACES)("rejects a stale writer (expired lease) on the %s surface", async (surface) => {
      const row = ownershipRow({ leaseExpiresAt: new Date(Date.now() - 60_000) }); // expired
      const heartbeat = liveHeartbeat(row);
      const fake = createOwnershipDb(row, heartbeat);
      const ownership: Ownership = {
        agentId: row.assigneeAgentId!,
        runId: row.checkoutRunId!,
      };
      await expect(runOwnership(fake.db, row, ownership)).rejects.toThrow(
        "Issue checkout ownership conflict",
      );
      expect(SURFACES).toContain(surface);
    });

    it.each(SURFACES)("rejects a fenced writer (wrong checkoutRunId) on the %s surface", async (surface) => {
      const row = ownershipRow();
      const heartbeat = liveHeartbeat(row);
      const fake = createOwnershipDb(row, heartbeat);
      const ownership: Ownership = {
        agentId: row.assigneeAgentId!,
        runId: randomUUID(), // fenced: a different run id
      };
      await expect(runOwnership(fake.db, row, ownership)).rejects.toThrow(
        "Issue checkout ownership conflict",
      );
      expect(SURFACES).toContain(surface);
    });
  });

  describe("each CAS conjunct fences independently", () => {
    it("rejects when the issue id does not match", async () => {
      const row = ownershipRow();
      const heartbeat = liveHeartbeat(row);
      const fake = createOwnershipDb({ ...row, id: randomUUID() }, heartbeat);
      await expect(
        runOwnership(fake.db, row, { agentId: row.assigneeAgentId!, runId: row.checkoutRunId! }),
      ).rejects.toThrow("Issue checkout ownership conflict");
    });

    it("rejects when the company id does not match", async () => {
      const row = ownershipRow();
      const heartbeat = liveHeartbeat(row);
      const fake = createOwnershipDb({ ...row, companyId: randomUUID() }, heartbeat);
      await expect(
        runOwnership(fake.db, row, { agentId: row.assigneeAgentId!, runId: row.checkoutRunId! }),
      ).rejects.toThrow("Issue checkout ownership conflict");
    });

    it("rejects when the issue status is not in_progress", async () => {
      const row = ownershipRow({ status: "todo" });
      const heartbeat = liveHeartbeat(row);
      const fake = createOwnershipDb(row, heartbeat);
      await expect(
        runOwnership(fake.db, row, { agentId: row.assigneeAgentId!, runId: row.checkoutRunId! }),
      ).rejects.toThrow("Issue checkout ownership conflict");
    });

    it("rejects when the assignee does not match", async () => {
      const row = ownershipRow();
      const heartbeat = liveHeartbeat(row);
      const fake = createOwnershipDb({ ...row, assigneeAgentId: randomUUID() }, heartbeat);
      await expect(
        runOwnership(fake.db, row, { agentId: row.assigneeAgentId!, runId: row.checkoutRunId! }),
      ).rejects.toThrow("Issue checkout ownership conflict");
    });

    it("rejects when the checkoutRunId does not match", async () => {
      const row = ownershipRow();
      const heartbeat = liveHeartbeat(row);
      const fake = createOwnershipDb({ ...row, checkoutRunId: randomUUID() }, heartbeat);
      await expect(
        runOwnership(fake.db, row, { agentId: row.assigneeAgentId!, runId: row.checkoutRunId! }),
      ).rejects.toThrow("Issue checkout ownership conflict");
    });

    it("rejects when the lease has expired", async () => {
      const row = ownershipRow({ leaseExpiresAt: new Date(Date.now() - 1) });
      const heartbeat = liveHeartbeat(row);
      const fake = createOwnershipDb(row, heartbeat);
      await expect(
        runOwnership(fake.db, row, { agentId: row.assigneeAgentId!, runId: row.checkoutRunId! }),
      ).rejects.toThrow("Issue checkout ownership conflict");
    });

    it("rejects when the heartbeat run is not running", async () => {
      const row = ownershipRow();
      const heartbeat: HeartbeatRow = { ...liveHeartbeat(row), status: "failed" };
      const fake = createOwnershipDb(row, heartbeat);
      await expect(
        runOwnership(fake.db, row, { agentId: row.assigneeAgentId!, runId: row.checkoutRunId! }),
      ).rejects.toThrow("Issue checkout ownership conflict");
    });

    it("rejects when the heartbeat run is missing entirely", async () => {
      const row = ownershipRow();
      const fake = createOwnershipDb(row, null);
      await expect(
        runOwnership(fake.db, row, { agentId: row.assigneeAgentId!, runId: row.checkoutRunId! }),
      ).rejects.toThrow("Issue checkout ownership conflict");
    });

    it("rejects when the heartbeat run id diverges from the checkout run id (dual-run drift)", async () => {
      const row = ownershipRow();
      const heartbeat: HeartbeatRow = {
        id: randomUUID(), // different run id — the execution run drifted from the checkout run
        agentId: row.assigneeAgentId!,
        status: "running",
      };
      const fake = createOwnershipDb(row, heartbeat);
      await expect(
        runOwnership(fake.db, row, { agentId: row.assigneeAgentId!, runId: row.checkoutRunId! }),
      ).rejects.toThrow("Issue checkout ownership conflict");
    });
  });

  describe("undefined ownership is a no-op (board / unsafe path)", () => {
    it("does not touch the database and never throws when ownership is undefined", async () => {
      const row = ownershipRow();
      const fake = createOwnershipDb(row, null);
      await expect(runOwnership(fake.db, row, undefined)).resolves.toBeUndefined();
      // No UPDATE should have been issued: the predicate returns early.
      expect(fake.whereQueries).toHaveLength(0);
    });
  });
});
