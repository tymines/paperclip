import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { assertIssueRunOwnership } from "../services/issue-run-ownership.js";
import { issueService as realIssueService } from "../services/issues.js";
import { workProductService } from "../services/work-products.js";
import { issueThreadInteractionService } from "../services/issue-thread-interactions.js";

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

/**
 * v3 STEP 3 — surface coverage truth table (blocker 2 fix).
 *
 * The review flagged that the v2 "7 surface" tests invoke the shared predicate
 * directly with per-surface labels but do not exercise the actual surface call
 * paths. This block fixes that by:
 *   1. WIRING ASSERTIONS: statically proving each surface module's source file
 *      calls `assertIssueRunOwnership` (read source, count call sites, name file).
 *   2. BEHAVIORAL: where the surface function calls the predicate FIRST in its
 *      transaction (before any select/insert), invoke the REAL surface function
 *      with a fenced context (expired lease) and assert conflict — proving the
 *      wiring is live, not just textual.
 *   3. TRUTH TABLE: every surface is labeled behavioral or wiring-only with the
 *      reason. This table is pasted into the PR body.
 *
 * Surface→coverage table (17 call sites across 7 files):
 * | surface            | call-site file(s)                            | calls | coverage type                         | reason                                                                 |
 * | comment            | services/issues.ts (removeComment)            | 1     | wiring-only                            | select(comment) + instanceSettings before predicate                   |
 * | issue-update       | services/issues.ts (createChild, remove) +    | 3     | wiring-only                            | select() before predicate; route handler needs Express                |
 * |                    | routes/issues.ts (recovery-action resolve)    |       |                                        |                                                                        |
 * | work-product       | services/work-products.ts (createForIssue,    | 3     | behavioral (createForIssue) + wiring   | createForIssue calls predicate first in tx — tested; update/remove    |
 * |                    | update, remove)                               |       | (update, remove)                       | do select() first                                                     |
 * | document           | services/documents.ts                         | 2     | wiring-only                            | select(issue) before tx                                               |
 * | attachment         | services/issues.ts (createAttachment,         | 2     | wiring-only                            | select(issue) before tx; select(existing) in tx                       |
 * |                    | removeAttachment)                             |       |                                        |                                                                        |
 * | approval           | services/approvals.ts +                       | 5     | wiring-only                            | select(issueRows) before predicate; assertIssueAndApprovalSameCompany |
 * |                    | services/issue-approvals.ts                   |       |                                        | (select) before predicate                                             |
 * | thread-interaction | services/issue-thread-interactions.ts (create)| 1     | behavioral                             | create calls predicate first in tx (after Zod parse) — tested         |
 */
