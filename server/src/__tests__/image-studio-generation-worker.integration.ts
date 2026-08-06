import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import {
  companies,
  createDb,
  generationJobs,
  imageProviders,
  personaGenerations,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import type { ImageProvider, PredictionStatus } from "../services/image-providers/types.js";
import {
  beginGenerationWorkerShutdown,
  drainGenerationWorker,
  kickGenerationQueue,
  LANDING_LEASE_MS,
  pollGenerations,
  reconcileGenerationsOnStartup,
  resetGenerationWorkerLifecycleForTests,
  SUBMISSION_LEASE_MS,
  type GenerationWorkerDependencies,
} from "../services/replicate-generator.js";

const externalDatabaseUrl = process.env.IMAGE_STUDIO_TEST_DATABASE_URL?.trim();
let cleanupDatabase = async () => {};
let connectionString: string;
if (externalDatabaseUrl) {
  connectionString = externalDatabaseUrl;
} else {
  const support = await getEmbeddedPostgresTestSupport();
  assert.equal(support.supported, true, support.reason ?? "embedded PostgreSQL unavailable");
  const tempDb = await startEmbeddedPostgresTestDatabase("paperclip-image-studio-worker-");
  connectionString = tempDb.connectionString;
  cleanupDatabase = tempDb.cleanup;
}
const db = createDb(connectionString);
const taskHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-image-studio-home-"));
process.env.PAPERCLIP_HOME = taskHome;

let submitCalls = 0;
let pollCalls = 0;
let downloadCalls = 0;
let submitResult: () => Promise<{ predictionId: string }> = async () => ({
  predictionId: `prediction-${submitCalls}`,
});
let downloadResult: (url: string) => Promise<Buffer> = async () => Buffer.from("fake-image");
let pollResult: (id: string) => PredictionStatus = (id) => ({
  id,
  status: "failed",
  outputUrl: null,
  error: "sensitive provider detail must not persist",
});

const fakeProvider: ImageProvider = {
  id: "replicate",
  name: "Fake Replicate",
  color: "#000000",
  tokenKey: "replicate",
  isConfigured: async () => true,
  verify: async () => ({ ok: true }),
  listModels: async () => [],
  defaultModel: () => "fake/model",
  submitGeneration: async () => {
    submitCalls += 1;
    return submitResult();
  },
  pollPrediction: async (id) => {
    pollCalls += 1;
    return pollResult(id);
  },
  downloadOutput: async (url) => {
    downloadCalls += 1;
    return downloadResult(url);
  },
};

const dependencies: GenerationWorkerDependencies = {
  resolveProvider: (host) => (host === "replicate" ? fakeProvider : null),
};

type RealDb = typeof db;

async function seedFixture(currentDb: RealDb) {
  const [company] = await currentDb
    .insert(companies)
    .values({
      name: `Image worker ${randomUUID()}`,
      issuePrefix: `IW${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .returning();
  const [persona] = await currentDb
    .insert(imageProviders)
    .values({
      companyId: company!.id,
      name: "General",
      type: "external_api",
      providerHost: "replicate",
      attributes: { general: true },
    })
    .returning();
  return { companyId: company!.id, personaId: persona!.id };
}

async function clearFixture(currentDb: RealDb) {
  await currentDb.delete(generationJobs);
  await currentDb.delete(personaGenerations);
  await currentDb.delete(imageProviders);
  await currentDb.delete(companies);
}

function values(
  personaId: string,
  overrides: Partial<typeof generationJobs.$inferInsert> = {},
) {
  return {
    personaId,
    batchId: randomUUID(),
    providerHost: "replicate",
    promptText: "private prompt",
    status: "queued",
    contentRating: "sfw",
    ...overrides,
  } satisfies typeof generationJobs.$inferInsert;
}

function statusCounts(rows: Array<{ status: string }>) {
  return rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
    return counts;
  }, {});
}

function resetFakeProvider() {
  submitCalls = 0;
  pollCalls = 0;
  downloadCalls = 0;
  submitResult = async () => ({ predictionId: `prediction-${submitCalls}` });
  downloadResult = async () => Buffer.from("fake-image");
  pollResult = (id) => ({ id, status: "failed", outputUrl: null });
  resetGenerationWorkerLifecycleForTests();
}

function withPersonaGenerationInsertFailure(currentDb: RealDb): RealDb {
  return new Proxy(currentDb, {
    get(target, property) {
      if (property === "insert") {
        return (table: unknown) => {
          if (table === personaGenerations) {
            throw new Error("sensitive database failure detail");
          }
          return (target.insert as (targetTable: unknown) => unknown).call(target, table);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as RealDb;
}

const evidence: Record<string, unknown> = {};

try {
  process.env.REPLICATE_CONCURRENCY_CAP = "2";

  // Exact migration behavior: omitted eligibility remains NULL, the new
  // submitting state satisfies the constraint, and attempt ids are unique.
  {
    const { personaId } = await seedFixture(db);
    const [legacy] = await db.insert(generationJobs).values(values(personaId)).returning();
    assert.equal(legacy!.submissionEligibleAt, null);

    const attemptId = randomUUID();
    await db.insert(generationJobs).values(
      values(personaId, {
        status: "submitting",
        submissionAttemptId: attemptId,
        submissionStartedAt: new Date(),
      }),
    );
    const [landing] = await db.insert(generationJobs).values(
      values(personaId, {
        status: "landing",
        landingStartedAt: new Date(),
        replicatePredictionId: "migration-landing-handle",
      }),
    ).returning();
    await assert.rejects(
      db.insert(generationJobs).values(
        values(personaId, {
          status: "submitting",
          submissionAttemptId: attemptId,
          submissionStartedAt: new Date(),
        }),
      ),
    );
    assert.equal(landing!.status, "landing");
    assert.equal(landing!.landingStartedAt instanceof Date, true);
    evidence.migration = {
      legacyEligible: false,
      submittingConstraint: true,
      landingConstraint: true,
      uniqueAttempt: true,
    };
    await clearFixture(db);
  }

  // Four fake-provider jobs advance two at a time. The pre-migration-style
  // queued row remains ineligible and receives zero POSTs.
  {
    const { personaId } = await seedFixture(db);
    resetFakeProvider();
    pollResult = (id) => ({ id, status: "failed", outputUrl: null });
    const batchId = randomUUID();
    await db.insert(generationJobs).values(
      Array.from({ length: 4 }, () =>
        values(personaId, { batchId, submissionEligibleAt: new Date() }),
      ),
    );
    const [stale] = await db.insert(generationJobs).values(values(personaId)).returning();

    const first = await pollGenerations(db, dependencies);
    let rows = await db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.batchId, batchId));
    assert.equal(first.submitted, 2);
    assert.deepEqual(statusCounts(rows), { submitted: 2, queued: 2 });
    assert.equal(submitCalls, 2);

    const second = await pollGenerations(db, dependencies);
    rows = await db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.batchId, batchId));
    assert.equal(second.failed, 2);
    assert.equal(second.submitted, 2);
    assert.deepEqual(statusCounts(rows), { failed: 2, submitted: 2 });
    assert.equal(submitCalls, 4);

    await pollGenerations(db, dependencies);
    rows = await db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.batchId, batchId));
    assert.deepEqual(statusCounts(rows), { failed: 4 });
    assert.equal(submitCalls, 4);
    const [staleAfter] = await db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.id, stale!.id));
    assert.equal(staleAfter!.status, "queued");
    assert.equal(staleAfter!.submissionEligibleAt, null);
    evidence.concurrency = {
      afterTick1: { submitted: 2, queued: 2 },
      afterTick2: { failed: 2, submitted: 2 },
      final: { failed: 4 },
      fakeProviderPosts: submitCalls,
      staleQueuedSubmitted: false,
    };
    await clearFixture(db);
  }

  // Restart is GET-only for durable handles. An expired submitting claim has an
  // unknown POST outcome, so it is terminally quarantined and never POSTed.
  {
    const { personaId } = await seedFixture(db);
    resetFakeProvider();
    pollResult = (id) => ({
      id,
      status: "failed",
      outputUrl: null,
      error: "sensitive provider detail must not persist",
    });
    const old = new Date(Date.now() - SUBMISSION_LEASE_MS - 1_000);
    const inserted = await db
      .insert(generationJobs)
      .values([
        values(personaId, {
          status: "submitted",
          replicatePredictionId: "durable-handle",
          submissionEligibleAt: new Date(),
        }),
        values(personaId, {
          status: "submitting",
          submissionAttemptId: randomUUID(),
          submissionStartedAt: old,
          submissionEligibleAt: old,
        }),
        values(personaId, {
          status: "submitting",
          submissionAttemptId: randomUUID(),
          submissionStartedAt: new Date(),
          submissionEligibleAt: new Date(),
        }),
        values(personaId),
      ])
      .returning();

    const first = await reconcileGenerationsOnStartup(db, dependencies);
    assert.equal(first.polled, 1);
    assert.equal(first.quarantinedSubmissions, 1);
    assert.equal(pollCalls, 1);
    assert.equal(submitCalls, 0);
    const rows = await db
      .select()
      .from(generationJobs)
      .where(inArray(generationJobs.id, inserted.map((row) => row.id)));
    assert.deepEqual(statusCounts(rows), { failed: 2, submitting: 1, queued: 1 });
    assert.equal(JSON.stringify(rows).includes("sensitive provider detail"), false);
    assert.equal(rows.find((row) => row.status === "queued")!.submissionEligibleAt, null);
    assert.equal(
      rows.find((row) => row.status === "failed" && row.submissionAttemptId)?.errorMessage?.includes("not retried"),
      true,
    );

    const second = await reconcileGenerationsOnStartup(db, dependencies);
    assert.equal(second.polled, 0);
    assert.equal(second.quarantinedSubmissions, 0);
    assert.equal(submitCalls, 0);
    evidence.restart = {
      first: { polled: 1, quarantinedSubmissions: 1 },
      second: { polled: 0, quarantinedSubmissions: 0 },
      fakeProviderPosts: 0,
      durableState: { failed: 2, submitting: 1, queued: 1 },
    };
    await clearFixture(db);
  }

  // Every provider-success landing failure is terminal and sanitized. A crash
  // that leaves the durable `landing` state is reconciled after its lease.
  {
    const landingEvidence: Record<string, unknown> = {};

    // Provider download failure.
    {
      const { personaId } = await seedFixture(db);
      resetFakeProvider();
      pollResult = (id) => ({
        id,
        status: "succeeded",
        outputUrl: "https://private.example/output.png",
      });
      downloadResult = async () => {
        throw new Error("private download URL and token");
      };
      const [job] = await db
        .insert(generationJobs)
        .values(values(personaId, {
          status: "submitted",
          replicatePredictionId: "download-failure-handle",
          submissionEligibleAt: new Date(),
        }))
        .returning();
      await reconcileGenerationsOnStartup(db, dependencies);
      const [after] = await db.select().from(generationJobs).where(eq(generationJobs.id, job!.id));
      assert.equal(after!.status, "failed");
      assert.equal(after!.errorMessage, "Generation output could not be stored safely.");
      assert.equal(downloadCalls, 1);
      assert.equal(after!.errorMessage?.includes("private"), false);
      landingEvidence.downloadFailure = "failed";
      await clearFixture(db);
    }

    // Filesystem failure after download.
    {
      const { personaId } = await seedFixture(db);
      resetFakeProvider();
      pollResult = (id) => ({ id, status: "succeeded", outputUrl: "https://private.example/fs.png" });
      const blockedHome = path.join(taskHome, "not-a-directory");
      await fs.writeFile(blockedHome, "blocked");
      process.env.PAPERCLIP_HOME = blockedHome;
      const [job] = await db
        .insert(generationJobs)
        .values(values(personaId, {
          status: "submitted",
          replicatePredictionId: "filesystem-failure-handle",
          submissionEligibleAt: new Date(),
        }))
        .returning();
      await reconcileGenerationsOnStartup(db, dependencies);
      process.env.PAPERCLIP_HOME = taskHome;
      const [after] = await db.select().from(generationJobs).where(eq(generationJobs.id, job!.id));
      assert.equal(after!.status, "failed");
      assert.equal(after!.errorMessage, "Generation output could not be stored safely.");
      assert.equal(downloadCalls, 0);
      landingEvidence.filesystemFailure = "failed";
      await clearFixture(db);
    }

    // Gallery database failure after download/file write.
    {
      const { personaId } = await seedFixture(db);
      resetFakeProvider();
      pollResult = (id) => ({ id, status: "succeeded", outputUrl: "https://private.example/db.png" });
      const [job] = await db
        .insert(generationJobs)
        .values(values(personaId, {
          status: "submitted",
          replicatePredictionId: "database-failure-handle",
          submissionEligibleAt: new Date(),
        }))
        .returning();
      await reconcileGenerationsOnStartup(withPersonaGenerationInsertFailure(db), dependencies);
      const [after] = await db.select().from(generationJobs).where(eq(generationJobs.id, job!.id));
      assert.equal(after!.status, "failed");
      assert.equal(after!.errorMessage, "Generation output could not be stored safely.");
      assert.equal(after!.errorMessage?.includes("sensitive database"), false);
      landingEvidence.databaseFailure = "failed";
      await clearFixture(db);
    }

    // Restart reconciliation of a crashed/expired landing claim.
    {
      const { personaId } = await seedFixture(db);
      resetFakeProvider();
      const old = new Date(Date.now() - LANDING_LEASE_MS - 1_000);
      const [job] = await db
        .insert(generationJobs)
        .values(values(personaId, {
          status: "landing",
          landingStartedAt: old,
          replicatePredictionId: "crashed-landing-handle",
          submissionEligibleAt: old,
        }))
        .returning();
      const result = await reconcileGenerationsOnStartup(db, dependencies);
      const [after] = await db.select().from(generationJobs).where(eq(generationJobs.id, job!.id));
      assert.equal(result.quarantinedLandings, 1);
      assert.equal(after!.status, "failed");
      assert.equal(after!.errorMessage?.includes("interrupted"), true);
      assert.equal(pollCalls, 0);
      assert.equal(downloadCalls, 0);
      landingEvidence.restart = { quarantinedLandings: 1, status: "failed" };
      await clearFixture(db);
    }

    evidence.landingFailures = landingEvidence;
  }

  // Shutdown prevents new kicks and boundedly drains an already-active delayed
  // provider POST before database/process teardown.
  {
    const { personaId } = await seedFixture(db);
    resetFakeProvider();
    let resolveSubmit!: (value: { predictionId: string }) => void;
    submitResult = () => new Promise((resolve) => {
      resolveSubmit = resolve;
    });
    await db.insert(generationJobs).values(values(personaId, { submissionEligibleAt: new Date() }));

    const activeTick = pollGenerations(db, dependencies);
    while (submitCalls === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    beginGenerationWorkerShutdown();
    const skipped = await kickGenerationQueue(db, dependencies);
    assert.equal(skipped.skippedDuringShutdown, true);
    assert.equal(await drainGenerationWorker(10), false);
    resolveSubmit({ predictionId: "delayed-prediction" });
    await activeTick;
    assert.equal(await drainGenerationWorker(100), true);
    assert.equal(submitCalls, 1);
    evidence.shutdownDrain = {
      newKickSkipped: true,
      timedOutWhilePostDelayed: true,
      drainedAfterPostResolved: true,
      fakeProviderPosts: 1,
    };
    resetGenerationWorkerLifecycleForTests();
    await clearFixture(db);
  }

  // Provider success without an output URL terminates without a download or
  // leaking provider details into the durable error.
  {
    const { personaId } = await seedFixture(db);
    resetFakeProvider();
    pollResult = (id) => ({ id, status: "succeeded", outputUrl: null });
    const [job] = await db
      .insert(generationJobs)
      .values(
        values(personaId, {
          status: "submitted",
          replicatePredictionId: "outputless-handle",
          submissionEligibleAt: new Date(),
        }),
      )
      .returning();
    await reconcileGenerationsOnStartup(db, dependencies);
    const [after] = await db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.id, job!.id));
    assert.equal(after!.status, "failed");
    assert.equal(after!.errorMessage, "Provider completed the generation without an output.");
    assert.equal(submitCalls, 0);
    evidence.outputlessSuccess = { status: after!.status, fakeProviderPosts: 0 };
    await clearFixture(db);
  }

  console.log(JSON.stringify({ ok: true, ...evidence }, null, 2));
} finally {
  delete process.env.REPLICATE_CONCURRENCY_CAP;
  delete process.env.PAPERCLIP_HOME;
  await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
  await cleanupDatabase();
  await fs.rm(taskHome, { recursive: true, force: true });
}
