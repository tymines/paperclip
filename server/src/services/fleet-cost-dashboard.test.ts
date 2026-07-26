import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  aggregateFleetCostDashboard,
  buildFleetObservationEnvelope,
  extractFullHermesSessionId,
  ingestFleetObservations,
  readHermesApiCalls,
  readHermesSessionUsage,
  type FleetObservationStore,
  type HermesRunAttribution,
} from "./fleet-cost-dashboard.js";

const tempPaths: string[] = [];

async function tempDirectory() {
  const path = await mkdtemp(join(tmpdir(), "paperclip-fleet-cost-"));
  tempPaths.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function createHermesStateFixture(path: string) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      started_at REAL,
      ended_at REAL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      api_call_count INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd REAL,
      actual_cost_usd REAL,
      billing_mode TEXT NOT NULL DEFAULT 'unknown',
      cost_status TEXT NOT NULL DEFAULT 'unknown',
      cost_source TEXT NOT NULL DEFAULT 'none',
      pricing_version TEXT
    );
    CREATE TABLE session_model_usage (
      session_id TEXT NOT NULL,
      model TEXT NOT NULL,
      billing_provider TEXT NOT NULL,
      task TEXT NOT NULL DEFAULT '',
      api_call_count INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd REAL,
      actual_cost_usd REAL,
      billing_mode TEXT NOT NULL DEFAULT 'unknown',
      cost_status TEXT NOT NULL DEFAULT 'unknown',
      cost_source TEXT NOT NULL DEFAULT 'none',
      pricing_version TEXT,
      first_seen REAL,
      last_seen REAL
    );
  `);
  db.prepare(`
    INSERT INTO sessions (
      id, started_at, ended_at, input_tokens, output_tokens,
      cache_read_tokens, cache_write_tokens, reasoning_tokens, api_call_count,
      estimated_cost_usd, actual_cost_usd, billing_mode, cost_status, cost_source, pricing_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "20260724_010203_aaaaaaaa",
    100,
    110,
    1000,
    600,
    200,
    50,
    25,
    4,
    0,
    null,
    "subscription_included",
    "included",
    "none",
    "hermes-2026-07",
  );
  const insertUsage = db.prepare(`
    INSERT INTO session_model_usage (
      session_id, model, billing_provider, task, api_call_count,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
      reasoning_tokens, estimated_cost_usd, actual_cost_usd, billing_mode,
      cost_status, cost_source, pricing_version, first_seen, last_seen
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertUsage.run(
    "20260724_010203_aaaaaaaa",
    "model-included",
    "provider-a",
    "",
    3,
    900,
    600,
    200,
    50,
    25,
    0,
    null,
    "subscription_included",
    "included",
    "none",
    "hermes-2026-07",
    100,
    109,
  );
  insertUsage.run(
    "20260724_010203_aaaaaaaa",
    "model-compress",
    "provider-a",
    "compression",
    2,
    100,
    0,
    0,
    0,
    0,
    0.02,
    0.02,
    "metered",
    "estimated",
    "pricing_table",
    "hermes-2026-07",
    105,
    108,
  );
  insertUsage.run(
    "20260724_010203_bbbbbbbb",
    "wrong-prefix-model",
    "provider-a",
    "",
    99,
    99999,
    99999,
    0,
    0,
    0,
    999,
    999,
    "metered",
    "actual",
    "provider",
    "hermes-2026-07",
    100,
    109,
  );
  db.close();
}

function createSidecarFixture(path: string) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE api_calls (
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      api_request_id TEXT NOT NULL,
      paperclip_run_id TEXT,
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      started_at REAL NOT NULL,
      ended_at REAL NOT NULL,
      api_duration REAL NOT NULL,
      ttft REAL,
      PRIMARY KEY (session_id, api_request_id)
    );
  `);
  db.prepare("INSERT INTO api_calls VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      "20260724_010203_aaaaaaaa",
      "turn-1",
      "request-1",
      "run-1",
      "model-included",
      "provider-a",
      500,
      100,
      100,
      20,
      5,
      100,
      102,
      2,
      0.42,
    );
  db.close();
}

