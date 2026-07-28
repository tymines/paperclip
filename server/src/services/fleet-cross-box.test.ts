import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  aggregateFleetCostDashboard,
  buildFleetCostDashboard,
  collectWindowsEnvelopeBox,
  FleetObservationEnvelopeError,
  normalizeFleetEnvelopeToUsage,
  parseFleetObservationEnvelope,
  type FleetObservationStore,
  type HermesRunAttribution,
  type HermesUsageSnapshot,
} from "./fleet-cost-dashboard.js";

const WINDOWS_FIXTURE_PATH = fileURLToPath(
  new URL("./__fixtures__/fleet-observation-windows-box.json", import.meta.url),
);

const tempPaths: string[] = [];

async function tempDirectory() {
  const path = await mkdtemp(join(tmpdir(), "paperclip-fleet-cross-box-"));
  tempPaths.push(path);
  return path;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function windowsEnvelope() {
  return parseFleetObservationEnvelope(JSON.parse(readFileSync(WINDOWS_FIXTURE_PATH, "utf8")));
}

function createMacStateDb(path: string) {
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
  db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "shared-session-id", 1785025800, 1785025920, 100, 50, 0, 0, 0, 1,
    0.1, 0.1, "metered_api", "actual", "provider", "hermes-2026-07",
  );
  db.prepare("INSERT INTO session_model_usage VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "shared-session-id", "kimi-k3", "kimi-coding", "", 1, 100, 50, 0, 0, 0,
    0.1, 0.1, "metered_api", "actual", "provider", "hermes-2026-07", 1785025800, 1785025920,
  );
  db.close();
}

function macUsage(): HermesUsageSnapshot {
  return {
    sessions: [{
      sessionId: "shared-session-id",
      boxId: "mac-local",
      startedAt: 1785025800,
      endedAt: 1785025920,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      apiCallCount: 1,
      estimatedCostUsd: 0.1,
      actualCostUsd: 0.1,
      billingMode: "metered_api",
      costStatus: "actual",
      costSource: "provider",
      pricingVersion: "hermes-2026-07",
    }],
    modelUsage: [{
      sessionId: "shared-session-id",
      boxId: "mac-local",
      model: "kimi-k3",
      provider: "kimi-coding",
      task: "",
      apiCallCount: 1,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      estimatedCostUsd: 0.1,
      actualCostUsd: 0.1,
      billingMode: "metered_api",
      costStatus: "actual",
      costSource: "provider",
      pricingVersion: "hermes-2026-07",
      firstSeen: 1785025800,
      lastSeen: 1785025920,
    }],
  };
}

function crossBoxAttributions(): HermesRunAttribution[] {
  return [
    {
      runId: "run-mac",
      sessionId: "shared-session-id",
      agentId: "agent-1",
      agentName: "Achlys",
      issueId: "issue-1",
      issueIdentifier: "PAP-1",
      issueTitle: "Cross-box dashboard",
      projectId: "project-1",
      projectName: "Cost visibility",
      status: "succeeded",
      runStartedAt: new Date("2026-07-26T00:30:00.000Z"),
      runFinishedAt: new Date("2026-07-26T00:32:00.000Z"),
    },
    {
      runId: "run-win",
      sessionId: "20260726_010000_win0001",
      agentId: "agent-2",
      agentName: "Ares",
      issueId: "issue-1",
      issueIdentifier: "PAP-1",
      issueTitle: "Cross-box dashboard",
      projectId: "project-1",
      projectName: "Cost visibility",
      status: "succeeded",
      runStartedAt: new Date("2026-07-26T01:00:00.000Z"),
      runFinishedAt: new Date("2026-07-26T01:10:00.000Z"),
    },
  ];
}

function mockAttributionDb(rows: unknown[] = []): Db {
  const chain = Promise.resolve(rows) as Promise<unknown[]> & Record<string, unknown>;
  chain.from = () => chain;
  chain.leftJoin = () => chain;
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.as = () => ({ runId: sql`null`, entityId: sql`null` });
  return { select: () => chain, selectDistinctOn: () => chain } as unknown as Db;
}

