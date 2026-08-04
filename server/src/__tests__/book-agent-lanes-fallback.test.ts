// PR #30 Chronos rereview-v2 — blocking P1A, caller level, REAL embedded
// Postgres: `callAgentLane` may expose a fallback-safe lane failure at its
// timeout ONLY when durable state proves no successful peer result can be
// used and no active peer can still win. These tests drive the REAL
// dispatch → poll → guarded abandon → classification-refetch path against a
// real database. The peer's callback is raced deterministically by a Db
// wrapper that fires INSIDE the abandon statement's await — i.e. exactly
// "callback commits between the final poll and the abandon UPDATE".
//
// Only network seams are stubbed (bridge fetch + reachability); every
// delegation-row transition is real SQL against embedded Postgres.
import { randomUUID } from "node:crypto";
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
import { companies, createDb, jarvisDelegations } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

vi.mock("../services/jarvis-delegation.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../services/jarvis-delegation.js")>();
  return { ...mod, checkPeerReachable: vi.fn(async () => ({ reachable: true })) };
});

import { callAgentLane, AgentLaneUnavailableError } from "../services/book-agent-lanes.js";
import {
  abandonDelegation,
  recordDelegationResult,
  __resetRateLimits,
} from "../services/jarvis-delegation.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported
  ? describe
  : describe.skip;

type RealDb = ReturnType<typeof createDb>;

