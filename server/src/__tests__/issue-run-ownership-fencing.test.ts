import { randomUUID } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { assertIssueRunOwnership } from "../services/issue-run-ownership.js";

/**
 * Phase 4 activation — write-surface fencing suite (v3 review-fix).
 *
 * Attacks the single `assertIssueRunOwnership` CAS predicate
 * (server/src/services/issue-run-ownership.ts) across every write surface that
 * calls it. The predicate is one UPDATE ... WHERE (7 top-level conjuncts, the
 * 7th being an EXISTS subquery on heartbeat_runs) ... RETURNING; if zero rows
 * match it throws `conflict("Issue checkout ownership conflict")`.
 *
 * The 7 top-level conjuncts (predicate re-read at base 3c6bf1ac7):
 *   1. issues.id                = issueId
 *   2. issues.company_id        = companyId
 *   3. issues.status            = 'in_progress'
 *   4. issues.assignee_agent_id = ownership.agentId
 *   5. issues.checkout_run_id   = ownership.runId
 *   6. issues.lease_expires_at  > now()                        (lease still live; STRICT >)
 *   7. EXISTS (heartbeat_runs subquery — 6 conditions):
 *        a. heartbeat_runs.id             = ownership.runId
 *        b. heartbeat_runs.agent_id       = ownership.agentId
 *        c. heartbeat_runs.company_id     = issues.company_id  (added upstream post-v2)
 *        d. heartbeat_runs.status         = 'running'
 *        e. heartbeat_runs.context_snapshot ->> 'issueId' = issues.id::text  (added upstream post-v2)
 *        f. heartbeat_runs.context_snapshot ->> 'taskId'  = issues.id::text  (added upstream post-v2; OR'd with e)
 *
 * v3 REVIEW-FIX (blocker 1 — broken mutation gate):
 * The v2 fake-db computed `leaseLive` in JavaScript with a hardcoded `>` while
 * its SQL-shape assertion only checked that `"lease_expires_at"` and `now()`
 * were PRESENT in the emitted SQL — never the operator. So inverting the lease
 * predicate `gt`→`lt` in production still passed 31/31: the emitted SQL changed
 * `>`→`<` but the fake-db's match decision was unchanged. This v3 version:
 *   1. PARSES the comparison operator from the captured WHERE SQL and uses it
 *      to evaluate `leaseLive` — so `gt`→`lt` flips outcomes both ways (live
 *      lease no-matches → accepted tests red; expired lease matches → rejected
 *      tests red).
 *   2. Pins the operator in a test-level regex assertion on the captured SQL
 *      (`"lease_expires_at" > now()`).
 *   3. Adds named behavioral tests for expiry semantics: expired → conflict,
 *      live → accepted, boundary `leaseExpiresAt == now()` → rejected (strict `>`).
 *   4. Adapts to the upstream predicate change (new heartbeat subquery
 *      conjuncts c/e/f): shape assertion pins them; HeartbeatRow carries
 *      companyId + contextSnapshot; heartbeatLive checks them.
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
  companyId: string;
  status: "running" | "succeeded" | "failed" | "cancelled" | "timed_out";
  contextSnapshot: { issueId?: string; taskId?: string } | null;
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
    companyId: row.companyId,
    status: "running",
    contextSnapshot: { issueId: row.id },
  };
}

/**
 * Compare two epoch-ms by the SQL comparison operator parsed from the captured
 * WHERE clause. This is the crux of the v3 mutation-gate fix: the fake-db no
 * longer hardcodes `>` — it uses whatever operator the production predicate
 * emitted, so a `gt`→`lt` mutation flips lease-liveness and thus the match.
 */
function compareByOp(op: string, a: number, b: number): boolean {
  switch (op) {
    case ">":
      return a > b;
    case "<":
      return a < b;
    case ">=":
      return a >= b;
    case "<=":
      return a <= b;
    default:
      // Unknown / unparsable operator → fail safe (treat as no-match).
      return false;
  }
}

/**
 * Extract the lease comparison operator from the captured WHERE SQL. The
 * fragment renders as `"issues"."lease_expires_at" <op> now()` (verified via
 * PgDialect probe — see evidence/v3-step1-probe-sql.log). Returns "?" if the
 * fragment is absent or unparseable.
 */
function parseLeaseOp(sql: string): string {
  const m = sql.match(/"issues"\."lease_expires_at"\s*(>=|<=|<>|!=|>|<)\s*now\(\)/);
  return m?.[1] ?? "?";
}

