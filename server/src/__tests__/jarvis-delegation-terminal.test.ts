// PR #30 Chronos rereview v2 — blocking P1 findings:
//
// P1A — delegation terminality must be enforced ATOMICALLY in the database
// statement (company + id + allowed source status), not by a check-then-update
// read. No terminal state (completed | failed | abandoned) may ever regress
// under duplicate, out-of-order, or racing callbacks, and the asynchronous
// markFailed path must be terminal-safe and company-scoped too. These tests
// run against REAL embedded Postgres so affected-row/race semantics are real.
//
// P1B — one shared delegation-status contract (queued | running | completed |
// failed | abandoned) flows through service + list route + consumers:
// `?status=abandoned` must filter, and an unknown status must be rejected
// with a 400 rather than silently returning an unfiltered list.
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { companies, createDb, jarvisDelegations } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { jarvisRoutes } from "../routes/jarvis.js";
import { errorHandler } from "../middleware/error-handler.js";
import {
  abandonDelegation,
  listDelegations,
  recordDelegationResult,
} from "../services/jarvis-delegation.js";
// Namespace import so this suite loads (and fails granularly) even before the
// terminal-safe markDelegationFailed export exists (RED-first TDD).
import * as delegationService from "../services/jarvis-delegation.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported
  ? describe
  : describe.skip;

function buildApp(db: ReturnType<typeof createDb>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { actor: unknown }).actor = {
      type: "board",
      userId: "test-user",
      userName: "Test",
      userEmail: null,
      isInstanceAdmin: true,
      source: "local_implicit",
      companyIds: undefined,
      memberships: [],
    };
    next();
  });
  app.use("/api", jarvisRoutes(db));
  app.use(errorHandler);
  return app;
}