describe("windows envelope adapter (zero-footprint contract)", () => {
  it("normalizes the staged Windows envelope and preserves billing semantics", () => {
    const envelope = windowsEnvelope();
    const { usage, apiCalls, inserted, skipped } = normalizeFleetEnvelopeToUsage(envelope);

    expect(inserted).toBe(8);
    expect(skipped).toBe(0);
    expect(usage.sessions).toHaveLength(2);
    expect(usage.modelUsage).toHaveLength(3);
    expect(apiCalls).toHaveLength(3);
    expect([...usage.sessions, ...usage.modelUsage, ...apiCalls].every((row) => row.boxId === "box-2-windows")).toBe(true);

    const included = usage.modelUsage.find((row) => row.model === "glm-5");
    expect(included).toMatchObject({
      billingMode: "subscription_included",
      costStatus: "included",
      costSource: "none",
      estimatedCostUsd: 0,
      actualCostUsd: null,
      pricingVersion: "hermes-2026-07",
    });
    const metered = usage.modelUsage.find((row) => row.model === "kimi-k3" && row.task === "");
    expect(metered).toMatchObject({ costStatus: "actual", actualCostUsd: 0.36 });
    expect(apiCalls.map((row) => row.ttft)).toEqual([0.35, 0.41, 0.25]);
  });

  it("fails loudly on incompatible envelopes instead of returning empty success", () => {
    const valid = windowsEnvelope();
    expect(() => parseFleetObservationEnvelope({ ...valid, schemaVersion: "fleet-observation/v0" }))
      .toThrowError(FleetObservationEnvelopeError);
    expect(() => parseFleetObservationEnvelope({ ...valid, schemaVersion: "fleet-observation/v0" }))
      .toThrowError(/unsupported fleet observation schema/i);
    expect(() => parseFleetObservationEnvelope({ ...valid, source: { collectorId: "x" } }))
      .toThrowError(/source identity/i);
    expect(() => parseFleetObservationEnvelope({ ...valid, observations: [{ schemaVersion: "fleet-observation/v1", observationId: "o1", payloadKind: "cost.unknown", payload: {} }] }))
      .toThrowError(/payloadKind/i);
    expect(() => parseFleetObservationEnvelope("not-an-envelope"))
      .toThrowError(FleetObservationEnvelopeError);
  });

  it("deduplicates envelope replay so cross-box usage cannot double count", () => {
    const store: FleetObservationStore = new Map();
    const first = normalizeFleetEnvelopeToUsage(windowsEnvelope(), store);
    const second = normalizeFleetEnvelopeToUsage(windowsEnvelope(), store);

    expect(first.inserted).toBe(8);
    expect(second).toMatchObject({ inserted: 0, skipped: 8 });
    expect(second.usage.sessions).toHaveLength(0);
    expect(second.usage.modelUsage).toHaveLength(0);
    expect(second.apiCalls).toHaveLength(0);
    expect(store.size).toBe(8);
  });

  it("reports not-configured, unavailable, and ok source states explicitly", async () => {
    const unconfigured = collectWindowsEnvelopeBox(null);
    expect(unconfigured.report).toMatchObject({
      boxId: "windows-box",
      kind: "envelope-file",
      status: "not-configured",
      errors: [],
    });
    expect(unconfigured.report.detail).toMatch(/HERMES_COST_WINDOWS_ENVELOPE_PATH/);

    const missing = collectWindowsEnvelopeBox(join(await tempDirectory(), "absent.json"));
    expect(missing.report.status).toBe("unavailable");
    expect(missing.report.errors[0]).toMatch(/Windows envelope collector failed/i);

    const dir = await tempDirectory();
    const badSchemaPath = join(dir, "bad-schema.json");
    await writeFile(badSchemaPath, JSON.stringify({ schemaVersion: "fleet-observation/v0", observations: [] }));
    expect(collectWindowsEnvelopeBox(badSchemaPath).report.errors[0]).toMatch(/unsupported fleet observation schema/i);
    const malformedPath = join(dir, "malformed.json");
    await writeFile(malformedPath, "{ not json");
    expect(collectWindowsEnvelopeBox(malformedPath).report.status).toBe("unavailable");

    const ok = collectWindowsEnvelopeBox(WINDOWS_FIXTURE_PATH);
    expect(ok.report).toMatchObject({
      boxId: "box-2-windows",
      collectorId: "hermes-windows-envelope",
      profileId: "ares",
      status: "ok",
      observedAt: "2026-07-26T03:00:00.000Z",
      checkpoint: { sequence: 42, cursor: "C:\\Users\\fleet\\.hermes\\state.db" },
      errors: [],
      detail: null,
    });
    expect(ok.usage.sessions).toHaveLength(2);
  });
});