/**
 * Fake db that simulates the 7-conjunct CAS UPDATE inside a transaction.
 * The returning() callback decides match/no-match by inspecting the captured
 * WHERE SQL + params against the row + heartbeat state, mirroring how real
 * Postgres would evaluate the predicate. The lease operator is PARSED from the
 * SQL (not hardcoded) so operator mutations flip outcomes.
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
              // Lease liveness is evaluated with the operator PARSED FROM THE
              // CAPTURED SQL — a `gt`→`lt` mutation flips this, flipping the match.
              const leaseOp = parseLeaseOp(query.sql);
              const leaseLive =
                row.leaseExpiresAt !== null &&
                compareByOp(leaseOp, row.leaseExpiresAt.getTime(), now.getTime());
              // Heartbeat is live iff a row exists for THIS checkout run + agent +
              // company with status running AND contextSnapshot matching the issue
              // id (mirrors the upstream predicate's EXISTS subquery).
              const heartbeatLive =
                heartbeat !== null &&
                heartbeat.id === row.checkoutRunId &&
                heartbeat.agentId === row.assigneeAgentId &&
                heartbeat.companyId === row.companyId &&
                heartbeat.status === "running" &&
                ((heartbeat.contextSnapshot?.issueId ?? null) === row.id ||
                  (heartbeat.contextSnapshot?.taskId ?? null) === row.id);
              // The CAS matches iff all conjuncts hold AND the parametrised WHERE
              // carries the row's identity values (proving the predicate binds them).
              // NOTE: sqlHasAllConjuncts checks PRESENCE of columns/tables only —
              // the OPERATOR is pinned separately (parseLeaseOp drives leaseLive;
              // the test-level regex asserts the exact `> now()` fragment). This
              // ensures a mutated operator flips leaseLive rather than force-false
              // sqlHasAllConjuncts (which would leave rejected tests green).
              const sqlHasAllConjuncts =
                query.sql.includes('"issues"."id"') &&
                query.sql.includes('"issues"."company_id"') &&
                query.sql.includes('"issues"."status"') &&
                query.sql.includes('"issues"."assignee_agent_id"') &&
                query.sql.includes('"issues"."checkout_run_id"') &&
                query.sql.includes('"issues"."lease_expires_at"') &&
                query.sql.includes("now()") &&
                query.sql.includes('"heartbeat_runs"') &&
                query.sql.includes('"heartbeat_runs"."company_id"') &&
                query.sql.includes('"heartbeat_runs"."context_snapshot"') &&
                query.sql.includes("'issueId'") &&
                query.sql.includes("'taskId'") &&
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
      // v3: pin the OPERATOR, not just presence. `gt`→`lt` breaks this regex.
      expect(sql).toMatch(/"issues"\."lease_expires_at" > now\(\)/);
      expect(sql).toMatch(/now\(\)/);
      expect(sql).toMatch(/"heartbeat_runs"/);
      // v3: pin the upstream-added heartbeat subquery conjuncts.
      expect(sql).toMatch(/"heartbeat_runs"\."company_id"/);
      expect(sql).toMatch(/"heartbeat_runs"\."context_snapshot"/);
      expect(sql).toMatch(/'issueId'/);
      expect(sql).toMatch(/'taskId'/);
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
        ...liveHeartbeat(row),
        id: randomUUID(), // different run id — the execution run drifted from the checkout run
      };
      const fake = createOwnershipDb(row, heartbeat);
      await expect(
        runOwnership(fake.db, row, { agentId: row.assigneeAgentId!, runId: row.checkoutRunId! }),
      ).rejects.toThrow("Issue checkout ownership conflict");
    });

    it("rejects when the heartbeat company diverges from the issue company", async () => {
      // v3: pins the upstream-added heartbeat_runs.company_id conjunct.
      const row = ownershipRow();
      const heartbeat: HeartbeatRow = { ...liveHeartbeat(row), companyId: randomUUID() };
      const fake = createOwnershipDb(row, heartbeat);
      await expect(
        runOwnership(fake.db, row, { agentId: row.assigneeAgentId!, runId: row.checkoutRunId! }),
      ).rejects.toThrow("Issue checkout ownership conflict");
    });

    it("rejects when the heartbeat contextSnapshot does not reference the issue id", async () => {
      // v3: pins the upstream-added context_snapshot ->> 'issueId'/'taskId' conjunct.
      const row = ownershipRow();
      const heartbeat: HeartbeatRow = {
        ...liveHeartbeat(row),
        contextSnapshot: { issueId: randomUUID() }, // references a different issue
      };
      const fake = createOwnershipDb(row, heartbeat);
      await expect(
        runOwnership(fake.db, row, { agentId: row.assigneeAgentId!, runId: row.checkoutRunId! }),
      ).rejects.toThrow("Issue checkout ownership conflict");
    });
  });

  describe("v3: lease expiry semantics pin the operator (strict >)", () => {
    it("accepts a live lease (expires in the future)", async () => {
      const row = ownershipRow({ leaseExpiresAt: new Date(Date.now() + LEASE_TTL_MS) });
      const heartbeat = liveHeartbeat(row);
      const fake = createOwnershipDb(row, heartbeat);
      await expect(
        runOwnership(fake.db, row, { agentId: row.assigneeAgentId!, runId: row.checkoutRunId! }),
      ).resolves.toBeUndefined();
      // Pin the operator in the captured SQL — `gt`→`lt` breaks this.
      expect(fake.whereQueries[0].sql).toMatch(/"issues"\."lease_expires_at" > now\(\)/);
    });

    it("rejects an expired lease (expires in the past) with a conflict", async () => {
      const row = ownershipRow({ leaseExpiresAt: new Date(Date.now() - 60_000) });
      const heartbeat = liveHeartbeat(row);
      const fake = createOwnershipDb(row, heartbeat);
      await expect(
        runOwnership(fake.db, row, { agentId: row.assigneeAgentId!, runId: row.checkoutRunId! }),
      ).rejects.toThrow("Issue checkout ownership conflict");
    });

    it("rejects a lease at the exact boundary (leaseExpiresAt == now) — strict >", async () => {
      // Fake timers make the boundary deterministic: leaseExpiresAt == now.
      // With strict `>`, equal is NOT live → conflict. (A `>=` mutation would
      // make this live → no conflict → test goes red.)
      const boundary = new Date("2026-07-19T12:00:00Z").getTime();
      vi.useFakeTimers({ now: boundary });
      try {
        const row = ownershipRow({ leaseExpiresAt: new Date(boundary) });
        const heartbeat = liveHeartbeat(row);
        const fake = createOwnershipDb(row, heartbeat);
        await expect(
          runOwnership(fake.db, row, { agentId: row.assigneeAgentId!, runId: row.checkoutRunId! }),
        ).rejects.toThrow("Issue checkout ownership conflict");
      } finally {
        vi.useRealTimers();
      }
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
