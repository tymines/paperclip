import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  companies,
  createDb,
  generationJobs,
  imageProviders,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import type { ImageProvider, PredictionStatus } from "../services/image-providers/types.js";
import {
  pollGenerations,
  reconcileGenerationsOnStartup,
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

let submitCalls = 0;
let pollCalls = 0;
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
    return { predictionId: `prediction-${submitCalls}` };
  },
  pollPrediction: async (id) => {
    pollCalls += 1;
    return pollResult(id);
  },
  downloadOutput: async () => {
    throw new Error("download must not run in recovery verification");
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
    await assert.rejects(
      db.insert(generationJobs).values(
        values(personaId, {
          status: "submitting",
          submissionAttemptId: attemptId,
          submissionStartedAt: new Date(),
        }),
      ),
    );
    evidence.migration = { legacyEligible: false, submittingConstraint: true, uniqueAttempt: true };
    await clearFixture(db);
  }

  // Four fake-provider jobs advance two at a time. The pre-migration-style
  // queued row remains ineligible and receives zero POSTs.
  {
    const { personaId } = await seedFixture(db);
    submitCalls = 0;
    pollCalls = 0;
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
    submitCalls = 0;
    pollCalls = 0;
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

  // Provider success without an output URL terminates without a download or
  // leaking provider details into the durable error.
  {
    const { personaId } = await seedFixture(db);
    submitCalls = 0;
    pollCalls = 0;
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
  await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
  await cleanupDatabase();
}