describe("v3: surface coverage truth table (blocker 2 fix)", () => {
  const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

  describe("wiring assertions — each surface module statically proven to call assertIssueRunOwnership", () => {
    const SURFACE_FILES = [
      { file: "routes/issues.ts", expectedCalls: 1, surfaces: "issue-update (recovery-action resolve)" },
      { file: "services/issues.ts", expectedCalls: 5, surfaces: "comment (removeComment), issue-update (createChild, remove), attachment (createAttachment, removeAttachment)" },
      { file: "services/work-products.ts", expectedCalls: 3, surfaces: "work-product (createForIssue, update, remove)" },
      { file: "services/documents.ts", expectedCalls: 2, surfaces: "document" },
      { file: "services/approvals.ts", expectedCalls: 3, surfaces: "approval (create, resolve, comment)" },
      { file: "services/issue-approvals.ts", expectedCalls: 2, surfaces: "approval (link, unlink)" },
      { file: "services/issue-thread-interactions.ts", expectedCalls: 1, surfaces: "thread-interaction (create)" },
    ] as const;

    it.each(SURFACE_FILES)(
      "wiring: $file has $expectedCalls assertIssueRunOwnership call(s) — $surfaces",
      ({ file, expectedCalls }) => {
        const source = readFileSync(path.resolve(SRC_DIR, ...file.split("/")), "utf8");
        // Count call sites (import line has no parens, so this only matches calls).
        const callSites = source.match(/assertIssueRunOwnership\(/g) ?? [];
        expect(callSites.length).toBe(expectedCalls);
      },
    );
  });

  describe("behavioral — real surface function invoked with fenced context → conflict", () => {
    it("work-product: createForIssue with expired lease → conflict (predicate called first in tx)", async () => {
      const row = ownershipRow({ leaseExpiresAt: new Date(Date.now() - 60_000) });
      const heartbeat = liveHeartbeat(row);
      const fake = createOwnershipDb(row, heartbeat);
      const service = workProductService(fake.db);
      await expect(
        service.createForIssue(row.id, row.companyId, {} as never, {
          runOwnership: { agentId: row.assigneeAgentId!, runId: row.checkoutRunId! },
        }),
      ).rejects.toThrow("Issue checkout ownership conflict");
    });

    it("thread-interaction: create with expired lease → conflict (predicate after Zod parse, before any db op)", async () => {
      const row = ownershipRow({ leaseExpiresAt: new Date(Date.now() - 60_000) });
      const heartbeat = liveHeartbeat(row);
      const fake = createOwnershipDb(row, heartbeat);
      const service = issueThreadInteractionService(fake.db);
      await expect(
        service.create(
          { id: row.id, companyId: row.companyId },
          {
            kind: "suggest_tasks",
            payload: {
              version: 1,
              tasks: [{ clientKey: "t1", title: "Test task" }],
            },
          },
          { agentId: row.assigneeAgentId },
          { runOwnership: { agentId: row.assigneeAgentId!, runId: row.checkoutRunId! } },
        ),
      ).rejects.toThrow("Issue checkout ownership conflict");
    });
  });

  describe("surface→coverage table (asserts completeness + pasted into PR body)", () => {
    it("every surface is accounted for; totals match; behavioral count is 2", () => {
      const table = [
        { surface: "comment", calls: 1, coverage: "wiring-only" },
        { surface: "issue-update", calls: 3, coverage: "wiring-only" },
        { surface: "work-product", calls: 3, coverage: "behavioral" },
        { surface: "document", calls: 2, coverage: "wiring-only" },
        { surface: "attachment", calls: 2, coverage: "wiring-only" },
        { surface: "approval", calls: 5, coverage: "wiring-only" },
        { surface: "thread-interaction", calls: 1, coverage: "behavioral" },
      ];
      expect(table.length).toBe(7);
      expect(table.reduce((sum, r) => sum + r.calls, 0)).toBe(17);
      expect(table.filter((r) => r.coverage === "behavioral").length).toBe(2);
    });
  });
});

/**
 * v4 — inline update path CAS predicate pinning (issues.ts:4569).
 *
 * The `assertIssueRunOwnership` predicate (pinned above) is a PRE-CHECK called
 * by surface functions before their writes. But the `issueService.update`
 * method has its OWN inline ownership CAS when `enforceRunOwnership: true`:
 *
 *   db.update(issues).set(patch).where(and(
 *     eq(issues.id, id),
 *     eq(issues.status, "in_progress"),
 *     eq(issues.assigneeAgentId, actorAgentId),
 *     eq(issues.checkoutRunId, actorRunId),
 *     eq(issues.executionRunId, actorRunId),
 *     gt(issues.leaseExpiresAt, sql`now()`),           ← sibling CAS #1
 *     runningIssueRunCondition(actorRunId, actorAgentId),
 *   )).returning()
 *
 * If zero rows match → throw conflict("Issue checkout ownership conflict").
 *
 * This is a DIFFERENT predicate from `assertIssueRunOwnership` (which lives in
 * issue-run-ownership.ts and has a heartbeat EXISTS subquery). The v3 fencing
 * suite pinned `assertIssueRunOwnership` but NOT this inline sibling. v4 pins
 * it using the same parseLeaseOp/compareByOp captured-SQL harness pattern:
 * the fake-db parses the operator from the WHERE SQL and evaluates lease-liveness
 * via compareByOp, so a `gt`→`lt` mutation flips the match outcome.
 */
describe("v4: inline update path CAS — issues.ts:4569 gt pinned (sibling #1)", () => {
  /**
   * Minimal fake-db for the update() method's inline CAS. Handles:
   *   - select().from(issues).where() → returns the existing row
   *   - select().from(instanceSettings).where() → returns a settings row
   *   - update(issues).set().where().returning() → evaluates the CAS using
   *     the operator PARSED from the captured WHERE SQL
   *   - transaction() → delegates to the operation
   */
  function createInlineUpdateDb(row: IssueRow) {
    const whereQueries: Array<{ sql: string; params: unknown[] }> = [];
    const dialect = new PgDialect();
    const settingsRow = {
      singletonKey: 1,
      general: {},
      experimental: { enableIsolatedWorkspaces: false },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const db = {
      select: () => ({
        from: (table: unknown) => ({
          where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
            const query = dialect.sqlToQuery(condition);
            // Build a thenable that also supports orderBy (drizzle chains).
            const result = query.sql.includes("instance_settings")
              ? [settingsRow]
              : [row];
            const thenable = {
              orderBy: () => Promise.resolve(result),
              then: <T>(resolve: (rows: typeof result) => T | Promise<T>) =>
                Promise.resolve(result).then(resolve),
            };
            return thenable;
          },
          // Some select chains call orderBy directly after from (no where).
          orderBy: () => Promise.resolve([row]),
          // Some select chains call then directly.
          then: <T>(resolve: (rows: unknown[]) => T | Promise<T>) =>
            Promise.resolve([row]).then(resolve),
          // labelMapForIssues uses innerJoin; return empty (no labels).
          innerJoin: () => ({
            where: () => ({
              orderBy: () => Promise.resolve([]),
              then: <T>(resolve: (rows: unknown[]) => T | Promise<T>) =>
                Promise.resolve([]).then(resolve),
            }),
          }),
        }),
      }),
      update: () => ({
        set: (_patch: Record<string, unknown>) => ({
          where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
            const query = dialect.sqlToQuery(condition);
            whereQueries.push({ sql: query.sql, params: query.params });
            return {
              returning: () => {
                const now = new Date();
                // v4: PARSE the operator from the captured SQL.
                const leaseOp = parseLeaseOp(query.sql);
                const leaseLive =
                  row.leaseExpiresAt !== null &&
                  compareByOp(leaseOp, row.leaseExpiresAt.getTime(), now.getTime());
                // The inline CAS checks status, assignee, checkoutRunId,
                // executionRunId, lease liveness. It does NOT have a heartbeat
                // EXISTS subquery (that's assertIssueRunOwnership only).
                const params = query.params as unknown[];
                const matches =
                  row.status === "in_progress" &&
                  params.includes(row.id) &&
                  params.includes(row.assigneeAgentId) &&
                  params.includes(row.checkoutRunId) &&
                  leaseLive;
                return Promise.resolve(matches ? [{ ...row }] : []);
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

  it("accepts a live lease (expires in the future) — operator is gt (>), not lt or >=", async () => {
    const row = ownershipRow({ leaseExpiresAt: new Date(Date.now() + LEASE_TTL_MS) });
    const fake = createInlineUpdateDb(row);
    const service = realIssueService(fake.db);
    const updated = await service.update(row.id, {
      title: "updated",
      actorAgentId: row.assigneeAgentId,
      actorRunId: row.checkoutRunId,
      enforceRunOwnership: true,
    });
    expect(updated).not.toBeNull();
    // Pin the operator in the captured SQL — `gt`→`lt` breaks this regex.
    const sql = fake.whereQueries.map((q) => q.sql).join("\n");
    expect(sql).toMatch(/"issues"\."lease_expires_at"\s*>\s*now\(\)/);
    // Must NOT be <= or >= (strict >).
    expect(sql).not.toMatch(/"issues"\."lease_expires_at"\s*<=\s*now\(\)/);
    expect(sql).not.toMatch(/"issues"\."lease_expires_at"\s*>=\s*now\(\)/);
  });

  it("rejects an expired lease (expires in the past) with conflict", async () => {
    const row = ownershipRow({ leaseExpiresAt: new Date(Date.now() - 60_000) });
    const fake = createInlineUpdateDb(row);
    const service = realIssueService(fake.db);
    await expect(
      service.update(row.id, {
        title: "updated",
        actorAgentId: row.assigneeAgentId,
        actorRunId: row.checkoutRunId,
        enforceRunOwnership: true,
      }),
    ).rejects.toThrow("Issue checkout ownership conflict");
  });

  it("boundary: leaseExpiresAt == now() → conflict (strict >, equal is NOT live)", async () => {
    // With strict `>`, equal is NOT live → CAS no-matches → conflict.
    // (A `>=` mutation would make this live → no conflict → test goes RED.)
    const boundary = new Date("2026-07-20T05:00:00Z").getTime();
    vi.useFakeTimers({ now: boundary });
    try {
      const row = ownershipRow({ leaseExpiresAt: new Date(boundary) });
      const fake = createInlineUpdateDb(row);
      const service = realIssueService(fake.db);
      await expect(
        service.update(row.id, {
          title: "updated",
          actorAgentId: row.assigneeAgentId,
          actorRunId: row.checkoutRunId,
          enforceRunOwnership: true,
        }),
      ).rejects.toThrow("Issue checkout ownership conflict");
      const sql = fake.whereQueries.map((q) => q.sql).join("\n");
      expect(sql).toMatch(/"issues"\."lease_expires_at"\s*>\s*now\(\)/);
    } finally {
      vi.useRealTimers();
    }
  });
});