async function seedCompany(db: ReturnType<typeof createDb>) {
  const [company] = await db
    .insert(companies)
    .values({
      name: `Terminal Race Test ${randomUUID()}`,
      issuePrefix: `TR${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .returning();
  return company!;
}

async function insertDelegation(
  db: ReturnType<typeof createDb>,
  companyId: string,
  overrides: Partial<typeof jarvisDelegations.$inferInsert> = {},
) {
  const [row] = await db
    .insert(jarvisDelegations)
    .values({
      companyId,
      agent: "hermes",
      task: "terminal race probe",
      status: "queued",
      metadata: { callbackToken: "tok-1", origin: "terminal-race-test" },
      ...overrides,
    })
    .returning();
  return row!;
}

async function fetchRow(db: ReturnType<typeof createDb>, id: string) {
  const [row] = await db
    .select()
    .from(jarvisDelegations)
    .where(eq(jarvisDelegations.id, id))
    .limit(1);
  return row!;
}

const TERMINAL_COMPLETED_AT = new Date("2026-07-27T00:00:00.000Z");

describeEmbeddedPostgres("delegation terminal transitions are atomic (P1A)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-jarvis-terminal-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.delete(jarvisDelegations);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("a duplicate completed callback against a completed row cannot rewrite the terminal audit row", async () => {
    const company = await seedCompany(db);
    const row = await insertDelegation(db, company.id, {
      status: "completed",
      result: "first terminal result",
      completedAt: TERMINAL_COMPLETED_AT,
    });

    const out = await recordDelegationResult(db, {
      delegationId: row.id,
      companyId: company.id,
      callbackToken: "tok-1",
      status: "completed",
      result: "second (duplicate) result",
    });

    expect(out.ok).toBe(false);
    const after = await fetchRow(db, row.id);
    expect(after.status).toBe("completed");
    expect(after.result).toBe("first terminal result");
    expect(after.completedAt).toEqual(TERMINAL_COMPLETED_AT);
    // The duplicate is classified for audit WITHOUT touching unrelated metadata.
    const meta = after.metadata as Record<string, unknown>;
    expect(meta.origin).toBe("terminal-race-test");
    expect(meta.callbackToken).toBe("tok-1");
    expect(meta.lateCallback).toMatchObject({
      status: "completed",
      result: "second (duplicate) result",
    });
  });

  it("an out-of-order running callback after completed cannot regress the terminal row", async () => {
    const company = await seedCompany(db);
    const row = await insertDelegation(db, company.id, {
      status: "completed",
      result: "done",
      completedAt: TERMINAL_COMPLETED_AT,
    });

    const out = await recordDelegationResult(db, {
      delegationId: row.id,
      companyId: company.id,
      callbackToken: "tok-1",
      status: "running",
    });

    expect(out.ok).toBe(false);
    const after = await fetchRow(db, row.id);
    expect(after.status).toBe("completed");
    expect(after.result).toBe("done");
    expect(after.completedAt).toEqual(TERMINAL_COMPLETED_AT);
  });

  it("an out-of-order running callback after failed cannot regress the terminal row", async () => {
    const company = await seedCompany(db);
    const row = await insertDelegation(db, company.id, {
      status: "failed",
      result: "bridge_500",
      completedAt: TERMINAL_COMPLETED_AT,
    });

    const out = await recordDelegationResult(db, {
      delegationId: row.id,
      companyId: company.id,
      callbackToken: "tok-1",
      status: "running",
    });

    expect(out.ok).toBe(false);
    const after = await fetchRow(db, row.id);
    expect(after.status).toBe("failed");
    expect(after.result).toBe("bridge_500");
    expect(after.completedAt).toEqual(TERMINAL_COMPLETED_AT);
  });

  it("a completed callback after failed cannot flip the terminal failure", async () => {
    const company = await seedCompany(db);
    const row = await insertDelegation(db, company.id, {
      status: "failed",
      result: "peer exploded",
      completedAt: TERMINAL_COMPLETED_AT,
    });

    const out = await recordDelegationResult(db, {
      delegationId: row.id,
      companyId: company.id,
      callbackToken: "tok-1",
      status: "completed",
      result: "actually it worked",
    });

    expect(out.ok).toBe(false);
    const after = await fetchRow(db, row.id);
    expect(after.status).toBe("failed");
    expect(after.result).toBe("peer exploded");
    expect(after.completedAt).toEqual(TERMINAL_COMPLETED_AT);
    const meta = after.metadata as Record<string, unknown>;
    expect(meta.lateCallback).toMatchObject({
      status: "completed",
      result: "actually it worked",
    });
  });

  it("a late callback after abandoned is rejected, classified, and cannot overwrite the terminal row", async () => {
    const company = await seedCompany(db);
    const row = await insertDelegation(db, company.id, {
      status: "abandoned",
      result: "timed out after 45000ms — abandoned before fallback",
      completedAt: TERMINAL_COMPLETED_AT,
    });

    const out = await recordDelegationResult(db, {
      delegationId: row.id,
      companyId: company.id,
      callbackToken: "tok-1",
      status: "completed",
      result: "sorry I'm late",
    });

    expect(out).toEqual({ ok: false, error: "delegation_abandoned" });
    const after = await fetchRow(db, row.id);
    expect(after.status).toBe("abandoned");
    expect(after.result).toContain("timed out");
    expect(after.completedAt).toEqual(TERMINAL_COMPLETED_AT);
    const meta = after.metadata as Record<string, unknown>;
    expect(meta.origin).toBe("terminal-race-test");
    expect(meta.lateCallback).toMatchObject({ status: "completed", result: "sorry I'm late" });
  });

  it("markDelegationFailed is terminal-safe and company-scoped", async () => {
    const markDelegationFailed = (
      delegationService as {
        markDelegationFailed?: (
          db: ReturnType<typeof createDb>,
          ref: { delegationId: string; companyId: string },
          error: string,
        ) => Promise<void>;
      }
    ).markDelegationFailed;
    expect(typeof markDelegationFailed).toBe("function");

    const company = await seedCompany(db);
    const otherCompany = await seedCompany(db);

    // After terminal completion: no-op.
    const completed = await insertDelegation(db, company.id, {
      status: "completed",
      result: "done",
      completedAt: TERMINAL_COMPLETED_AT,
    });
    await markDelegationFailed!(db, { delegationId: completed.id, companyId: company.id }, "bridge_500");
    let after = await fetchRow(db, completed.id);
    expect(after.status).toBe("completed");
    expect(after.result).toBe("done");
    expect(after.completedAt).toEqual(TERMINAL_COMPLETED_AT);

    // After terminal abandonment: no-op.
    const abandoned = await insertDelegation(db, company.id, {
      status: "abandoned",
      result: "timed out",
      completedAt: TERMINAL_COMPLETED_AT,
    });
    await markDelegationFailed!(db, { delegationId: abandoned.id, companyId: company.id }, "bridge_500");
    after = await fetchRow(db, abandoned.id);
    expect(after.status).toBe("abandoned");
    expect(after.result).toBe("timed out");

    // Wrong company scope: no-op even on an active row.
    const active = await insertDelegation(db, company.id, { status: "queued" });
    await markDelegationFailed!(db, { delegationId: active.id, companyId: otherCompany.id }, "bridge_500");
    after = await fetchRow(db, active.id);
    expect(after.status).toBe("queued");

    // Active row, correct company: transitions to failed.
    await markDelegationFailed!(db, { delegationId: active.id, companyId: company.id }, "bridge_500");
    after = await fetchRow(db, active.id);
    expect(after.status).toBe("failed");
    expect(after.result).toBe("bridge_500");
    expect(after.completedAt).not.toBeNull();
  });

  it("bad-token rejection precedes any terminal handling and writes no audit metadata", async () => {
    const company = await seedCompany(db);
    const row = await insertDelegation(db, company.id, {
      status: "abandoned",
      result: "timed out",
      completedAt: TERMINAL_COMPLETED_AT,
    });

    const out = await recordDelegationResult(db, {
      delegationId: row.id,
      companyId: company.id,
      callbackToken: "wrong-token",
      status: "completed",
      result: "forged",
    });

    expect(out).toEqual({ ok: false, error: "callback_token_mismatch" });
    const after = await fetchRow(db, row.id);
    expect(after.status).toBe("abandoned");
    const meta = after.metadata as Record<string, unknown>;
    expect(meta.lateCallback).toBeUndefined();
  });

  it("timely transitions still succeed: queued → running → completed", async () => {
    const company = await seedCompany(db);
    const row = await insertDelegation(db, company.id, { status: "queued" });

    const running = await recordDelegationResult(db, {
      delegationId: row.id,
      companyId: company.id,
      callbackToken: "tok-1",
      status: "running",
    });
    expect(running).toEqual({ ok: true });
    expect((await fetchRow(db, row.id)).status).toBe("running");

    const completed = await recordDelegationResult(db, {
      delegationId: row.id,
      companyId: company.id,
      callbackToken: "tok-1",
      status: "completed",
      result: "the answer",
    });
    expect(completed).toEqual({ ok: true });
    const after = await fetchRow(db, row.id);
    expect(after.status).toBe("completed");
    expect(after.result).toBe("the answer");
    expect(after.completedAt).not.toBeNull();
    const meta = after.metadata as Record<string, unknown>;
    expect(meta.lateCallback).toBeUndefined();
  });

  it("callback-vs-abandon race: exactly one transition wins and the terminal row is consistent", async () => {
    const company = await seedCompany(db);
    // Repeat the interleaving — with real Postgres either side can win, but
    // under every outcome exactly ONE transition happens and the loser can
    // never overwrite the winner's terminal state.
    for (let i = 0; i < 8; i += 1) {
      const row = await insertDelegation(db, company.id, { status: "running" });
      const reason = `timed out — race iteration ${i}`;
      const peerResult = `peer result — race iteration ${i}`;

      const [callbackOut, abandoned] = await Promise.all([
        recordDelegationResult(db, {
          delegationId: row.id,
          companyId: company.id,
          callbackToken: "tok-1",
          status: "completed",
          result: peerResult,
        }),
        abandonDelegation(db, {
          delegationId: row.id,
          companyId: company.id,
          reason,
        }),
      ]);

      // Mutually exclusive: exactly one of the two performed the transition.
      expect(callbackOut.ok).toBe(!abandoned);

      const after = await fetchRow(db, row.id);
      if (callbackOut.ok) {
        expect(after.status).toBe("completed");
        expect(after.result).toBe(peerResult);
      } else {
        expect(after.status).toBe("abandoned");
        expect(after.result).toBe(reason);
        // The losing late callback is classified, not applied.
        const meta = after.metadata as Record<string, unknown>;
        expect(meta.lateCallback).toMatchObject({ status: "completed", result: peerResult });
      }
      expect(after.completedAt).not.toBeNull();
    }
  });

  it("duplicate concurrent completed callbacks: exactly one wins the terminal transition", async () => {
    const company = await seedCompany(db);
    const row = await insertDelegation(db, company.id, { status: "running" });

    const outcomes = await Promise.all(
      ["first", "second"].map((label) =>
        recordDelegationResult(db, {
          delegationId: row.id,
          companyId: company.id,
          callbackToken: "tok-1",
          status: "completed",
          result: `peer ${label}`,
        }),
      ),
    );

    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(outcomes.filter((o) => !o.ok)).toHaveLength(1);
    const after = await fetchRow(db, row.id);
    expect(after.status).toBe("completed");
    expect(after.result).toMatch(/^peer (first|second)$/);
    expect(after.completedAt).not.toBeNull();
  });
});

describeEmbeddedPostgres("delegation status contract — service and route (P1B)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-jarvis-status-contract-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.delete(jarvisDelegations);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedAllStatuses(db: ReturnType<typeof createDb>, companyId: string) {
    for (const status of ["queued", "running", "completed", "failed", "abandoned"] as const) {
      await insertDelegation(db, companyId, {
        status,
        task: `task-${status}`,
        ...(status === "completed" || status === "failed" || status === "abandoned"
          ? { completedAt: TERMINAL_COMPLETED_AT }
          : {}),
      });
    }
  }

  it("listDelegations filters by every contract status, including abandoned", async () => {
    const company = await seedCompany(db);
    await seedAllStatuses(db, company.id);

    for (const status of ["queued", "running", "completed", "failed", "abandoned"] as const) {
      const rows = await listDelegations(db, company.id, { status });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe(status);
      expect(rows[0]!.task).toBe(`task-${status}`);
    }

    const all = await listDelegations(db, company.id, {});
    expect(all).toHaveLength(5);
  });

  it("GET .../jarvis/delegations?status=abandoned returns only abandoned rows", async () => {
    const company = await seedCompany(db);
    await seedAllStatuses(db, company.id);
    const app = buildApp(db);

    const resp = await request(app)
      .get(`/api/companies/${company.id}/jarvis/delegations?status=abandoned`)
      .send();

    expect(resp.status).toBe(200);
    expect(resp.body.delegations).toHaveLength(1);
    expect(resp.body.delegations[0].status).toBe("abandoned");
    expect(resp.body.delegations[0].task).toBe("task-abandoned");
  });

  it("GET .../jarvis/delegations?status=<unknown> is rejected 400, never an unfiltered list", async () => {
    const company = await seedCompany(db);
    await seedAllStatuses(db, company.id);
    const app = buildApp(db);

    const resp = await request(app)
      .get(`/api/companies/${company.id}/jarvis/delegations?status=bogus`)
      .send();

    expect(resp.status).toBe(400);
    expect(resp.body).toMatchObject({ ok: false, error: "invalid_status" });
    // Critically: NOT a silent 200 with the unfiltered 5-row list.
    expect(resp.body.delegations).toBeUndefined();
  });

  it("GET .../jarvis/delegations without a status filter returns every status", async () => {
    const company = await seedCompany(db);
    await seedAllStatuses(db, company.id);
    const app = buildApp(db);

    const resp = await request(app)
      .get(`/api/companies/${company.id}/jarvis/delegations`)
      .send();

    expect(resp.status).toBe(200);
    expect(resp.body.delegations).toHaveLength(5);
    const statuses = resp.body.delegations.map((d: { status: string }) => d.status).sort();
    expect(statuses).toEqual(["abandoned", "completed", "failed", "queued", "running"]);
  });
});