async function seedCompany(db: RealDb) {
  const [company] = await db
    .insert(companies)
    .values({
      name: `Lane Fallback Race ${randomUUID()}`,
      issuePrefix: `LF${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .returning();
  return company!;
}

async function soleRow(db: RealDb, companyId: string) {
  const rows = await db
    .select()
    .from(jarvisDelegations)
    .where(eq(jarvisDelegations.companyId, companyId));
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

function callbackToken(row: { metadata: unknown }): string {
  const token = (row.metadata as Record<string, unknown>).callbackToken;
  expect(typeof token).toBe("string");
  return token as string;
}

/**
 * Wrap the real Db so the FIRST `update()` (which inside callAgentLane's
 * timeout path is exactly abandonDelegation's guarded UPDATE) runs `hook`
 * before the statement executes. The hook races the peer callback (or a
 * deletion, or a DB failure) in at the precise abandon moment.
 */
function withAbandonRaceHook(db: RealDb, hook: () => Promise<void>): RealDb {
  let armed = true;
  const wrapBuilder = <T extends object>(builder: T): T =>
    new Proxy(builder, {
      get(target, prop) {
        if (prop === "then") {
          const realThen = Reflect.get(target, "then") as Promise<unknown>["then"];
          return (onFulfilled?: any, onRejected?: any) =>
            hook().then(
              () => {
                realThen.call(target, onFulfilled, onRejected);
              },
              (err) => {
                // Route a hook failure through the await's own reject channel
                // (abandonDelegation's await) — never an orphan rejection.
                if (onRejected) onRejected(err);
              },
            );
        }
        const value = Reflect.get(target, prop);
        if (typeof value === "function") {
          return (...args: unknown[]) => {
            const result = (value as (...a: unknown[]) => unknown).apply(target, args);
            return result && typeof (result as { then?: unknown }).then === "function"
              ? wrapBuilder(result as object)
              : result;
          };
        }
        return value;
      },
    });
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "update" && armed) {
        armed = false;
        return (...args: unknown[]) => {
          const builder = (Reflect.get(target, "update") as (...a: unknown[]) => object).apply(
            target,
            args,
          );
          return wrapBuilder(builder);
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  }) as RealDb;
}

describeEmbeddedPostgres("callAgentLane timeout fallback safety — real embedded Postgres races (P1A)", () => {
  let db!: RealDb;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    vi.stubEnv("JARVIS_PEER_CALLIOPE_URL", "http://127.0.0.1:29991");
    vi.stubEnv("JARVIS_PEER_CALLIOPE_TOKEN", "test-calliope-token");
    vi.stubEnv("JARVIS_PEER_HADES_URL", "http://127.0.0.1:29992");
    vi.stubEnv("JARVIS_PEER_HADES_TOKEN", "test-hades-token");
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-lane-fallback-");
    db = createDb(tempDb.connectionString);
    // The bridge daemon does not exist in tests: every fetch (reachability
    // probe + fire-and-forget dispatch POST) answers 200 so no background
    // markDelegationFailed can touch the row under test.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
  }, 30_000);

  beforeEach(() => {
    __resetRateLimits();
  });

  afterEach(async () => {
    await db.delete(jarvisDelegations);
    await db.delete(companies);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await tempDb?.cleanup();
  });

  const laneArgs = (companyId: string, lane: "calliope" | "hades") => ({
    lane,
    companyId,
    task: "race probe",
    requestedByActorId: `actor-${randomUUID()}`,
    timeoutMs: 80,
    pollIntervalMs: 10,
  });

  it("callback wins between the final poll and the abandon ⇒ the PEER result is returned, never a model-fallback error", async () => {
    const company = await seedCompany(db);
    const raced = withAbandonRaceHook(db, async () => {
      const row = await soleRow(db, company.id);
      const out = await recordDelegationResult(db, {
        delegationId: row.id,
        companyId: company.id,
        callbackToken: callbackToken(row),
        status: "completed",
        result: "the peer's real answer",
      });
      expect(out.ok).toBe(true);
    });

    const out = await callAgentLane(raced, laneArgs(company.id, "calliope"));

    expect(out.text).toBe("the peer's real answer");
    expect(out.lane).toBe("calliope");
    // Durable truth: the row is COMPLETED with the peer's result — never
    // abandoned, never overwritten by the losing timeout path.
    const after = await soleRow(db, company.id);
    expect(after.id).toBe(out.delegationId);
    expect(after.status).toBe("completed");
    expect(after.result).toBe("the peer's real answer");
  });

  it.each(["calliope", "hades"] as const)(
    "abandon wins the race (%s lane) ⇒ fallback-safe timeout error and a durably abandoned row",
    async (lane) => {
      const company = await seedCompany(db);

      const err = await callAgentLane(db, laneArgs(company.id, lane)).catch((e) => e);

      expect(err).toBeInstanceOf(AgentLaneUnavailableError);
      expect(err.fallbackSafe).toBe(true);
      expect(err.reason).toContain("abandoned");
      const after = await soleRow(db, company.id);
      expect(after.status).toBe("abandoned");
      expect(after.result).toContain("timed out");
      expect(after.completedAt).not.toBeNull();
    },
  );

  it("failed callback wins the race ⇒ fallback-safe failure error; the durable failure is preserved", async () => {
    const company = await seedCompany(db);
    const raced = withAbandonRaceHook(db, async () => {
      const row = await soleRow(db, company.id);
      const out = await recordDelegationResult(db, {
        delegationId: row.id,
        companyId: company.id,
        callbackToken: callbackToken(row),
        status: "failed",
        error: "bridge exploded",
      });
      expect(out.ok).toBe(true);
    });

    const err = await callAgentLane(raced, laneArgs(company.id, "hades")).catch((e) => e);

    expect(err).toBeInstanceOf(AgentLaneUnavailableError);
    expect(err.fallbackSafe).toBe(true);
    expect(err.reason).toContain("bridge exploded");
    const after = await soleRow(db, company.id);
    expect(after.status).toBe("failed");
    expect(after.result).toBe("bridge exploded");
  });

  it("already abandoned at the deadline ⇒ fallback-safe abandoned error; the original abandonment is untouched", async () => {
    const company = await seedCompany(db);
    const raced = withAbandonRaceHook(db, async () => {
      const row = await soleRow(db, company.id);
      const won = await abandonDelegation(db, {
        delegationId: row.id,
        companyId: company.id,
        reason: "prior timeout — already abandoned",
      });
      expect(won).toBe(true);
    });

    const err = await callAgentLane(raced, laneArgs(company.id, "calliope")).catch((e) => e);

    expect(err).toBeInstanceOf(AgentLaneUnavailableError);
    expect(err.fallbackSafe).toBe(true);
    expect(err.reason).toContain("abandoned");
    const after = await soleRow(db, company.id);
    expect(after.status).toBe("abandoned");
    // The FIRST abandonment wins; the zero-row loser overwrote nothing.
    expect(after.result).toBe("prior timeout — already abandoned");
  });

  it("row missing after a zero-row abandon ⇒ indeterminate safety error, NOT fallback-safe", async () => {
    const company = await seedCompany(db);
    const raced = withAbandonRaceHook(db, async () => {
      const row = await soleRow(db, company.id);
      await db.delete(jarvisDelegations).where(eq(jarvisDelegations.id, row.id));
    });

    const err = await callAgentLane(raced, laneArgs(company.id, "calliope")).catch((e) => e);

    expect(err).toBeInstanceOf(AgentLaneUnavailableError);
    expect(err.fallbackSafe).toBe(false);
    expect(err.reason).not.toContain("marked abandoned");
    const rows = await db
      .select()
      .from(jarvisDelegations)
      .where(eq(jarvisDelegations.companyId, company.id));
    expect(rows).toHaveLength(0);
  });

  it("an abandonment DB error is NOT proof of abandonment ⇒ distinct non-fallback-safe error; the row stays active", async () => {
    const company = await seedCompany(db);
    const raced = withAbandonRaceHook(db, async () => {
      throw new Error("connection reset by peer");
    });

    const err = await callAgentLane(raced, laneArgs(company.id, "hades")).catch((e) => e);

    expect(err).toBeInstanceOf(AgentLaneUnavailableError);
    expect(err.fallbackSafe).toBe(false);
    expect(err.reason).toContain("connection reset by peer");
    expect(err.reason).not.toContain("marked abandoned");
    // The failed abandon wrote nothing: the row is still queued.
    const after = await soleRow(db, company.id);
    expect(after.status).toBe("queued");
    expect(after.completedAt).toBeNull();
  });

  it("callback wins with an EMPTY result ⇒ explicit terminal no-fallback error (no second paid lane)", async () => {
    const company = await seedCompany(db);
    const raced = withAbandonRaceHook(db, async () => {
      const row = await soleRow(db, company.id);
      const out = await recordDelegationResult(db, {
        delegationId: row.id,
        companyId: company.id,
        callbackToken: callbackToken(row),
        status: "completed",
        result: "   ",
      });
      expect(out.ok).toBe(true);
    });

    const err = await callAgentLane(raced, laneArgs(company.id, "calliope")).catch((e) => e);

    expect(err).toBeInstanceOf(AgentLaneUnavailableError);
    expect(err.fallbackSafe).toBe(false);
    expect(err.reason).toContain("empty result");
    const after = await soleRow(db, company.id);
    expect(after.status).toBe("completed");
  });
});
