import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { heartbeatRuns } from "@paperclipai/db";
import { renewIssueLeaseSchema } from "@paperclipai/shared/validators/issue";
import { errorHandler } from "../middleware/index.js";
import { issueService as realIssueService } from "../services/issues.js";

const routeMocks = vi.hoisted(() => ({
  getById: vi.fn(),
  checkout: vi.fn(),
  renewLease: vi.fn(),
  wakeup: vi.fn(),
  logActivity: vi.fn(),
}));

vi.mock("../services/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/index.js")>();
  return {
    ...actual,
    issueService: () => ({
      getById: routeMocks.getById,
      checkout: routeMocks.checkout,
      renewLease: routeMocks.renewLease,
    }),
    heartbeatService: () => ({
      wakeup: routeMocks.wakeup,
    }),
    logActivity: routeMocks.logActivity,
  };
});

import { issueRoutes } from "../routes/issues.js";

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

type HeartbeatRow = Pick<
  typeof heartbeatRuns.$inferSelect,
  "id" | "status" | "lastOutputAt" | "updatedAt"
>;

function createLeaseDb(row: LeaseRow, heartbeat: HeartbeatRow | null = null) {
  const whereQueries: Array<{ sql: string; params: unknown[] }> = [];
  const stats = { transactionCalls: 0 };
  const dialect = new PgDialect();

  const db = {
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
          const query = dialect.sqlToQuery(condition);
          whereQueries.push({ sql: query.sql, params: query.params });
          return {
            returning: () => {
              const isReclaim = patch.status === "todo";
              const isHeartbeatExtension = !isReclaim && !query.sql.includes('"assignee_agent_id"');
              const now = new Date();
              const matches = isReclaim
                ? row.status === "in_progress"
                  && query.sql.includes('"checkout_run_id"')
                  && query.sql.includes('"execution_run_id"')
                  && query.params.includes(row.checkoutRunId)
                  && query.params.includes(row.executionRunId)
                  && row.leaseExpiresAt !== null
                  && row.leaseExpiresAt < now
                : isHeartbeatExtension
                  ? row.status === "in_progress"
                    && query.params.includes(row.checkoutRunId)
                    && query.params.includes(row.executionRunId)
                    && row.leaseExpiresAt !== null
                    && row.leaseExpiresAt < now
                  : row.status === "in_progress"
                    && query.sql.includes('"execution_run_id"')
                    && query.params.includes(row.assigneeAgentId)
                    && query.params.includes(row.checkoutRunId)
                    && query.params.includes(row.executionRunId)
                    && (row.leaseExpiresAt === null || row.leaseExpiresAt > now);

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
                row.leaseExpiresAt = new Date(now.getTime() + 15 * 60_000);
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
            const recent = heartbeat?.status === "running"
              && heartbeatAt !== undefined
              && heartbeatAt !== null
              && heartbeatAt > new Date(Date.now() - 15 * 60_000);
            return Promise.resolve(recent ? [{ id: heartbeat.id }] : []);
          }
          return Promise.resolve([{
            ...row,
            leaseActive: row.leaseExpiresAt !== null && row.leaseExpiresAt > new Date(),
            actorRunActive: true,
          }]);
        },
        innerJoin: () => ({
          where: () => ({
            orderBy: () => Promise.resolve([]),
          }),
        }),
      }),
    }),
  };
  const execute = async () => [{ acquired: true }];
  Object.assign(db, {
    transaction: async (operation: (tx: typeof db & { execute: typeof execute }) => Promise<unknown>) => {
      stats.transactionCalls += 1;
      return operation({ ...db, execute });
    },
  });

  return { db: db as never, row, whereQueries, stats };
}

function agentActor(companyId: string, agentId: string, runId: string): Express.Request["actor"] {
  return {
    type: "agent",
    agentId,
    companyId,
    runId,
    source: "agent_jwt",
  };
}

function boardActor(companyId: string): Express.Request["actor"] {
  return {
    type: "board",
    userId: "rail-controller",
    userName: null,
    userEmail: null,
    companyIds: [companyId],
    source: "session",
    isInstanceAdmin: false,
  };
}

function createApp(actor: Express.Request["actor"]) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", issueRoutes({} as never, {} as never));
  app.use(errorHandler);
  return app;
}