describe("envelope payload validation (fail-loud contract)", () => {
  function validEnvelope() {
    return JSON.parse(readFileSync(WINDOWS_FIXTURE_PATH, "utf8"));
  }

  function observationOfKind(envelope: any, kind: string) {
    return envelope.observations.find((observation: any) => observation.payloadKind === kind);
  }

  function expectPayloadRejection(envelope: any, fieldPattern: RegExp) {
    expect(() => parseFleetObservationEnvelope(envelope)).toThrowError(FleetObservationEnvelopeError);
    expect(() => parseFleetObservationEnvelope(envelope)).toThrowError(fieldPattern);
    // Invalid observations must never enter the dedupe store, and
    // normalization must not partially succeed.
    const store: FleetObservationStore = new Map();
    expect(() => normalizeFleetEnvelopeToUsage(envelope, store)).toThrowError(FleetObservationEnvelopeError);
    expect(store.size).toBe(0);
  }

  it("accepts the full valid fixture for all three payload kinds", () => {
    const envelope = validEnvelope();
    expect(() => parseFleetObservationEnvelope(envelope)).not.toThrow();
    const store: FleetObservationStore = new Map();
    const { inserted } = normalizeFleetEnvelopeToUsage(parseFleetObservationEnvelope(envelope), store);
    expect(inserted).toBe(8);
    // nullable fields stay nullable and valid: ttft/actualCostUsd nulls are
    // part of the contract, not malformed data.
    const apiCall = observationOfKind(envelope, "cost.speed.api_call");
    apiCall.payload.ttft = null;
    const session = observationOfKind(envelope, "cost.usage.session");
    session.payload.endedAt = null;
    session.payload.actualCostUsd = null;
    const model = observationOfKind(envelope, "cost.usage.model");
    model.payload.pricingVersion = null;
    model.payload.firstSeen = null;
    model.payload.lastSeen = null;
    expect(() => parseFleetObservationEnvelope(envelope)).not.toThrow();
  });

  it("rejects missing, string, NaN/infinite, and negative numeric fields per payload kind", () => {
    const session = validEnvelope();
    delete observationOfKind(session, "cost.usage.session").payload.inputTokens;
    expectPayloadRejection(session, /cost\.usage\.session.*inputTokens/s);

    const stringTokens = validEnvelope();
    observationOfKind(stringTokens, "cost.usage.model").payload.outputTokens = "1200";
    expectPayloadRejection(stringTokens, /cost\.usage\.model.*outputTokens/s);

    const infinite = validEnvelope();
    observationOfKind(infinite, "cost.speed.api_call").payload.apiDuration = Number.POSITIVE_INFINITY;
    expectPayloadRejection(infinite, /cost\.speed\.api_call.*apiDuration/s);

    const nan = validEnvelope();
    observationOfKind(nan, "cost.speed.api_call").payload.startedAt = Number.NaN;
    expectPayloadRejection(nan, /cost\.speed\.api_call.*startedAt/s);

    const negative = validEnvelope();
    observationOfKind(negative, "cost.usage.session").payload.apiCallCount = -1;
    expectPayloadRejection(negative, /cost\.usage\.session.*apiCallCount/s);

    const nullRequired = validEnvelope();
    observationOfKind(nullRequired, "cost.speed.api_call").payload.apiDuration = null;
    expectPayloadRejection(nullRequired, /cost\.speed\.api_call.*apiDuration/s);
  });

  it("rejects missing or malformed identity fields per payload kind", () => {
    const missingTurn = validEnvelope();
    delete observationOfKind(missingTurn, "cost.speed.api_call").payload.turnId;
    expectPayloadRejection(missingTurn, /cost\.speed\.api_call.*turnId/s);

    const missingModel = validEnvelope();
    delete observationOfKind(missingModel, "cost.usage.model").payload.model;
    expectPayloadRejection(missingModel, /cost\.usage\.model.*model/s);

    const emptySession = validEnvelope();
    observationOfKind(emptySession, "cost.usage.session").payload.sessionId = "";
    expectPayloadRejection(emptySession, /cost\.usage\.session.*sessionId/s);

    const nullRunIdOk = validEnvelope();
    observationOfKind(nullRunIdOk, "cost.speed.api_call").payload.paperclipRunId = null;
    expect(() => parseFleetObservationEnvelope(nullRunIdOk)).not.toThrow();
    const badRunId = validEnvelope();
    observationOfKind(badRunId, "cost.speed.api_call").payload.paperclipRunId = 42;
    expectPayloadRejection(badRunId, /cost\.speed\.api_call.*paperclipRunId/s);
  });

  it("rejects malformed observation envelopes, checkpoints, freshness, and source invariants", () => {
    const missingObservedAt = validEnvelope();
    delete missingObservedAt.observations[0].observedAt;
    expectPayloadRejection(missingObservedAt, /observedAt/s);

    const badCheckpoint = validEnvelope();
    badCheckpoint.observations[0].checkpoint = { sequence: "42", cursor: null };
    expectPayloadRejection(badCheckpoint, /checkpoint.*sequence/s);

    const badFreshness = validEnvelope();
    badFreshness.observations[0].freshness = { errors: ["ok", 7] };
    expectPayloadRejection(badFreshness, /freshness.*errors/s);

    // an observation stamped with a different box than the envelope source
    // violates the box/source invariant and must fail loudly
    const wrongBox = validEnvelope();
    wrongBox.observations[0].source = { ...wrongBox.observations[0].source, boxId: "box-3-stranger" };
    expectPayloadRejection(wrongBox, /source|boxId/s);
  });
});

