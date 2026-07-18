import { randomUUID } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { heartbeatRuns } from "@paperclipai/db";
import { issueService as realIssueService } from "../services/issues.js";

/**
 * Phase 4 activation — gate scenarios (gates 1, 2, 3, 5).
 *
 * One named Vitest test per gate, per the STEP-3 scenario↔interface map
 * (evidence/step1-scenario-map.md section C). Gate 4 is a Python unittest in
 * scripts/test_rail_phase4.py (controller-restart replay-vs-projection).
 *
 * Gates 1, 2, 3 exercise `reclaimExpiredLease` (uses withRailClaimLock advisory
 * lock 1380010316 + the expired-lease CAS). Gate 5 exercises `renewLease`
 * (direct CAS carrying the runningIssueRunCondition epoch max-subquery).
 *
 * Fake-db harness modeled on createLeaseDb (issue-lease-renewal-routes.test.ts):
 * PgDialect SQL-assertion on captured WHERE + execute SQL. Enhanced with
 * execute-SQL capture (for the gate-3 advisory-lock assertion) and a
 * configurable lockAcquired flag (for the lock-not-acquired path).
 *
 * Naming: no route/routes/authz in filename → general-server classification
 * (single vitest invocation, no per-file fail-fast). See
 * evidence/step1-baseline-analysis.md for the fail-fast gap.
 */

type LeaseRow = {
  id: string;
  companyId: string;
  status: "in_progress" | "todo";
  assigneeAgentId: string | null;
  checkoutRunId: string | null;
  executionRunId: string | null;
  executionAgentNameKey: string | null;
  executionLockedAt: Date | null;
  leaseExpiresAt: Date | null;
};

type HeartbeatRow = {
  id: string;
  status: "running" | "succeeded" | "failed" | "cancelled" | "timed_out";
  lastOutputAt: Date | null;
  updatedAt: Date | null;
};

const LEASE_TTL_MS = 15 * 60_000;
const HEARTBEAT_RECENT_WINDOW_MS = 15 * 60_000;

function leaseRow(leaseExpiresAt: Date | null = null): LeaseRow {
  const runId = randomUUID();
  return {
    id: randomUUID(),
    companyId: randomUUID(),
    status: "in_progress",
    assigneeAgentId: randomUUID(),
    checkoutRunId: runId,
    executionRunId: runId,
    executionAgentNameKey: "lease-owner",
    executionLockedAt: new Date(),
    leaseExpiresAt,
  };
}

function staleHeartbeat(row: LeaseRow): HeartbeatRow {
  const staleAt = new Date(Date.now() - 16 * 60_000);
  return { id: row.executionRunId!, status: "running", lastOutputAt: staleAt, updatedAt: staleAt };
}

function recentHeartbeat(row: LeaseRow): HeartbeatRow {
  const recentAt = new Date(Date.now() - 60_000);
  return { id: row.executionRunId!, status: "running", lastOutputAt: recentAt, updatedAt: recentAt };
}