describe("controller epoch checkout propagation", () => {
  it("carries the controller epoch into the assignee heartbeat run", async () => {
    vi.clearAllMocks();
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const issue = {
      id: issueId,
      companyId,
      status: "todo",
      projectId: null,
      executionWorkspaceId: null,
    };
    routeMocks.getById.mockResolvedValue(issue);
    routeMocks.checkout.mockResolvedValue({
      ...issue,
      status: "in_progress",
      assigneeAgentId: agentId,
      checkoutRunId: null,
      executionRunId: null,
    });
    routeMocks.wakeup.mockResolvedValue(undefined);

    const response = await request(createApp(boardActor(companyId)))
      .post(`/api/issues/${issueId}/checkout`)
      .send({ agentId, expectedStatuses: ["todo"], controllerEpoch: 7 });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(routeMocks.wakeup).toHaveBeenCalledWith(agentId, expect.objectContaining({
      contextSnapshot: {
        issueId,
        source: "issue.checkout",
        controllerEpoch: 7,
      },
    }));
  });
});

describe("issue lease renewal validator", () => {
  it("accepts only an empty body so identity cannot be supplied by the caller", () => {
    expect(renewIssueLeaseSchema.safeParse({}).success).toBe(true);
    expect(renewIssueLeaseSchema.safeParse({ agentId: randomUUID(), runId: randomUUID() }).success).toBe(false);
  });
});

describe("issue lease renewal route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("derives owner and run identity from the authenticated actor and logs the renewal", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();
    const issueId = randomUUID();
    const issue = { id: issueId, companyId, status: "in_progress", assigneeAgentId: agentId };
    const renewed = { ...issue, checkoutRunId: runId, leaseExpiresAt: new Date(Date.now() + 15 * 60_000) };
    routeMocks.getById.mockResolvedValue(issue);
    routeMocks.renewLease.mockResolvedValue(renewed);

    const response = await request(createApp(agentActor(companyId, agentId, runId)))
      .post(`/api/issues/${issueId}/renew-lease`)
      .send({});

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(routeMocks.renewLease).toHaveBeenCalledWith(issueId, agentId, runId);
    expect(routeMocks.logActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      companyId,
      agentId,
      runId,
      action: "issue.lease_renewed",
      entityId: issueId,
    }));
  });

  it("rejects body identity before calling the service", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();

    const response = await request(createApp(agentActor(companyId, agentId, runId)))
      .post(`/api/issues/${randomUUID()}/renew-lease`)
      .send({ agentId, runId });

    expect(response.status).toBe(400);
    expect(routeMocks.renewLease).not.toHaveBeenCalled();
  });

  it("returns conflict when the authenticated owner or run loses the CAS", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();
    const issueId = randomUUID();
    routeMocks.getById.mockResolvedValue({
      id: issueId,
      companyId,
      status: "in_progress",
      assigneeAgentId: agentId,
    });
    routeMocks.renewLease.mockResolvedValue(null);

    const response = await request(createApp(agentActor(companyId, agentId, runId)))
      .post(`/api/issues/${issueId}/renew-lease`)
      .send({});

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("Issue lease renewal conflict");
  });

  it("enforces company access and requires an authenticated agent run", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();
    const issueId = randomUUID();
    routeMocks.getById.mockResolvedValue({
      id: issueId,
      companyId,
      status: "in_progress",
      assigneeAgentId: agentId,
    });

    const crossCompany = await request(createApp(agentActor(randomUUID(), agentId, runId)))
      .post(`/api/issues/${issueId}/renew-lease`)
      .send({});
    const missingRun = await request(createApp(agentActor(companyId, agentId, "")))
      .post(`/api/issues/${issueId}/renew-lease`)
      .send({});

    expect(crossCompany.status).toBe(403);
    expect(missingRun.status).toBe(401);
    expect(routeMocks.renewLease).not.toHaveBeenCalled();
  });
});

