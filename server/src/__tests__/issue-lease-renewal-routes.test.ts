import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renewIssueLeaseSchema } from "@paperclipai/shared/validators/issue";
import { errorHandler } from "../middleware/index.js";
import { issueService as realIssueService } from "../services/issues.js";

const routeMocks = vi.hoisted(() => ({
  getById: vi.fn(),
  renewLease: vi.fn(),
  logActivity: vi.fn(),
}));

vi.mock("../services/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/index.js")>();
  return {
    ...actual,
    issueService: () => ({
      getById: routeMocks.getById,
      renewLease: routeMocks.renewLease,
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

type HeartbeatRun = {
  id: string;
  status: string;
  updatedAt: Date;
};

function createLeaseDb(row: LeaseRow, heartbeatRun: HeartbeatRun | null = null) {
  const whereQueries: Array<{ sql: string; params: unknown[] }> = [];
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
              const isHeartbeatExtension = !isReclaim && "updatedAt" in patch;
              const now = new Date();
              const expired = row.status === "in_progress" && row.leaseExpiresAt !== null && row.leaseExpiresAt < now;
              const expectedRunMatches = query.params.includes(row.checkoutRunId);
              const recentRunningHeartbeat = heartbeatRun?.id === row.checkoutRunId
                && heartbeatRun.status === "running"
                && heartbeatRun.updatedAt.getTime() > now.getTime() - 15 * 60_000;
              const heartbeatAwareReclaim = isReclaim && query.sql.includes("heartbeat_runs");
              const matches = isHeartbeatExtension
                ? expired && expectedRunMatches && recentRunningHeartbeat
                : isReclaim
                  ? expired && expectedRunMatches && (!heartbeatAwareReclaim || !recentRunningHeartbeat)
                  : row.status === "in_progress"
                    && query.params.includes(row.assigneeAgentId)
                    && expectedRunMatches
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
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => Promise.resolve([]),
          }),
        }),
      }),
    }),
  };

  return { db: db as never, row, whereQueries };
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
    return {
      id: randomUUID(),
      companyId: randomUUID(),
      status: "in_progress",
      assigneeAgentId: randomUUID(),
      checkoutRunId: randomUUID(),
      executionRunId: randomUUID(),
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
    expect(fake.whereQueries[0].sql).toMatch(/"id".*"status".*"assignee_agent_id".*"checkout_run_id".*"lease_expires_at"/s);
    expect(fake.whereQueries[0].sql).toMatch(/now\(\)/);
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
    row.leaseExpiresAt = new Date(Date.now() - 60_000);
    await expect(service.renewLease(row.id, row.assigneeAgentId!, row.checkoutRunId!)).rejects.toThrow(
      "Issue lease renewal conflict",
    );
  });

  it("allows exactly one service caller to reclaim an expired lease and clears ownership", async () => {
    const row = leaseRow(new Date(Date.now() - 60_000));
    const fake = createLeaseDb(row);
    const service = realIssueService(fake.db);

    const results = await Promise.all([
      service.reclaimExpiredLease(row.id, row.checkoutRunId!),
      service.reclaimExpiredLease(row.id, row.checkoutRunId!),
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
    expect(fake.whereQueries[0].sql).toMatch(/"id".*"status".*"lease_expires_at"/s);
    expect(fake.whereQueries[0].sql).toMatch(/now\(\)/);
  });

  it("extends an expired lease for a recent running heartbeat and reclaims it once stale", async () => {
    const now = Date.now();
    const row = leaseRow(new Date(now - 60_000));
    const heartbeatRun = {
      id: row.checkoutRunId!,
      status: "running",
      updatedAt: new Date(now - 60_000),
    };
    const fake = createLeaseDb(row, heartbeatRun);
    const service = realIssueService(fake.db);

    await expect(service.reclaimExpiredLease(row.id, row.checkoutRunId!)).resolves.toBeNull();
    expect(row.status).toBe("in_progress");
    expect(row.leaseExpiresAt!.getTime()).toBeGreaterThan(now + 14 * 60_000);

    row.leaseExpiresAt = new Date(now - 60_000);
    heartbeatRun.updatedAt = new Date(now - 16 * 60_000);
    await expect(service.reclaimExpiredLease(row.id, row.checkoutRunId!)).resolves.toMatchObject({ status: "todo" });
    expect(row.status).toBe("todo");
    expect(fake.whereQueries.map((query) => query.sql).join("\n")).toMatch(/heartbeat_runs.*status.*updated_at/s);
  });
});