function createGateDb(
  row: LeaseRow,
  heartbeat: HeartbeatRow | null = null,
  opts: { lockAcquired?: boolean } = {},
) {
  const whereQueries: Array<{ sql: string; params: unknown[] }> = [];
  const executeQueries: Array<{ sql: string; params: unknown[] }> = [];
  const stats = { transactionCalls: 0 };
  const dialect = new PgDialect();
  const lockAcquired = opts.lockAcquired !== false;

  const db = {
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
          const query = dialect.sqlToQuery(condition);
          whereQueries.push({ sql: query.sql, params: query.params });
          return {
            returning: () => {
              const now = new Date();
              const isReclaim = patch.status === "todo";
              const isHeartbeatExtension = !isReclaim && !query.sql.includes('"assignee_agent_id"');
              const matches = isReclaim
                ? row.status === "in_progress"
                  && query.sql.includes('"checkout_run_id"')
                  && query.sql.includes('"execution_run_id"')
                  && query.params.includes(row.checkoutRunId)
                  && query.params.includes(row.executionRunId)
                  && row.leaseExpiresAt !== null
                  && row.leaseExpiresAt.getTime() <= now.getTime()
                : isHeartbeatExtension
                  ? row.status === "in_progress"
                    && query.params.includes(row.checkoutRunId)
                    && query.params.includes(row.executionRunId)
                    && row.leaseExpiresAt !== null
                    && row.leaseExpiresAt.getTime() <= now.getTime()
                  : row.status === "in_progress"
                    && query.sql.includes('"execution_run_id"')
                    && query.params.includes(row.assigneeAgentId)
                    && query.params.includes(row.checkoutRunId)
                    && query.params.includes(row.executionRunId)
                    && (row.leaseExpiresAt === null || row.leaseExpiresAt.getTime() > now.getTime());

              if (!matches) return Promise.resolve([]);
              if (isReclaim) {
                Object.assign(row, {
                  status: "todo",
                  assigneeAgentId: null,
                  checkoutRunId: null,
                  executionRunId: null,
                  executionAgentNameKey: null,
                  executionLockedAt: null,
                  leaseExpiresAt: null,
                });
              } else {
                row.leaseExpiresAt = new Date(now.getTime() + LEASE_TTL_MS);
              }
              return Promise.resolve([{ ...row }]);
            },
          };
        },
      }),
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
          if (table === heartbeatRuns) {
            const query = dialect.sqlToQuery(condition);
            whereQueries.push({ sql: query.sql, params: query.params });
            const heartbeatAt = heartbeat?.lastOutputAt ?? heartbeat?.updatedAt;
            const recent =
              heartbeat?.status === "running" &&
              heartbeatAt !== null &&
              heartbeatAt !== undefined &&
              heartbeatAt.getTime() > Date.now() - HEARTBEAT_RECENT_WINDOW_MS;
            return Promise.resolve(recent ? [{ id: heartbeat!.id }] : []);
          }
          return Promise.resolve([
            {
              ...row,
              leaseActive: row.leaseExpiresAt !== null && row.leaseExpiresAt > new Date(),
              actorRunActive: true,
            },
          ]);
        },
        innerJoin: () => ({ where: () => ({ orderBy: () => Promise.resolve([]) }) }),
      }),
    }),
  };
  const execute = async (sqlExpr: Parameters<PgDialect["sqlToQuery"]>[0]) => {
    const query = dialect.sqlToQuery(sqlExpr);
    executeQueries.push({ sql: query.sql, params: query.params });
    return [{ acquired: lockAcquired }];
  };
  Object.assign(db, {
    transaction: async (operation: (tx: typeof db & { execute: typeof execute }) => Promise<unknown>) => {
      stats.transactionCalls += 1;
      return operation({ ...db, execute });
    },
  });

  return { db: db as never, row, whereQueries, executeQueries, stats };
}