describe("issue lease service CAS", () => {
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

  it("establishes and extends a lease with one DB-clock update CAS", async () => {
    const row = leaseRow();
    const fake = createLeaseDb(row);
    const service = realIssueService(fake.db);

    const established = await service.renewLease(row.id, row.assigneeAgentId!, row.checkoutRunId!);
    expect(established?.leaseExpiresAt?.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);

    row.leaseExpiresAt = new Date(Date.now() + 30_000);
    const renewed = await service.renewLease(row.id, row.assigneeAgentId!, row.checkoutRunId!);
    expect(renewed?.leaseExpiresAt?.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(fake.whereQueries).toHaveLength(2);
    expect(fake.whereQueries[0].sql).toMatch(/"id".*"status".*"assignee_agent_id".*"checkout_run_id".*"execution_run_id".*"lease_expires_at"/s);
    expect(fake.whereQueries[0].sql).toMatch(/now\(\)/);
    expect(fake.whereQueries[0].sql).toMatch(/context_snapshot.*controllerEpoch.*activity_log.*rail\.controller_epoch/s);
    expect(fake.whereQueries[0].sql).not.toMatch(/controllerEpoch.*is null/s);
  });

  it("allows only the rightful owner when two agents renew concurrently and rejects wrong run or expiry", async () => {
    const row = leaseRow(new Date(Date.now() + 60_000));
    const fake = createLeaseDb(row);
    const service = realIssueService(fake.db);

    const [owner, peer] = await Promise.allSettled([
      service.renewLease(row.id, row.assigneeAgentId!, row.checkoutRunId!),
      service.renewLease(row.id, randomUUID(), row.checkoutRunId!),
    ]);
    expect(owner.status).toBe("fulfilled");
    expect(peer.status).toBe("rejected");
    await expect(service.renewLease(row.id, row.assigneeAgentId!, randomUUID())).rejects.toThrow(
      "Issue lease renewal conflict",
    );
    row.executionRunId = randomUUID();
    await expect(service.renewLease(row.id, row.assigneeAgentId!, row.checkoutRunId!)).rejects.toThrow(
      "Issue lease renewal conflict",
    );
    row.executionRunId = row.checkoutRunId;
    row.leaseExpiresAt = new Date(Date.now() - 60_000);
    await expect(service.renewLease(row.id, row.assigneeAgentId!, row.checkoutRunId!)).rejects.toThrow(
      "Issue lease renewal conflict",
    );
  });

  it("allows exactly one service caller to reclaim an expired lease after its run heartbeat is stale", async () => {
    const row = leaseRow(new Date(Date.now() - 60_000));
    const staleAt = new Date(Date.now() - 16 * 60_000);
    const fake = createLeaseDb(row, {
      id: row.executionRunId!,
      status: "running",
      lastOutputAt: staleAt,
      updatedAt: staleAt,
    });
    const service = realIssueService(fake.db);

    const results = await Promise.all([
      service.reclaimExpiredLease(row.id, row.checkoutRunId!, row.executionRunId!),
      service.reclaimExpiredLease(row.id, row.checkoutRunId!, row.executionRunId!),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((result) => result === null)).toHaveLength(1);
    expect(row).toMatchObject({
      status: "todo",
      assigneeAgentId: null,
      checkoutRunId: null,
      executionRunId: null,
      executionAgentNameKey: null,
      executionLockedAt: null,
      leaseExpiresAt: null,
    });
    const reclaimQuery = fake.whereQueries.find(({ sql }) => sql.includes('"issues"."id"'))!;
    expect(reclaimQuery.sql).toMatch(/"id".*"status".*"checkout_run_id".*"execution_run_id".*"lease_expires_at"/s);
    expect(reclaimQuery.sql).toMatch(/now\(\)/);
    expect(fake.stats.transactionCalls).toBe(2);
  });

  it("extends an expired lease instead of reclaiming while its run heartbeat is recent", async () => {
    const row = leaseRow(new Date(Date.now() - 60_000));
    const recentAt = new Date(Date.now() - 60_000);
    const fake = createLeaseDb(row, {
      id: row.executionRunId!,
      status: "running",
      lastOutputAt: recentAt,
      updatedAt: recentAt,
    });
    const service = realIssueService(fake.db);

    const reclaimed = await service.reclaimExpiredLease(row.id, row.checkoutRunId!, row.executionRunId!);

    expect(reclaimed).toBeNull();
    expect(row.status).toBe("in_progress");
    expect(row.leaseExpiresAt?.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(fake.whereQueries[0].sql).toMatch(/heartbeat_runs.*status.*coalesce.*last_output_at.*updated_at.*15 minutes/s);
  });

  it("does not clear a newer execution owner selected after the reclaim snapshot", async () => {
    const row = leaseRow(new Date(Date.now() - 60_000));
    const staleExecutionRunId = row.executionRunId!;
    const fake = createLeaseDb(row);
    const service = realIssueService(fake.db);
    row.executionRunId = randomUUID();

    const reclaimed = await service.reclaimExpiredLease(row.id, row.checkoutRunId!, staleExecutionRunId);

    expect(reclaimed).toBeNull();
    expect(row.status).toBe("in_progress");
    expect(row.executionRunId).not.toBe(staleExecutionRunId);
  });

  it("rejects a mutation after execution ownership moves to another run", async () => {
    const row = leaseRow(new Date(Date.now() + 10 * 60_000));
    const actorRunId = row.checkoutRunId!;
    const fake = createLeaseDb(row);
    const service = realIssueService(fake.db);
    row.executionRunId = randomUUID();

    await expect(service.assertCheckoutOwner(row.id, row.assigneeAgentId!, actorRunId)).rejects.toThrow(
      "Issue run ownership conflict",
    );
  });
});
