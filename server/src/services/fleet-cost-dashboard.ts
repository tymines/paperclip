import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { homedir } from "node:os";
import type { DatabaseSync } from "node:sqlite";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { activityLog, agents, heartbeatRuns, issues, projects } from "@paperclipai/db";
import { serviceUnavailable } from "../errors.js";

export type FleetDashboardGrain = "day" | "week" | "month";

export interface HermesSessionUsage {
  sessionId: string;
  startedAt: number;
  endedAt: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  apiCallCount: number;
  estimatedCostUsd: number | null;
  actualCostUsd: number | null;
  billingMode: string;
  costStatus: string;
  costSource: string;
  pricingVersion: string | null;
}

export interface HermesModelUsage extends Omit<HermesSessionUsage, "startedAt" | "endedAt"> {
  model: string;
  provider: string;
  task: string;
  firstSeen: number | null;
  lastSeen: number | null;
}

export interface HermesUsageSnapshot {
  sessions: HermesSessionUsage[];
  modelUsage: HermesModelUsage[];
}

export interface HermesApiCall {
  sessionId: string;
  turnId: string;
  apiRequestId: string;
  paperclipRunId: string | null;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  startedAt: number;
  endedAt: number;
  apiDuration: number;
  ttft: number | null;
}

export interface HermesRunAttribution {
  runId: string;
  sessionId: string;
  agentId: string;
  agentName: string | null;
  issueId: string | null;
  issueIdentifier: string | null;
  issueTitle: string | null;
  projectId: string | null;
  projectName: string | null;
  status: string;
  runStartedAt: Date | null;
  runFinishedAt: Date | null;
}

export interface FleetObservation {
  schemaVersion: "fleet-observation/v1";
  observationId: string;
  payloadKind: "cost.usage.session" | "cost.usage.model" | "cost.speed.api_call";
  observedAt: string;
  source: {
    boxId: string;
    collectorId: string;
    profileId: string | null;
  };
  checkpoint: {
    sequence: number;
    cursor: string | null;
  };
  freshness: {
    errors: string[];
  };
  payload: HermesSessionUsage | HermesModelUsage | HermesApiCall;
}

export interface FleetObservationEnvelope {
  schemaVersion: "fleet-observation/v1";
  source: FleetObservation["source"];
  observedAt: string;
  checkpoint: FleetObservation["checkpoint"];
  freshness: FleetObservation["freshness"];
  observations: FleetObservation[];
}

export type FleetObservationStore = Map<string, FleetObservation>;

export interface FleetDashboardQuery {
  range?: { from?: Date; to?: Date };
  filters?: {
    projectId?: string;
    issueId?: string;
    agentId?: string;
    model?: string;
  };
  grain?: FleetDashboardGrain;
}

export class HermesUsageReadError extends Error {
  override name = "HermesUsageReadError";
}

const require = createRequire(import.meta.url);
type SqliteRecord = Record<string, string | number | null>;

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function openReadOnly(path: string): DatabaseSync {
  const sqlite = require("node:sqlite") as typeof import("node:sqlite");
  return new sqlite.DatabaseSync(path, { readOnly: true });
}

