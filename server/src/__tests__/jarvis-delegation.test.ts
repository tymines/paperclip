import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  companies,
  createDb,
  jarvisDelegations,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { jarvisRoutes } from "../routes/jarvis.js";
import { errorHandler } from "../middleware/error-handler.js";
import {
  __resetRateLimits,
  __resetReachabilityCache,
  dispatchDelegation,
  naturalAcknowledgment,
} from "../services/jarvis-delegation.js";
import { TOOL_NAME_TO_PEER } from "../services/jarvis-delegation-tools.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported
  ? describe
  : describe.skip;

function buildApp(db: ReturnType<typeof createDb>) {
  const app = express();
  app.use(express.json());
  // Lightweight actor middleware so jarvisRoutes' assertCompanyAccess
  // calls have an actor to inspect — for delegation routes we use a
  // local-trusted board actor so the GET passes.
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
      name: `Delegation Test ${randomUUID()}`,
      issuePrefix: `DT${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .returning();
  return company!;
}

describeEmbeddedPostgres("jarvis peer-agent delegation", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-jarvis-delegation-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  beforeEach(() => {
    __resetRateLimits();
    __resetReachabilityCache();
  });

  afterEach(async () => {
    await db.delete(jarvisDelegations);
    await db.delete(companies);
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("maps every delegate_to_* tool name to a valid peer identity", () => {
    expect(TOOL_NAME_TO_PEER.delegate_to_hermes).toBe("hermes");
    expect(TOOL_NAME_TO_PEER.delegate_to_august).toBe("august");
    expect(TOOL_NAME_TO_PEER.delegate_to_codex).toBe("codex");
    expect(TOOL_NAME_TO_PEER.delegate_to_content).toBe("content");
    expect(TOOL_NAME_TO_PEER.delegate_to_social).toBe("social");
    expect(TOOL_NAME_TO_PEER.delegate_to_researcher).toBe("researcher");
    expect(TOOL_NAME_TO_PEER.dispatch_claude_code).toBe("claude-code");
  });

  it("phrases acknowledgments naturally — not like a robot", () => {
    const happy = naturalAcknowledgment("hermes", {
      id: "x",
      status: "queued",
      reachable: true,
      remainingQuotaThisMinute: 3,
    });
    expect(happy.toLowerCase()).toContain("on it");
    expect(happy.toLowerCase()).toContain("hermes");
    expect(happy).not.toContain("DELEGATE_TO_");

    const downed = naturalAcknowledgment("august", {
      id: "x",
      status: "queued",
      reachable: false,
      remainingQuotaThisMinute: 3,
      error: "timeout",
    });
    expect(downed).toContain("August's bridge is down");
    expect(downed).toContain("route it elsewhere");

    const limited = naturalAcknowledgment("hermes", {
      id: "",
      status: "failed",
      reachable: false,
      remainingQuotaThisMinute: 0,
      error: "rate_limited: too many",
    });
    expect(limited).toContain("three delegations");
  });

  it("dispatches a delegation end-to-end: row persists, callback flips status, list reflects it", async () => {
    const company = await seedCompany(db);

    // Mock the bridge POST so the test doesn't try to hit a real daemon.
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/health")) {
          return new Response("ok", { status: 200 });
        }
        // /jarvis/dispatch — pretend the peer accepted it.
        return new Response(JSON.stringify({ ok: true }), {
          status: 202,
          headers: { "content-type": "application/json" },
        });
      });

    const dispatch = await dispatchDelegation(db, {
      companyId: company.id,
      agent: "hermes",
      task: "Research the best time to post on Instagram in 2026 for our niche",
      requestedByActorId: "tyler",
    });

    expect(dispatch.id).not.toBe("");
    expect(dispatch.status).toBe("queued");
    expect(dispatch.reachable).toBe(true);
    expect(dispatch.remainingQuotaThisMinute).toBeLessThan(3);

    // The dispatch should have hit the bridge URL at least once.
    const bridgeCall = fetchMock.mock.calls.find(([url]) => {
      const u = typeof url === "string" ? url : url?.toString() ?? "";
      return u.includes("/jarvis/dispatch");
    });
    expect(bridgeCall).toBeDefined();

    // The persisted row carries the callback token in metadata so the
    // peer can authenticate the completion callback.
    const [row] = await db
      .select()
      .from(jarvisDelegations)
      .where(eq(jarvisDelegations.id, dispatch.id))
      .limit(1);
    expect(row).toBeDefined();
    expect(row!.agent).toBe("hermes");
    expect(row!.status).toBe("queued");
    const callbackToken = (row!.metadata as Record<string, unknown>).callbackToken;
    expect(typeof callbackToken).toBe("string");

    // Fire the result callback as the peer would, via the HTTP route.
    const app = buildApp(db);
    const callbackResp = await request(app)
      .post(`/api/companies/${company.id}/jarvis/delegations/${dispatch.id}/result`)
      .set("Authorization", `Bearer ${callbackToken as string}`)
      .send({
        status: "completed",
        result: "Best times: Tue/Thu 11am-1pm and Sun 10am-noon in your audience's TZ.",
      });
    expect(callbackResp.status).toBe(200);

    const [updated] = await db
      .select()
      .from(jarvisDelegations)
      .where(eq(jarvisDelegations.id, dispatch.id))
      .limit(1);
    expect(updated!.status).toBe("completed");
    expect(updated!.result).toContain("Tue/Thu");
    expect(updated!.completedAt).not.toBeNull();

    // The polling endpoint surfaces the completed row.
    const listResp = await request(app)
      .get(`/api/companies/${company.id}/jarvis/delegations`)
      .send();
    expect(listResp.status).toBe(200);
    expect(listResp.body.delegations).toHaveLength(1);
    expect(listResp.body.delegations[0].status).toBe("completed");
  }, 20_000);

  it("rejects result callbacks with a bad token", async () => {
    const company = await seedCompany(db);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok", { status: 200 }),
    );

    const dispatch = await dispatchDelegation(db, {
      companyId: company.id,
      agent: "codex",
      task: "Refactor x",
      requestedByActorId: "tyler",
    });

    const app = buildApp(db);
    const bad = await request(app)
      .post(`/api/companies/${company.id}/jarvis/delegations/${dispatch.id}/result`)
      .set("Authorization", "Bearer wrong-token")
      .send({ status: "completed", result: "x" });
    expect(bad.status).toBe(403);
  });

  it("rate-limits a single actor to 3 delegations per 60s", async () => {
    const company = await seedCompany(db);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok", { status: 200 }),
    );

    const actor = "tyler";
    const r1 = await dispatchDelegation(db, {
      companyId: company.id,
      agent: "hermes",
      task: "t1",
      requestedByActorId: actor,
    });
    const r2 = await dispatchDelegation(db, {
      companyId: company.id,
      agent: "hermes",
      task: "t2",
      requestedByActorId: actor,
    });
    const r3 = await dispatchDelegation(db, {
      companyId: company.id,
      agent: "hermes",
      task: "t3",
      requestedByActorId: actor,
    });
    const r4 = await dispatchDelegation(db, {
      companyId: company.id,
      agent: "hermes",
      task: "t4",
      requestedByActorId: actor,
    });

    expect(r1.status).toBe("queued");
    expect(r2.status).toBe("queued");
    expect(r3.status).toBe("queued");
    expect(r4.status).toBe("failed");
    expect(r4.error).toContain("rate_limited");
  });

  it("marks the row failed when the peer's bridge is unreachable", async () => {
    const company = await seedCompany(db);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/health")) {
        // Pretend daemon is down — both health and dispatch fail.
        throw new Error("ECONNREFUSED");
      }
      throw new Error("ECONNREFUSED");
    });

    const dispatch = await dispatchDelegation(db, {
      companyId: company.id,
      agent: "august",
      task: "Check the remote ops log",
      requestedByActorId: "tyler",
    });

    expect(dispatch.status).toBe("queued"); // row is queued
    expect(dispatch.reachable).toBe(false); // but the peer is down

    // Give the background dispatch task a tick to record the failure.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const [row] = await db
      .select()
      .from(jarvisDelegations)
      .where(eq(jarvisDelegations.id, dispatch.id))
      .limit(1);
    expect(row!.status).toBe("failed");
    expect(row!.result).toBeTruthy();
  });
});