describe("cross-box fleet aggregation", () => {
  it("merges Mac and Windows boxes without collisions or double counting", () => {
    const windows = normalizeFleetEnvelopeToUsage(windowsEnvelope());
    const dashboard = aggregateFleetCostDashboard({
      companyId: "company-1",
      range: { from: new Date("2026-07-26T00:00:00.000Z"), to: new Date("2026-07-27T00:00:00.000Z") },
      grain: "day",
      usage: {
        sessions: [...macUsage().sessions, ...windows.usage.sessions],
        modelUsage: [...macUsage().modelUsage, ...windows.usage.modelUsage],
      },
      apiCalls: windows.apiCalls,
      attributions: crossBoxAttributions(),
      freshness: { observedAt: "2026-07-26T03:05:00.000Z", checkpoint: null, errors: [] },
    });

    // same model on both boxes merges into one decision row tagged with both boxes
    const kimi = dashboard.modelRows.find((row) => row.model === "kimi-k3");
    expect(kimi).toMatchObject({
      provider: "kimi-coding",
      inputTokens: 2100,
      outputTokens: 1250,
      actualCostUsd: 0.52,
      usageApiCalls: 6,
      speedSampleApiCalls: 2,
      speedAvailability: "available",
      compactions: 1,
      turns: 2,
      completedTasks: 1,
      costPerCompletedTaskUsd: 0.52,
      avgLatencyMs: 2250,
      avgTtftMs: 380,
      boxes: ["box-2-windows", "mac-local"],
    });
    expect(kimi).not.toHaveProperty("apiCalls");
    expect(kimi?.throughputOutputTokensPerSecond).toBeCloseTo(277.777778, 4);

    // the second model identity in the same task reports only its own
    // attributed turns/compactions, never the whole-task totals
    const glm = dashboard.modelRows.find((row) => row.model === "glm-5");
    expect(glm).toMatchObject({
      provider: "z-ai",
      usageApiCalls: 2,
      speedSampleApiCalls: 1,
      speedAvailability: "available",
      turns: 1,
      compactions: 0,
      avgLatencyMs: 1500,
      avgTtftMs: 250,
      boxes: ["box-2-windows"],
    });
    expect(glm?.throughputOutputTokensPerSecond).toBeCloseTo(200, 4);

    expect(dashboard.availability).toEqual({
      modelSpeed: {
        avgLatencyMs: "available",
        avgTtftMs: "available",
        throughputOutputTokensPerSecond: "available",
      },
      taskSpeed: {
        avgLatencyMs: "available",
        avgTtftMs: "available",
        throughputOutputTokensPerSecond: "available",
      },
      stalls: "unavailable",
    });

    // one task row spans both boxes; identical session ids on different boxes stay distinct
    expect(dashboard.taskRows).toHaveLength(1);
    expect(dashboard.taskRows[0]).toMatchObject({
      issueId: "issue-1",
      costUsd: 0.52,
      inputTokens: 2600,
      outputTokens: 1550,
      wallClockMs: 2_400_000,
      turns: 2,
      compactions: 1,
      boxes: ["box-2-windows", "mac-local"],
    });
    expect(dashboard.taskRows[0].sessionIds).toEqual([
      "20260726_010000_win0001",
      "box-2-windows:shared-session-id",
      "mac-local:shared-session-id",
    ]);

    expect(dashboard.trends).toEqual([
      { bucket: "2026-07-26", costUsd: 0.52, inputTokens: 2600, outputTokens: 1550, completedTasks: 1 },
    ]);
    expect(dashboard.unattributedSessions).toEqual([]);
  });
});