export function readHermesSessionUsage(stateDbPath: string): HermesUsageSnapshot {
  let db: DatabaseSync | null = null;
  try {
    db = openReadOnly(stateDbPath);
    const sessions = db.prepare(`
      SELECT
        id AS session_id,
        started_at,
        ended_at,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_write_tokens,
        reasoning_tokens,
        api_call_count,
        estimated_cost_usd,
        actual_cost_usd,
        billing_mode,
        cost_status,
        cost_source,
        pricing_version
      FROM sessions
    `).all() as SqliteRecord[];
    const modelUsage = db.prepare(`
      SELECT
        session_id,
        model,
        billing_provider,
        task,
        api_call_count,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_write_tokens,
        reasoning_tokens,
        estimated_cost_usd,
        actual_cost_usd,
        billing_mode,
        cost_status,
        cost_source,
        pricing_version,
        first_seen,
        last_seen
      FROM session_model_usage
    `).all() as SqliteRecord[];

    return {
      sessions: sessions.map((row) => ({
        sessionId: String(row.session_id),
        startedAt: numberValue(row.started_at),
        endedAt: nullableNumber(row.ended_at),
        inputTokens: numberValue(row.input_tokens),
        outputTokens: numberValue(row.output_tokens),
        cacheReadTokens: numberValue(row.cache_read_tokens),
        cacheWriteTokens: numberValue(row.cache_write_tokens),
        reasoningTokens: numberValue(row.reasoning_tokens),
        apiCallCount: numberValue(row.api_call_count),
        estimatedCostUsd: nullableNumber(row.estimated_cost_usd),
        actualCostUsd: nullableNumber(row.actual_cost_usd),
        billingMode: String(row.billing_mode),
        costStatus: String(row.cost_status),
        costSource: String(row.cost_source),
        pricingVersion: nullableString(row.pricing_version),
      })),
      modelUsage: modelUsage.map((row) => ({
        sessionId: String(row.session_id),
        model: String(row.model),
        provider: String(row.billing_provider),
        task: String(row.task ?? ""),
        apiCallCount: numberValue(row.api_call_count),
        inputTokens: numberValue(row.input_tokens),
        outputTokens: numberValue(row.output_tokens),
        cacheReadTokens: numberValue(row.cache_read_tokens),
        cacheWriteTokens: numberValue(row.cache_write_tokens),
        reasoningTokens: numberValue(row.reasoning_tokens),
        estimatedCostUsd: nullableNumber(row.estimated_cost_usd),
        actualCostUsd: nullableNumber(row.actual_cost_usd),
        billingMode: String(row.billing_mode),
        costStatus: String(row.cost_status),
        costSource: String(row.cost_source),
        pricingVersion: nullableString(row.pricing_version),
        firstSeen: nullableNumber(row.first_seen),
        lastSeen: nullableNumber(row.last_seen),
      })),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new HermesUsageReadError(`Hermes aggregate usage is unavailable: ${detail}`);
  } finally {
    db?.close();
  }
}

export function readHermesApiCalls(sidecarDbPath: string): HermesApiCall[] {
  if (!existsSync(sidecarDbPath)) return [];
  let db: DatabaseSync | null = null;
  try {
    db = openReadOnly(sidecarDbPath);
    const columns = db.prepare("PRAGMA table_info(api_calls)").all() as Array<{ name: string }>;
    const hasTtft = columns.some((column) => column.name === "ttft");
    const rows = db.prepare(`
      SELECT
        session_id,
        turn_id,
        api_request_id,
        paperclip_run_id,
        model,
        provider,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_write_tokens,
        reasoning_tokens,
        started_at,
        ended_at,
        api_duration
        ${hasTtft ? ", ttft" : ""}
      FROM api_calls
    `).all() as SqliteRecord[];

    return rows.map((row) => ({
      sessionId: String(row.session_id),
      turnId: String(row.turn_id),
      apiRequestId: String(row.api_request_id),
      paperclipRunId: nullableString(row.paperclip_run_id),
      model: String(row.model),
      provider: String(row.provider),
      inputTokens: numberValue(row.input_tokens),
      outputTokens: numberValue(row.output_tokens),
      cacheReadTokens: numberValue(row.cache_read_tokens),
      cacheWriteTokens: numberValue(row.cache_write_tokens),
      reasoningTokens: numberValue(row.reasoning_tokens),
      startedAt: numberValue(row.started_at),
      endedAt: numberValue(row.ended_at),
      apiDuration: numberValue(row.api_duration),
      ttft: nullableNumber(row.ttft),
    }));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new HermesUsageReadError(`Hermes API-call telemetry is unavailable: ${detail}`);
  } finally {
    db?.close();
  }
}

export function buildFleetObservationEnvelope(input: {
  boxId: string;
  collectorId: string;
  profileId?: string | null;
  observedAt: string;
  checkpoint: FleetObservation["checkpoint"];
  usage: HermesUsageSnapshot;
  apiCalls: HermesApiCall[];
  errors?: string[];
}): FleetObservationEnvelope {
  const source = {
    boxId: input.boxId,
    collectorId: input.collectorId,
    profileId: input.profileId ?? null,
  };
  const base = {
    schemaVersion: "fleet-observation/v1" as const,
    observedAt: input.observedAt,
    source,
    checkpoint: input.checkpoint,
    freshness: { errors: input.errors ?? [] },
  };
  const sessionIds = new Set(input.usage.sessions.map((session) => session.sessionId));
  return {
    ...base,
    observations: [
      ...input.usage.sessions.map((payload): FleetObservation => ({
        ...base,
        observationId: `${source.boxId}:${source.collectorId}:session:${payload.sessionId}`,
        payloadKind: "cost.usage.session",
        payload,
      })),
      ...input.usage.modelUsage
        .filter((payload) => sessionIds.has(payload.sessionId))
        .map((payload): FleetObservation => ({
          ...base,
          observationId: `${source.boxId}:${source.collectorId}:model:${payload.sessionId}:${payload.provider}:${payload.model}:${payload.task}`,
          payloadKind: "cost.usage.model",
          payload,
        })),
      ...input.apiCalls.map((payload): FleetObservation => ({
        ...base,
        observationId: `${source.boxId}:${source.collectorId}:api:${payload.sessionId}:${payload.apiRequestId}`,
        payloadKind: "cost.speed.api_call",
        payload,
      })),
    ],
  };
}

export function ingestFleetObservations(store: FleetObservationStore, envelope: FleetObservationEnvelope) {
  if (envelope.schemaVersion !== "fleet-observation/v1") {
    throw new Error(`Unsupported fleet observation schema: ${(envelope as { schemaVersion?: string }).schemaVersion ?? "missing"}`);
  }
  let inserted = 0;
  let skipped = 0;
  for (const observation of envelope.observations) {
    if (observation.schemaVersion !== "fleet-observation/v1") {
      throw new Error(`Unsupported fleet observation schema: ${observation.schemaVersion}`);
    }
    if (store.has(observation.observationId)) {
      skipped += 1;
      continue;
    }
    store.set(observation.observationId, observation);
    inserted += 1;
  }
  return { inserted, skipped };
}

export function extractFullHermesSessionId(run: {
  resultJson: Record<string, unknown> | null;
  sessionIdAfter?: string | null;
}): string | null {
  const value = run.resultJson?.session_id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function bucketDate(date: Date, grain: FleetDashboardGrain): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (grain === "month") return utc.toISOString().slice(0, 7);
  if (grain === "week") {
    const day = utc.getUTCDay() || 7;
    utc.setUTCDate(utc.getUTCDate() - day + 1);
  }
  return utc.toISOString().slice(0, 10);
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function usdToDashboardCost(usage: HermesModelUsage): number | null {
  if (usage.actualCostUsd !== null) return usage.actualCostUsd;
  if (usage.costStatus === "included" || usage.billingMode === "subscription_included") return usage.estimatedCostUsd ?? 0;
  return usage.estimatedCostUsd;
}

function modelAggregationKey(usage: {
  provider: string;
  model: string;
  billingMode: string;
  costStatus: string;
  costSource: string;
  pricingVersion: string | null;
}): string {
  return [
    usage.provider,
    usage.model,
    usage.billingMode,
    usage.costStatus,
    usage.costSource,
    usage.pricingVersion ?? "",
  ].join("\0");
}

function matchesRange(session: HermesSessionUsage, range?: FleetDashboardQuery["range"]): boolean {
  if (session.startedAt < 1_000_000_000) return true;
  const started = new Date(session.startedAt * 1000);
  if (range?.from && started < range.from) return false;
  if (range?.to && started > range.to) return false;
  return true;
}

export function aggregateFleetCostDashboard(input: {
  companyId: string;
  range?: FleetDashboardQuery["range"];
  filters?: FleetDashboardQuery["filters"];
  grain: FleetDashboardGrain;
  usage: HermesUsageSnapshot;
  apiCalls: HermesApiCall[];
  attributions: HermesRunAttribution[];
  freshness: {
    observedAt: string | null;
    checkpoint: FleetObservation["checkpoint"] | null;
    errors: string[];
  };
}) {
  const attributionBySession = new Map(input.attributions.map((row) => [row.sessionId, row]));
  const sessionById = new Map(input.usage.sessions.map((session) => [session.sessionId, session]));
  const sessionIds = new Set(
    input.usage.sessions
      .filter((session) => matchesRange(session, input.range))
      .filter((session) => {
        const attr = attributionBySession.get(session.sessionId);
        if (input.filters?.agentId && attr?.agentId !== input.filters.agentId) return false;
        if (input.filters?.issueId && attr?.issueId !== input.filters.issueId) return false;
        if (input.filters?.projectId && attr?.projectId !== input.filters.projectId) return false;
        if (input.filters?.model) {
          return input.usage.modelUsage.some((usage) => usage.sessionId === session.sessionId && usage.model === input.filters?.model);
        }
        return true;
      })
      .map((session) => session.sessionId),
  );
  const modelUsage = input.usage.modelUsage.filter((usage) =>
    sessionIds.has(usage.sessionId) && (!input.filters?.model || usage.model === input.filters.model)
  );
  const apiCalls = input.apiCalls.filter((call) =>
    sessionIds.has(call.sessionId) && (!input.filters?.model || call.model === input.filters.model)
  );

  const taskMap = new Map<string, {
    issueId: string | null;
    issueIdentifier: string | null;
    issueTitle: string | null;
    projectId: string | null;
    projectName: string | null;
    agentId: string | null;
    agentName: string | null;
    completionState: string | null;
    sessionIds: Set<string>;
    runIds: Set<string>;
  }>();
  for (const sessionId of sessionIds) {
    const attr = attributionBySession.get(sessionId);
    const key = attr?.issueId ?? `unattributed:${sessionId}`;
    const row = taskMap.get(key) ?? {
      issueId: attr?.issueId ?? null,
      issueIdentifier: attr?.issueIdentifier ?? null,
      issueTitle: attr?.issueTitle ?? null,
      projectId: attr?.projectId ?? null,
      projectName: attr?.projectName ?? null,
      agentId: attr?.agentId ?? null,
      agentName: attr?.agentName ?? null,
      completionState: attr?.status ?? null,
      sessionIds: new Set<string>(),
      runIds: new Set<string>(),
    };
    row.sessionIds.add(sessionId);
    if (attr) row.runIds.add(attr.runId);
    taskMap.set(key, row);
  }

  const modelRowsByKey = new Map<string, any>();
  const taskRows = [...taskMap.values()].map((task) => {
    const taskSessionIds = task.sessionIds;
    const taskUsage = modelUsage.filter((usage) => taskSessionIds.has(usage.sessionId));
    const taskCalls = apiCalls.filter((call) => taskSessionIds.has(call.sessionId));
    const attrTimes = [...taskSessionIds]
      .map((sessionId) => attributionBySession.get(sessionId))
      .filter((attr): attr is HermesRunAttribution => Boolean(attr));
    const starts = attrTimes.map((attr) => attr.runStartedAt?.getTime()).filter((value): value is number => value !== undefined);
    const finishes = attrTimes.map((attr) => attr.runFinishedAt?.getTime()).filter((value): value is number => value !== undefined);
    const wallClockMs = starts.length > 0 && finishes.length > 0 ? Math.max(0, Math.max(...finishes) - Math.min(...starts)) : null;
    const costUsd = taskUsage.reduce((sum, row) => sum + (usdToDashboardCost(row) ?? 0), 0);
    const outputTokens = taskUsage.reduce((sum, row) => sum + row.outputTokens, 0);
    const apiDurationMs = taskCalls.reduce((sum, row) => sum + row.apiDuration * 1000, 0);
    const ttftSamples = taskCalls.map((row) => row.ttft).filter((value): value is number => value !== null);
    const models = taskUsage.map((usage) => {
      const cost = usdToDashboardCost(usage);
      const modelKey = modelAggregationKey(usage);
      const modelRow = modelRowsByKey.get(modelKey) ?? {
        provider: usage.provider,
        model: usage.model,
        billingMode: usage.billingMode,
        costStatus: usage.costStatus,
        costSource: usage.costSource,
        pricingVersion: usage.pricingVersion,
        estimatedCostUsd: 0,
        actualCostUsd: null,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        apiCalls: 0,
        avgLatencyMs: null,
        avgTtftMs: null,
        throughputOutputTokensPerSecond: null,
        completedTasks: 0,
        costPerCompletedTaskUsd: null,
        avgTaskWallClockMs: null,
        turns: 0,
        compactions: 0,
        stalls: null,
        stallsAvailability: "unavailable",
      };
      modelRow.estimatedCostUsd += usage.estimatedCostUsd ?? 0;
      modelRow.actualCostUsd = usage.actualCostUsd === null ? modelRow.actualCostUsd : (modelRow.actualCostUsd ?? 0) + usage.actualCostUsd;
      modelRow.inputTokens += usage.inputTokens;
      modelRow.outputTokens += usage.outputTokens;
      modelRow.cacheReadTokens += usage.cacheReadTokens;
      modelRow.cacheWriteTokens += usage.cacheWriteTokens;
      modelRow.reasoningTokens += usage.reasoningTokens;
      modelRow.apiCalls += usage.apiCallCount;
      modelRowsByKey.set(modelKey, modelRow);
      return {
        provider: usage.provider,
        model: usage.model,
        billingMode: usage.billingMode,
        costStatus: usage.costStatus,
        costSource: usage.costSource,
        pricingVersion: usage.pricingVersion,
        estimatedCostUsd: usage.estimatedCostUsd,
        actualCostUsd: usage.actualCostUsd,
        costUsd: cost,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        reasoningTokens: usage.reasoningTokens,
      };
    });
    return {
      issueId: task.issueId,
      issueIdentifier: task.issueIdentifier,
      issueTitle: task.issueTitle,
      projectId: task.projectId,
      projectName: task.projectName,
      agentId: task.agentId,
      agentName: task.agentName,
      runIds: [...task.runIds].sort(),
      sessionIds: [...task.sessionIds].sort(),
      completionState: task.completionState,
      costUsd: round(costUsd),
      costPerCompletedTaskUsd: task.completionState === "succeeded" || task.completionState === "done" ? round(costUsd) : null,
      inputTokens: taskUsage.reduce((sum, row) => sum + row.inputTokens, 0),
      outputTokens,
      wallClockMs,
      turns: new Set(taskCalls.map((row) => row.turnId)).size,
      throughputOutputTokensPerSecond: apiDurationMs > 0 ? round(outputTokens / (apiDurationMs / 1000)) : null,
      avgLatencyMs: taskCalls.length > 0 ? round(apiDurationMs / taskCalls.length) : null,
      avgTtftMs: ttftSamples.length > 0 ? round((ttftSamples.reduce((sum, value) => sum + value, 0) / ttftSamples.length) * 1000) : null,
      compactions: taskUsage.filter((row) => row.task === "compression").reduce((sum, row) => sum + row.apiCallCount, 0),
      stalls: null,
      models,
    };
  });

  const trends = new Map<string, { bucket: string; costUsd: number; inputTokens: number; outputTokens: number; completedTasks: number }>();
  for (const usage of modelUsage) {
    const session = sessionById.get(usage.sessionId);
    if (!session) continue;
    const bucket = bucketDate(new Date(session.startedAt * 1000), input.grain);
    const row = trends.get(bucket) ?? { bucket, costUsd: 0, inputTokens: 0, outputTokens: 0, completedTasks: 0 };
    row.costUsd += usdToDashboardCost(usage) ?? 0;
    row.inputTokens += usage.inputTokens;
    row.outputTokens += usage.outputTokens;
    trends.set(bucket, row);
  }
  for (const task of taskRows) {
    if (task.costPerCompletedTaskUsd === null) continue;
    const session = sessionById.get(task.sessionIds[0] ?? "");
    if (!session) continue;
    const bucket = bucketDate(new Date(session.startedAt * 1000), input.grain);
    const row = trends.get(bucket);
    if (row) row.completedTasks += 1;
  }

  const modelRows = [...modelRowsByKey.values()].map((row) => {
    const matchingTaskRows = taskRows.filter((task) =>
      task.models.some((model) =>
        model.provider === row.provider
        && model.model === row.model
        && model.billingMode === row.billingMode
        && model.costStatus === row.costStatus
        && model.costSource === row.costSource
        && (model.pricingVersion ?? null) === (row.pricingVersion ?? null),
      ),
    );
    const calls = apiCalls.filter((call) => call.model === row.model && call.provider === row.provider);
    const durationMs = calls.reduce((sum, call) => sum + call.apiDuration * 1000, 0);
    const ttftSamples = calls.map((call) => call.ttft).filter((value): value is number => value !== null);
    const completedTasks = matchingTaskRows.filter((task) => task.completionState === "succeeded" || task.completionState === "done").length;
    const wallClockSamples = matchingTaskRows.map((task) => task.wallClockMs).filter((value): value is number => value !== null);
    const modelCostUsd = row.actualCostUsd ?? row.estimatedCostUsd;
    const costPerCompletedTaskUsd = completedTasks > 0 ? modelCostUsd / completedTasks : null;
    return {
      ...row,
      estimatedCostUsd: round(row.estimatedCostUsd),
      actualCostUsd: row.actualCostUsd === null ? null : round(row.actualCostUsd),
      avgLatencyMs: calls.length > 0 ? round(durationMs / calls.length) : null,
      avgTtftMs: ttftSamples.length > 0 ? round((ttftSamples.reduce((sum, value) => sum + value, 0) / ttftSamples.length) * 1000) : null,
      throughputOutputTokensPerSecond: durationMs > 0 ? round(row.outputTokens / (durationMs / 1000)) : null,
      completedTasks,
      costPerCompletedTaskUsd: costPerCompletedTaskUsd === null ? null : round(costPerCompletedTaskUsd),
      avgTaskWallClockMs: wallClockSamples.length > 0
        ? round(wallClockSamples.reduce((sum, value) => sum + value, 0) / wallClockSamples.length)
        : null,
      turns: matchingTaskRows.reduce((sum, task) => sum + task.turns, 0),
      compactions: matchingTaskRows.reduce((sum, task) => sum + task.compactions, 0),
      stalls: null,
      stallsAvailability: "unavailable" as const,
    };
  });

  return {
    companyId: input.companyId,
    grain: input.grain,
    filters: input.filters ?? {},
    freshness: input.freshness,
    availability: {
      avgLatencyMs: apiCalls.length > 0 ? "available" : "unavailable",
      avgTtftMs: apiCalls.some((call) => call.ttft !== null) ? "available" : "unavailable",
      stalls: "unavailable",
    },
    trends: [...trends.values()].map((row) => ({ ...row, costUsd: round(row.costUsd) })).sort((a, b) => a.bucket.localeCompare(b.bucket)),
    taskRows: taskRows.sort((a, b) => b.costUsd - a.costUsd),
    modelRows: modelRows.sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd),
    unattributedSessions: [
      ...input.usage.sessions
        .filter((session) => !attributionBySession.has(session.sessionId))
        .map((session) => ({
          sessionId: session.sessionId,
          startedAt: session.startedAt >= 1_000_000_000 ? new Date(session.startedAt * 1000).toISOString() : null,
          billingMode: session.billingMode,
          costStatus: session.costStatus,
          estimatedCostUsd: session.estimatedCostUsd,
          actualCostUsd: session.actualCostUsd,
        })),
      ...input.usage.modelUsage
        .filter((usage) => !sessionById.has(usage.sessionId) && !attributionBySession.has(usage.sessionId))
        .map((usage) => ({
          sessionId: usage.sessionId,
          startedAt: usage.firstSeen && usage.firstSeen >= 1_000_000_000 ? new Date(usage.firstSeen * 1000).toISOString() : null,
          billingMode: usage.billingMode,
          costStatus: usage.costStatus,
          estimatedCostUsd: usage.estimatedCostUsd,
          actualCostUsd: usage.actualCostUsd,
        })),
    ],
  };
}

export async function loadHermesRunAttributions(db: Db, companyId: string): Promise<HermesRunAttribution[]> {
  const rows = await db
    .select({
      runId: heartbeatRuns.id,
      resultJson: heartbeatRuns.resultJson,
      sessionIdAfter: heartbeatRuns.sessionIdAfter,
      agentId: heartbeatRuns.agentId,
      agentName: agents.name,
      status: heartbeatRuns.status,
      runStartedAt: heartbeatRuns.startedAt,
      runFinishedAt: heartbeatRuns.finishedAt,
      contextIssueId: sql<string | null>`${heartbeatRuns.contextSnapshot} ->> 'issueId'`,
      activityIssueId: activityLog.entityId,
      issueId: issues.id,
      issueIdentifier: issues.identifier,
      issueTitle: issues.title,
      projectId: projects.id,
      projectName: projects.name,
    })
    .from(heartbeatRuns)
    .leftJoin(agents, and(eq(agents.companyId, companyId), eq(agents.id, heartbeatRuns.agentId)))
    .leftJoin(
      activityLog,
      and(
        eq(activityLog.companyId, companyId),
        eq(activityLog.runId, heartbeatRuns.id),
        eq(activityLog.entityType, "issue"),
      ),
    )
    .leftJoin(
      issues,
      and(
        eq(issues.companyId, companyId),
        eq(issues.id, sql<string>`coalesce(${heartbeatRuns.contextSnapshot} ->> 'issueId', ${activityLog.entityId})::uuid`),
      ),
    )
    .leftJoin(projects, and(eq(projects.companyId, companyId), eq(projects.id, issues.projectId)))
    .where(eq(heartbeatRuns.companyId, companyId));

  return rows.flatMap((row) => {
    const sessionId = extractFullHermesSessionId(row);
    if (!sessionId) return [];
    return [{
      runId: row.runId,
      sessionId,
      agentId: row.agentId,
      agentName: row.agentName ?? null,
      issueId: row.issueId ?? row.contextIssueId ?? row.activityIssueId ?? null,
      issueIdentifier: row.issueIdentifier ?? null,
      issueTitle: row.issueTitle ?? null,
      projectId: row.projectId ?? null,
      projectName: row.projectName ?? null,
      status: row.status,
      runStartedAt: row.runStartedAt ?? null,
      runFinishedAt: row.runFinishedAt ?? null,
    }];
  });
}

function defaultHermesStateDbPath(): string {
  return process.env.HERMES_STATE_DB_PATH ?? join(homedir(), ".hermes", "state.db");
}

function defaultHermesSidecarPath(): string {
  return process.env.HERMES_COST_TELEMETRY_DB_PATH ?? join(homedir(), ".hermes", "cost-dashboard", "telemetry.sqlite3");
}

export async function buildLocalFleetCostDashboard(db: Db, companyId: string, query: FleetDashboardQuery = {}) {
  const collectorCompanyId = process.env.HERMES_COST_COMPANY_ID;
  if (!collectorCompanyId) {
    throw serviceUnavailable("HERMES_COST_COMPANY_ID is required for local Hermes cost collection");
  }
  if (collectorCompanyId !== companyId) {
    throw serviceUnavailable("Local Hermes collector company binding does not match requested company");
  }
  const stateDbPath = defaultHermesStateDbPath();
  const sidecarDbPath = defaultHermesSidecarPath();
  let usage: HermesUsageSnapshot = { sessions: [], modelUsage: [] };
  let apiCalls: HermesApiCall[] = [];
  if (!existsSync(stateDbPath)) {
    throw serviceUnavailable(`Hermes state database not configured or missing: ${stateDbPath}`);
  }
  try {
    usage = readHermesSessionUsage(stateDbPath);
  } catch (error) {
    throw serviceUnavailable(error instanceof Error ? error.message : String(error));
  }
  apiCalls = readHermesApiCalls(sidecarDbPath);
  const attributions = await loadHermesRunAttributions(db, companyId);
  const observedAt = new Date().toISOString();
  return aggregateFleetCostDashboard({
    companyId,
    range: query.range,
    filters: query.filters,
    grain: query.grain ?? "day",
    usage,
    apiCalls,
    attributions,
    freshness: {
      observedAt,
      checkpoint: { sequence: Date.now(), cursor: stateDbPath },
      errors: [],
    },
  });
}