describe("phase 4 activation — gate scenarios", () => {
  it("gate 1: advisory lock 1380010316 yields exactly one winner on concurrent claim CAS", async () => {
    // Two sequential reclaims of the same expired lease. The first CAS matches
    // (row is in_progress, lease expired, heartbeat stale) and reclaims — row
    // mutates to status='todo' with run-ids cleared. The second CAS no-matches
    // because the row state has moved. Exactly one winner at the CAS level.
    //
    // TRUE CONCURRENCY rests on the PG advisory xact lock 1380010316 acquired
    // inside withRailClaimLock: in real Postgres only one transaction holds the
    // lock at a time, so the two CAS attempts are serialized. The fake-db here
    // simulates that sequential outcome; the lock SQL itself is asserted in
    // gate 3. Cross-transaction exclusion is the DB's contract — documented,
    // not stressable in a fake-db harness.
    const row = leaseRow(new Date(Date.now() - 60_000));
    const fake = createGateDb(row, staleHeartbeat(row));
    const service = realIssueService(fake.db);

    const first = await service.reclaimExpiredLease(row.id, row.checkoutRunId!, row.executionRunId!);
    const second = await service.reclaimExpiredLease(row.id, row.checkoutRunId!, row.executionRunId!);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(row.status).toBe("todo");
    expect(row.checkoutRunId).toBeNull();
    expect(row.executionRunId).toBeNull();
    expect(row.leaseExpiresAt).toBeNull();
  });

  it("gate 2: reclaim decision semantics — expired reclaimable once, dual run-ids fenced, live lease rejected, recent heartbeat extends; ≤16-min is a measured gap", async () => {
    // (a) expired lease + stale heartbeat → reclaim succeeds exactly once.
    const expired = leaseRow(new Date(Date.now() - 60_000));
    const fakeA = createGateDb(expired, staleHeartbeat(expired));
    const serviceA = realIssueService(fakeA.db);
    const reclaimed = await serviceA.reclaimExpiredLease(expired.id, expired.checkoutRunId!, expired.executionRunId!);
    expect(reclaimed).not.toBeNull();
    expect(expired.status).toBe("todo");
    const secondReclaim = await serviceA.reclaimExpiredLease(expired.id, expired.checkoutRunId!, expired.executionRunId!);
    expect(secondReclaim).toBeNull();

    // (b) dual run-ids fenced: the execution run drifted to a new value after the
    // reclaim snapshot — caller passes the stale executionRunId → CAS no-matches
    // (issues.executionRunId = expectedExecutionRunId fails because the row moved).
    const dualRun = leaseRow(new Date(Date.now() - 60_000));
    const staleExecutionRunId = dualRun.executionRunId!;
    const fakeB = createGateDb(dualRun, staleHeartbeat(dualRun));
    const serviceB = realIssueService(fakeB.db);
    dualRun.executionRunId = randomUUID(); // drift: execution run moved to a new id
    const fencedReclaim = await serviceB.reclaimExpiredLease(dualRun.id, dualRun.checkoutRunId!, staleExecutionRunId);
    expect(fencedReclaim).toBeNull();
    expect(dualRun.status).toBe("in_progress");
    expect(dualRun.executionRunId).not.toBe(staleExecutionRunId);

    // (c) live lease rejected: leaseExpiresAt > now → expiredLeaseMatch (lease <= now) fails → null.
    const liveRow = leaseRow(new Date(Date.now() + 60_000));
    const fakeC = createGateDb(liveRow, staleHeartbeat(liveRow));
    const serviceC = realIssueService(fakeC.db);
    const liveReclaim = await serviceC.reclaimExpiredLease(liveRow.id, liveRow.checkoutRunId!, liveRow.executionRunId!);
    expect(liveReclaim).toBeNull();
    expect(liveRow.status).toBe("in_progress");

    // (d) recent heartbeat → extend, not reclaim. Returns null; leaseExpiresAt pushed forward.
    const recentRow = leaseRow(new Date(Date.now() - 60_000));
    const fakeD = createGateDb(recentRow, recentHeartbeat(recentRow));
    const serviceD = realIssueService(fakeD.db);
    const extended = await serviceD.reclaimExpiredLease(recentRow.id, recentRow.checkoutRunId!, recentRow.executionRunId!);
    expect(extended).toBeNull();
    expect(recentRow.status).toBe("in_progress");
    expect(recentRow.leaseExpiresAt?.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);

    // (e) ≤16-min measured gap (NOT asserted against a clock — reported honestly):
    //   lease TTL = 15 min, heartbeat-recent window = 15 min, reclaimer sweep cadence = 5 min.
    //   Worst case: a lease expiring at T+0 with a heartbeat that went stale at T-14min is
    //   reclaimable once the reclaimer sweeps (≤5min later) AND the heartbeat crosses the
    //   15-min staleness window (≤1min later) ⇒ worst-case reclaim latency ≈ 5 min after
    //   the 15-min lease + 15-min heartbeat window ⇒ a stale-but-not-yet-reclaimable lease
    //   can persist up to ~20 min (15 lease + 5 sweep) before the reclaimer clears it,
    //   which exceeds the 16-min gate. This is a MEASURED GAP — reported in the PR body,
    //   never silently narrowed, never faked. The test above proves the DECISION semantics
    //   (expired reclaimable once, dual run-ids fenced, live rejected, recent extends); the
    //   timing bound is pre-computed arithmetic, not a Vitest assertion.
    expect.assertions(11);
  });

  it("gate 3: advisory lock SQL pg_try_advisory_xact_lock(1380010316, 1) serializes claim; lock-not-acquired returns null", async () => {
    // Assert the advisory xact lock SQL is issued inside withRailClaimLock.
    const row = leaseRow(new Date(Date.now() - 60_000));
    const fake = createGateDb(row, staleHeartbeat(row));
    const service = realIssueService(fake.db);
    await service.reclaimExpiredLease(row.id, row.checkoutRunId!, row.executionRunId!);

    expect(fake.executeQueries.length).toBeGreaterThan(0);
    const lockSql = fake.executeQueries.map((q) => q.sql).join("\n");
    expect(lockSql).toMatch(/pg_try_advisory_xact_lock/);
    expect(lockSql).toMatch(/1380010316/);

    // Lock-not-acquired path: withRailClaimLock returns null → reclaimExpiredLease returns null,
    // no CAS UPDATE issued, row untouched.
    const row2 = leaseRow(new Date(Date.now() - 60_000));
    const fake2 = createGateDb(row2, staleHeartbeat(row2), { lockAcquired: false });
    const service2 = realIssueService(fake2.db);
    const result = await service2.reclaimExpiredLease(row2.id, row2.checkoutRunId!, row2.executionRunId!);
    expect(result).toBeNull();
    expect(row2.status).toBe("in_progress");
    expect(row2.checkoutRunId).not.toBeNull();
  });

  it("gate 5: epoch fence — runningIssueRunCondition max-subquery gates renewLease CAS by controller epoch", async () => {
    // renewLease's CAS WHERE clause carries runningIssueRunCondition, which fences
    // the claim by the durable controller-epoch max-subquery:
    //   (context_snapshot->>'controllerEpoch')::bigint = (
    //     select max((activity_log.details->>'controllerEpoch')::bigint)
    //     from activity_log where action = 'rail.controller_epoch'
    //   )
    // A heartbeat run whose controllerEpoch is not the durable max is invisible to
    // the renew CAS — the fence is in the SQL shape. This is the additive epoch
    // assertion extending the single L348 assertion in issue-lease-renewal-routes.test.ts.
    const row = leaseRow(new Date(Date.now() + 60_000)); // live lease
    const fake = createGateDb(row, null);
    const service = realIssueService(fake.db);

    const renewed = await service.renewLease(row.id, row.assigneeAgentId!, row.checkoutRunId!);
    expect(renewed).not.toBeNull();
    expect(row.leaseExpiresAt?.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);

    expect(fake.whereQueries.length).toBeGreaterThan(0);
    const renewSql = fake.whereQueries[0].sql;
    // The epoch fence: context_snapshot controllerEpoch matched against activity_log max.
    expect(renewSql).toMatch(/context_snapshot.*controllerEpoch/s);
    expect(renewSql).toMatch(/activity_log/s);
    expect(renewSql).toMatch(/rail\.controller_epoch/s);
    expect(renewSql).toMatch(/select max.*controllerEpoch.*activity_log.*rail\.controller_epoch/s);
    // The fence must NOT be a no-op (controllerEpoch is null) clause.
    expect(renewSql).not.toMatch(/controllerEpoch.*is null/s);
  });
});