describe("fleet cost dashboard collector", () => {
  it("preserves Hermes billing semantics and nullable actual cost", async () => {
    const dir = await tempDirectory();
    const statePath = join(dir, "state.db");
    createHermesStateFixture(statePath);

    const result = readHermesSessionUsage(statePath);

    expect(result.sessions[0]).toMatchObject({
      sessionId: "20260724_010203_aaaaaaaa",
      estimatedCostUsd: 0,
      actualCostUsd: null,
      billingMode: "subscription_included",
      costStatus: "included",
      costSource: "none",
      pricingVersion: "hermes-2026-07",
    });
    expect(result.modelUsage[0]).toMatchObject({
      model: "model-included",
      actualCostUsd: null,
      billingMode: "subscription_included",
      costStatus: "included",
      costSource: "none",
      pricingVersion: "hermes-2026-07",
    });
  });

  it("fails loudly on incompatible Hermes aggregate schema", async () => {
    const dir = await tempDirectory();
    const statePath = join(dir, "state.db");
    const db = new DatabaseSync(statePath);
    db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY)");
    db.close();

    expect(() => readHermesSessionUsage(statePath)).toThrowError(/Hermes aggregate usage is unavailable/i);
  });

  it("keeps model rows separate when cost source or pricing version differ", async () => {
    const dashboard = aggregateFleetCostDashboard({
      companyId: "company-1",
      range: { from: new Date("2026-07-25T00:00:00.000Z"), to: new Date("2026-07-26T00:00:00.000Z") },
      grain: "day",
      usage: {
        sessions: [{
          sessionId: "session-1",
          startedAt: 1_785_000_000,
          endedAt: 1_785_000_010,
          inputTokens: 20,
          outputTokens: 10,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          apiCallCount: 2,
          estimatedCostUsd: 0.03,
          actualCostUsd: null,
          billingMode: "metered",
          costStatus: "estimated",
          costSource: "mixed",
          pricingVersion: null,
        }],
        modelUsage: [
          {
            sessionId: "session-1",
            model: "same-model",
            provider: "provider-a",
            task: "",
            apiCallCount: 1,
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            reasoningTokens: 0,
            estimatedCostUsd: 0.01,
            actualCostUsd: null,
            billingMode: "metered",
            costStatus: "estimated",
            costSource: "pricing_table",
            pricingVersion: "v1",
            firstSeen: 1_785_000_000,
            lastSeen: 1_785_000_005,
          },
          {
            sessionId: "session-1",
            model: "same-model",
            provider: "provider-a",
            task: "",
            apiCallCount: 1,
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            reasoningTokens: 0,
            estimatedCostUsd: 0.02,
            actualCostUsd: null,
            billingMode: "metered",
            costStatus: "estimated",
            costSource: "provider_estimate",
            pricingVersion: "v2",
            firstSeen: 1_785_000_005,
            lastSeen: 1_785_000_010,
          },
        ],
      },
      apiCalls: [],
      attributions: [],
      freshness: { observedAt: "2026-07-24T01:02:10.000Z", checkpoint: null, errors: [] },
    });

    expect(dashboard.modelRows).toHaveLength(2);
    expect(dashboard.modelRows.map((row) => ({
      costSource: row.costSource,
      pricingVersion: row.pricingVersion,
      estimatedCostUsd: row.estimatedCostUsd,
    }))).toEqual([
      { costSource: "provider_estimate", pricingVersion: "v2", estimatedCostUsd: 0.02 },
      { costSource: "pricing_table", pricingVersion: "v1", estimatedCostUsd: 0.01 },
    ]);
  });

  it("builds versioned generic observations and deduplicates replay by observation id", async () => {
    const dir = await tempDirectory();
    const statePath = join(dir, "state.db");
    createHermesStateFixture(statePath);

    const envelope = buildFleetObservationEnvelope({
      boxId: "mac-local",
      collectorId: "hermes-local",
      profileId: "default",
      observedAt: "2026-07-24T01:02:10.000Z",
      checkpoint: { sequence: 7, cursor: "state.db:7" },
      usage: readHermesSessionUsage(statePath),
      apiCalls: [],
    });
    const store: FleetObservationStore = new Map();

    expect(ingestFleetObservations(store, envelope)).toEqual({ inserted: 3, skipped: 0 });
    expect(ingestFleetObservations(store, envelope)).toEqual({ inserted: 0, skipped: 3 });
    expect([...store.values()].every((observation) => observation.schemaVersion === "fleet-observation/v1")).toBe(true);
  });

  it("rejects incompatible observation schemas instead of returning empty success", () => {
    const envelope = {
      schemaVersion: "fleet-observation/v0",
      source: { boxId: "mac-local", collectorId: "hermes-local" },
      observations: [],
    };
    expect(() => ingestFleetObservations(new Map(), envelope as never)).toThrowError(/unsupported fleet observation schema/i);
  });

  it("attributes only exact full session ids and keeps unattributed sessions visible", async () => {
    const dir = await tempDirectory();
    const statePath = join(dir, "state.db");
    const sidecarPath = join(dir, "telemetry.sqlite3");
    createHermesStateFixture(statePath);
    createSidecarFixture(sidecarPath);

    const attributions: HermesRunAttribution[] = [
      {
        runId: "run-1",
        sessionId: "20260724_010203_aaaaaaaa",
        agentId: "agent-1",
        agentName: "Fleet Agent",
        issueId: "issue-1",
        issueIdentifier: "PAP-1",
        issueTitle: "Ship dashboard",
        projectId: "project-1",
        projectName: "Cost visibility",
        status: "succeeded",
        runStartedAt: new Date("2026-07-24T01:02:03.000Z"),
        runFinishedAt: new Date("2026-07-24T01:02:13.000Z"),
      },
    ];

    const dashboard = aggregateFleetCostDashboard({
      companyId: "company-1",
      range: { from: new Date("2026-07-24T00:00:00.000Z"), to: new Date("2026-07-25T00:00:00.000Z") },
      grain: "day",
      filters: { projectId: "project-1", issueId: "issue-1", agentId: "agent-1", model: "model-included" },
      usage: readHermesSessionUsage(statePath),
      apiCalls: readHermesApiCalls(sidecarPath),
      attributions,
      freshness: {
        observedAt: "2026-07-24T01:02:10.000Z",
        checkpoint: { sequence: 7, cursor: "state.db:7" },
        errors: [],
      },
    });

    expect(extractFullHermesSessionId({ resultJson: { session_id: "20260724_010203_aaaaaaaa" }, sessionIdAfter: "20260724_010203" }))
      .toBe("20260724_010203_aaaaaaaa");
    expect(extractFullHermesSessionId({ resultJson: {}, sessionIdAfter: "20260724_010203" })).toBeNull();
    expect(dashboard.taskRows).toEqual([
      expect.objectContaining({
        issueId: "issue-1",
        projectId: "project-1",
        agentId: "agent-1",
        completionState: "succeeded",
        costPerCompletedTaskUsd: 0,
        wallClockMs: 10_000,
        turns: 1,
        avgLatencyMs: 2000,
        avgTtftMs: 420,
        models: expect.arrayContaining([
          expect.objectContaining({
            model: "model-included",
            billingMode: "subscription_included",
            costStatus: "included",
            actualCostUsd: null,
          }),
        ]),
      }),
    ]);
    expect(dashboard.unattributedSessions).toEqual([
      expect.objectContaining({ sessionId: "20260724_010203_bbbbbbbb" }),
    ]);
  });
});