describe("cross-box fleet dashboard orchestration", () => {
  async function stubLocalCollector() {
    const dir = await tempDirectory();
    const statePath = join(dir, "state.db");
    createMacStateDb(statePath);
    vi.stubEnv("HERMES_STATE_DB_PATH", statePath);
    vi.stubEnv("HERMES_COST_TELEMETRY_DB_PATH", join(dir, "telemetry.sqlite3"));
    vi.stubEnv("HERMES_COST_COMPANY_ID", "company-1");
    return { statePath, dir };
  }

  it("aggregates Mac and Windows sources with per-source reports", async () => {
    await stubLocalCollector();
    vi.stubEnv("HERMES_COST_WINDOWS_ENVELOPE_PATH", WINDOWS_FIXTURE_PATH);

    const dashboard = await buildFleetCostDashboard(mockAttributionDb(), "company-1", { grain: "day" });

    expect(dashboard.sources).toEqual([
      expect.objectContaining({ boxId: "mac-local", kind: "hermes-local", status: "ok", errors: [] }),
      expect.objectContaining({ boxId: "box-2-windows", kind: "envelope-file", status: "ok", errors: [] }),
    ]);
    expect(dashboard.freshness.errors).toEqual([]);
    expect(dashboard.freshness.checkpoint).toBeNull();
    const kimi = dashboard.modelRows.find((row) => row.model === "kimi-k3");
    expect(kimi?.boxes).toEqual(["box-2-windows", "mac-local"]);
    expect(kimi?.actualCostUsd).toBe(0.52);
  });

  it("returns Mac data with explicit errors when the Windows envelope is unavailable", async () => {
    await stubLocalCollector();
    vi.stubEnv("HERMES_COST_WINDOWS_ENVELOPE_PATH", join(await tempDirectory(), "absent.json"));

    const dashboard = await buildFleetCostDashboard(mockAttributionDb(), "company-1", { grain: "day" });

    expect(dashboard.sources).toEqual([
      expect.objectContaining({ boxId: "mac-local", status: "ok" }),
      expect.objectContaining({ boxId: "windows-box", status: "unavailable" }),
    ]);
    expect(dashboard.freshness.errors).toHaveLength(1);
    expect(dashboard.freshness.errors[0]).toMatch(/\[windows-box\] Windows envelope collector failed/i);
    expect(dashboard.modelRows.find((row) => row.model === "kimi-k3")).toMatchObject({
      boxes: ["mac-local"],
      actualCostUsd: 0.1,
    });
  });

  it("lists the Windows source as not-configured without fabricating errors", async () => {
    await stubLocalCollector();
    vi.stubEnv("HERMES_COST_WINDOWS_ENVELOPE_PATH", undefined);

    const dashboard = await buildFleetCostDashboard(mockAttributionDb(), "company-1", { grain: "day" });

    expect(dashboard.sources[1]).toMatchObject({ status: "not-configured", errors: [] });
    expect(dashboard.freshness.errors).toEqual([]);
    expect(dashboard.modelRows).toHaveLength(1);
  });

  it("fails closed when every source is unavailable", async () => {
    const dir = await tempDirectory();
    vi.stubEnv("HERMES_STATE_DB_PATH", join(dir, "missing-state.db"));
    vi.stubEnv("HERMES_COST_COMPANY_ID", "company-1");
    vi.stubEnv("HERMES_COST_WINDOWS_ENVELOPE_PATH", join(dir, "absent.json"));

    await expect(buildFleetCostDashboard(mockAttributionDb(), "company-1", { grain: "day" }))
      .rejects.toThrow(/Hermes state database not configured or missing/i);
    await expect(buildFleetCostDashboard(mockAttributionDb(), "company-1", { grain: "day" }))
      .rejects.toThrow(/Windows envelope collector failed/i);
  });
});
