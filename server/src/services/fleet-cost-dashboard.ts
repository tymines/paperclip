import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { homedir } from "node:os";
import type { DatabaseSync } from "node:sqlite";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { activityLog, agents, heartbeatRuns, issues, projects } from "@paperclipai/db";
import { serviceUnavailable } from "../errors.js";
import type { FleetCostDashboardPayload } from "@paperclipai/shared";

export type FleetDashboardGrain = "day" | "week" | "month";

export interface HermesSessionUsage {
  sessionId: string;
  /** fleet box that produced this observation; undefined means the local default box */
  boxId?: string;
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
  /** fleet box that produced this observation; undefined means the local default box */
  boxId?: string;
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

export class FleetObservationEnvelopeError extends Error {
  override name = "FleetObservationEnvelopeError";
}

/**
 * Same-ID/different-content collision. Raised before any store mutation or
 * normalized output when two observations share an observationId but carry
 * semantically different wrapper/payload/source content.
 */
export class FleetObservationCollisionError extends FleetObservationEnvelopeError {
  override name = "FleetObservationCollisionError";
}

export const DEFAULT_FLEET_BOX_ID = "mac-local";

export function fleetItemBoxId(item: { boxId?: string }): string {
  return item.boxId ?? DEFAULT_FLEET_BOX_ID;
}

/** composite key that keeps same-id sessions from different boxes distinct */
function fleetSessionKey(item: { boxId?: string; sessionId: string }): string {
  return `${fleetItemBoxId(item)}\0${item.sessionId}`;
}

export interface FleetSourceReport {
  boxId: string;
  collectorId: string;
  profileId: string | null;
  kind: "hermes-local" | "envelope-file";
  status: "ok" | "unavailable" | "not-configured";
  observedAt: string | null;
  checkpoint: FleetObservation["checkpoint"] | null;
  errors: string[];
  /** human-readable explanation for non-ok statuses; never silently omitted */
  detail: string | null;
}

export interface FleetBoxCollection {
  report: FleetSourceReport;
  usage: HermesUsageSnapshot;
  apiCalls: HermesApiCall[];
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
  // Top-level trusted metadata is validated before the store is touched, even
  // for programmatically supplied typed envelopes that bypass the parser.
  validateFleetEnvelopeSource(envelope.source);
  validateFleetEnvelopeTopLevel(envelope as unknown as Record<string, unknown>);
  // Fail loud before any insertion: validate every observation's wrapper and
  // per-kind payload completely so a malformed observation can never enter
  // the dedupe store and a replay can never partially normalize.
  for (const observation of envelope.observations) {
    if (observation.schemaVersion !== "fleet-observation/v1") {
      throw new Error(`Unsupported fleet observation schema: ${observation.schemaVersion}`);
    }
    validateFleetObservationWrapper(observation as unknown as Record<string, unknown>, envelope.source);
    validateFleetObservationPayload(observation.observationId, observation.payloadKind, observation.payload);
  }
  // AUTONOMOUS GAP-FILL A — duplicate-ID collision policy (flagged in the PR
  // body and revision-3 artifact): exact same-ID/same-content observations
  // are an idempotent skip; same-ID/different-content collisions throw a
  // FleetObservationCollisionError before any store mutation. The complete
  // batch is collision-checked against itself and the existing store before
  // anything is inserted, so ingestion is atomic per envelope: a colliding
  // later entry can never leave earlier entries in the store.
  const batchContentById = new Map<string, string>();
  for (const observation of envelope.observations) {
    const content = canonicalObservationContent(observation);
    const seen = batchContentById.get(observation.observationId);
    if (seen !== undefined && seen !== content) {
      throw new FleetObservationCollisionError(
        `Fleet observation collision for ${observation.observationId} within one envelope: same id, different content`,
      );
    }
    batchContentById.set(observation.observationId, content);
    const stored = store.get(observation.observationId);
    if (stored && canonicalObservationContent(stored) !== content) {
      throw new FleetObservationCollisionError(
        `Fleet observation collision for ${observation.observationId}: conflicts with an already-ingested observation (same id, different content)`,
      );
    }
  }
  let inserted = 0;
  let skipped = 0;
  for (const observation of envelope.observations) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const FLEET_PAYLOAD_KINDS = new Set(["cost.usage.session", "cost.usage.model", "cost.speed.api_call"]);

function invalidPayload(observationId: string, kind: string, field: string, reason: string): FleetObservationEnvelopeError {
  return new FleetObservationEnvelopeError(
    `Fleet observation ${observationId} (${kind}) has an invalid payload field "${field}": ${reason}`,
  );
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNullableFiniteNonNegative(value: unknown): value is number | null {
  return value === null || isFiniteNonNegative(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/** required nonnegative integer count/token field */
function requireCount(payload: Record<string, unknown>, observationId: string, kind: string, field: string) {
  if (!isNonNegativeInteger(payload[field])) {
    throw invalidPayload(observationId, kind, field, "expected a nonnegative integer");
  }
}

/** required nonnegative finite duration/timestamp field (fractional allowed) */
function requireMeasure(payload: Record<string, unknown>, observationId: string, kind: string, field: string) {
  if (!isFiniteNonNegative(payload[field])) {
    throw invalidPayload(observationId, kind, field, "expected a nonnegative finite number");
  }
}

function requireNullableMeasure(payload: Record<string, unknown>, observationId: string, kind: string, field: string) {
  if (!isNullableFiniteNonNegative(payload[field])) {
    throw invalidPayload(observationId, kind, field, "expected null or a nonnegative finite number");
  }
}

function requireString(payload: Record<string, unknown>, observationId: string, kind: string, field: string) {
  if (!isNonEmptyString(payload[field])) {
    throw invalidPayload(observationId, kind, field, "expected a nonempty string");
  }
}

function requireNullableString(payload: Record<string, unknown>, observationId: string, kind: string, field: string) {
  if (!isNullableString(payload[field])) {
    throw invalidPayload(observationId, kind, field, "expected null or a string");
  }
}

const USAGE_COUNT_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens",
  "apiCallCount",
] as const;

const USAGE_COST_FIELDS = ["estimatedCostUsd", "actualCostUsd"] as const;

const USAGE_BILLING_FIELDS = ["billingMode", "costStatus", "costSource"] as const;

/**
 * Complete per-kind payload validation. Every discriminated payload kind is
 * validated field by field before the observation may be ingested or
 * deduplicated: required ids/strings, timestamps, enum/source fields,
 * nullable fields, finite numeric types, and nonnegative counts/durations/
 * tokens. Any missing, string, NaN/infinite, negative, malformed, or
 * wrong-kind field rejects the whole envelope with a
 * FleetObservationEnvelopeError identifying the observation, kind, and
 * field. No partial normalization and no NaN propagation.
 */
export function validateFleetObservationPayload(
  observationId: string,
  payloadKind: FleetObservation["payloadKind"],
  payload: unknown,
): void {
  if (!isRecord(payload)) {
    throw invalidPayload(observationId, payloadKind, "(payload)", "expected an object");
  }
  if (payloadKind === "cost.usage.session") {
    requireString(payload, observationId, payloadKind, "sessionId");
    requireMeasure(payload, observationId, payloadKind, "startedAt");
    requireNullableMeasure(payload, observationId, payloadKind, "endedAt");
    for (const field of USAGE_COUNT_FIELDS) requireCount(payload, observationId, payloadKind, field);
    for (const field of USAGE_COST_FIELDS) requireNullableMeasure(payload, observationId, payloadKind, field);
    for (const field of USAGE_BILLING_FIELDS) requireString(payload, observationId, payloadKind, field);
    requireNullableString(payload, observationId, payloadKind, "pricingVersion");
    return;
  }
  if (payloadKind === "cost.usage.model") {
    requireString(payload, observationId, payloadKind, "sessionId");
    requireString(payload, observationId, payloadKind, "model");
    requireString(payload, observationId, payloadKind, "provider");
    if (typeof payload.task !== "string") {
      throw invalidPayload(observationId, payloadKind, "task", "expected a string");
    }
    for (const field of USAGE_COUNT_FIELDS) requireCount(payload, observationId, payloadKind, field);
    for (const field of USAGE_COST_FIELDS) requireNullableMeasure(payload, observationId, payloadKind, field);
    for (const field of USAGE_BILLING_FIELDS) requireString(payload, observationId, payloadKind, field);
    requireNullableString(payload, observationId, payloadKind, "pricingVersion");
    requireNullableMeasure(payload, observationId, payloadKind, "firstSeen");
    requireNullableMeasure(payload, observationId, payloadKind, "lastSeen");
    return;
  }
  requireString(payload, observationId, payloadKind, "sessionId");
  requireString(payload, observationId, payloadKind, "turnId");
  requireString(payload, observationId, payloadKind, "apiRequestId");
  requireNullableString(payload, observationId, payloadKind, "paperclipRunId");
  requireString(payload, observationId, payloadKind, "model");
  requireString(payload, observationId, payloadKind, "provider");
  for (const field of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens"] as const) {
    requireCount(payload, observationId, payloadKind, field);
  }
  requireMeasure(payload, observationId, payloadKind, "startedAt");
  requireMeasure(payload, observationId, payloadKind, "endedAt");
  requireMeasure(payload, observationId, payloadKind, "apiDuration");
  requireNullableMeasure(payload, observationId, payloadKind, "ttft");
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (isRecord(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortKeysDeep(value[key]);
    return sorted;
  }
  return value;
}

/** deterministic content fingerprint for duplicate-ID collision checks */
function canonicalObservationContent(observation: FleetObservation): string {
  return JSON.stringify(sortKeysDeep(observation));
}

/**
 * Envelope source identity validation. boxId/collectorId must be nonempty
 * strings and profileId must be present as a nullable string — the profile
 * identity is part of the source invariant (AUTONOMOUS GAP-FILL B).
 */
function validateFleetEnvelopeSource(source: unknown): asserts source is FleetObservation["source"] {
  if (
    !isRecord(source)
    || !isNonEmptyString(source.boxId)
    || !isNonEmptyString(source.collectorId)
    || !isNullableString(source.profileId)
  ) {
    throw new FleetObservationEnvelopeError(
      "Fleet observation envelope is missing source identity (boxId/collectorId/profileId)",
    );
  }
}

/**
 * Complete top-level envelope validation. The envelope's own observedAt,
 * checkpoint, and freshness are trusted by collectors and must be validated
 * before the typed envelope is returned or the store is touched — no
 * unchecked cast may return malformed top-level trusted metadata.
 */
function validateFleetEnvelopeTopLevel(raw: Record<string, unknown>): void {
  if (!isNonEmptyString(raw.observedAt) || Number.isNaN(Date.parse(raw.observedAt))) {
    throw new FleetObservationEnvelopeError(
      "Fleet observation envelope has an invalid observedAt: expected an ISO timestamp string",
    );
  }
  const checkpoint = raw.checkpoint;
  if (!isRecord(checkpoint) || !isNonNegativeInteger(checkpoint.sequence) || !isNullableString(checkpoint.cursor)) {
    throw new FleetObservationEnvelopeError(
      "Fleet observation envelope has an invalid checkpoint: expected { sequence: nonnegative integer, cursor: string | null }",
    );
  }
  const freshness = raw.freshness;
  if (!isRecord(freshness) || !Array.isArray(freshness.errors) || !freshness.errors.every((error) => typeof error === "string")) {
    throw new FleetObservationEnvelopeError(
      "Fleet observation envelope has an invalid freshness: expected { errors: string[] }",
    );
  }
}

/** envelope/observation wrapper fields shared by every observation */
function validateFleetObservationWrapper(
  observation: Record<string, unknown>,
  envelopeSource: FleetObservation["source"],
): void {
  const observationId = typeof observation.observationId === "string" ? observation.observationId : "(unknown)";
  const kind = typeof observation.payloadKind === "string" ? observation.payloadKind : "(unknown)";
  if (!isNonEmptyString(observation.observedAt) || Number.isNaN(Date.parse(observation.observedAt))) {
    throw invalidPayload(observationId, kind, "observedAt", "expected an ISO timestamp string");
  }
  const checkpoint = observation.checkpoint;
  if (!isRecord(checkpoint) || !isFiniteNonNegative(checkpoint.sequence) || !isNullableString(checkpoint.cursor)) {
    throw invalidPayload(observationId, kind, "checkpoint.sequence", "expected { sequence: nonnegative finite number, cursor: string | null }");
  }
  const freshness = observation.freshness;
  if (!isRecord(freshness) || !Array.isArray(freshness.errors) || !freshness.errors.every((error) => typeof error === "string")) {
    throw invalidPayload(observationId, kind, "freshness.errors", "expected { errors: string[] }");
  }
  // AUTONOMOUS GAP-FILL B — top-level profile invariant (flagged in the PR
  // body and revision-3 artifact): every observation source must match the
  // envelope box, collector, AND profile identity exactly under nullable
  // semantics, just like box/collector identity.
  const source = observation.source;
  if (
    !isRecord(source)
    || source.boxId !== envelopeSource.boxId
    || source.collectorId !== envelopeSource.collectorId
    || !isNullableString(source.profileId)
    || source.profileId !== envelopeSource.profileId
  ) {
    throw invalidPayload(observationId, kind, "source", "observation source must match the envelope source boxId/collectorId/profileId");
  }
}

/**
 * Structural validation of a staged cross-box envelope. Fails loudly on any
 * incompatibility; callers must never turn a bad envelope into an empty
 * successful collection. The envelope's own observedAt/checkpoint/freshness/
 * source (including profileId) are validated completely before the typed
 * envelope is returned, so no unchecked cast can return malformed top-level
 * trusted metadata.
 */
export function parseFleetObservationEnvelope(raw: unknown): FleetObservationEnvelope {
  if (!isRecord(raw)) {
    throw new FleetObservationEnvelopeError("Fleet observation envelope is not an object");
  }
  if (raw.schemaVersion !== "fleet-observation/v1") {
    throw new FleetObservationEnvelopeError(
      `Unsupported fleet observation schema: ${typeof raw.schemaVersion === "string" ? raw.schemaVersion : "missing"}`,
    );
  }
  validateFleetEnvelopeSource(raw.source);
  validateFleetEnvelopeTopLevel(raw);
  if (!Array.isArray(raw.observations)) {
    throw new FleetObservationEnvelopeError("Fleet observation envelope is missing an observations array");
  }
  const envelopeSource = raw.source;
  for (const observation of raw.observations) {
    if (!isRecord(observation)) {
      throw new FleetObservationEnvelopeError("Fleet observation is not an object");
    }
    if (observation.schemaVersion !== "fleet-observation/v1") {
      throw new FleetObservationEnvelopeError(
        `Unsupported fleet observation schema: ${typeof observation.schemaVersion === "string" ? observation.schemaVersion : "missing"}`,
      );
    }
    if (typeof observation.observationId !== "string" || observation.observationId.length === 0) {
      throw new FleetObservationEnvelopeError("Fleet observation is missing a stable observationId");
    }
    if (typeof observation.payloadKind !== "string" || !FLEET_PAYLOAD_KINDS.has(observation.payloadKind)) {
      throw new FleetObservationEnvelopeError(`Unsupported fleet observation payloadKind: ${String(observation.payloadKind)}`);
    }
    if (!isRecord(observation.payload)) {
      throw new FleetObservationEnvelopeError(`Fleet observation ${observation.observationId} has a non-object payload`);
    }
    validateFleetObservationWrapper(observation, envelopeSource);
    validateFleetObservationPayload(
      observation.observationId,
      observation.payloadKind as FleetObservation["payloadKind"],
      observation.payload,
    );
  }
  return raw as unknown as FleetObservationEnvelope;
}

/**
 * Rebuild a usage snapshot + API-call list from a validated envelope.
 * Observations are deduplicated through the ingest store first: replays of an
 * already-ingested envelope contribute nothing, so cross-box data cannot be
 * double counted. Every item is stamped with the envelope's source boxId.
 * Normalization consumes precisely the observations inserted by this call:
 * an observation ID contributes at most once, including duplicates inside one
 * envelope (AUTONOMOUS GAP-FILL A) and replays against an existing store.
 */
export function normalizeFleetEnvelopeToUsage(
  envelope: FleetObservationEnvelope,
  store: FleetObservationStore = new Map(),
): { usage: HermesUsageSnapshot; apiCalls: HermesApiCall[]; inserted: number; skipped: number } {
  const seenBefore = new Set(store.keys());
  const { inserted, skipped } = ingestFleetObservations(store, envelope);
  const boxId = envelope.source.boxId;
  const usage: HermesUsageSnapshot = { sessions: [], modelUsage: [] };
  const apiCalls: HermesApiCall[] = [];
  const consumed = new Set<string>();
  for (const observation of envelope.observations) {
    if (seenBefore.has(observation.observationId) || consumed.has(observation.observationId)) continue;
    consumed.add(observation.observationId);
    if (observation.payloadKind === "cost.usage.session") {
      usage.sessions.push({ ...(observation.payload as HermesSessionUsage), boxId });
    } else if (observation.payloadKind === "cost.usage.model") {
      usage.modelUsage.push({ ...(observation.payload as HermesModelUsage), boxId });
    } else {
      apiCalls.push({ ...(observation.payload as HermesApiCall), boxId });
    }
  }
  return { usage, apiCalls, inserted, skipped };
}

/**
 * Windows collection adapter. The Windows box is zero-footprint from this
 * repository: no probes, no SSH, no API calls, no mutation. The box publishes
 * a `fleet-observation/v1` envelope through a future transport; the adapter's
 * contract boundary is a staged envelope JSON file. Until a path is
 * configured the source reports `not-configured` explicitly; a configured but
 * unreadable or incompatible file reports `unavailable` with the real error.
 */
export function collectWindowsEnvelopeBox(envelopePath: string | null | undefined): FleetBoxCollection {
  const fallbackBoxId = "windows-box";
  const collectorId = "hermes-windows-envelope";
  if (!envelopePath) {
    return {
      report: {
        boxId: fallbackBoxId,
        collectorId,
        profileId: null,
        kind: "envelope-file",
        status: "not-configured",
        observedAt: null,
        checkpoint: null,
        errors: [],
        detail: "HERMES_COST_WINDOWS_ENVELOPE_PATH is not set: no staged Windows envelope is configured. The Windows box is never probed; it must publish a fleet-observation/v1 envelope through the deferred cross-box transport.",
      },
      usage: { sessions: [], modelUsage: [] },
      apiCalls: [],
    };
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(envelopePath, "utf8"));
    const envelope = parseFleetObservationEnvelope(raw);
    const { usage, apiCalls } = normalizeFleetEnvelopeToUsage(envelope);
    return {
      report: {
        boxId: envelope.source.boxId,
        collectorId: envelope.source.collectorId,
        profileId: envelope.source.profileId ?? null,
        kind: "envelope-file",
        status: "ok",
        observedAt: typeof envelope.observedAt === "string" ? envelope.observedAt : null,
        checkpoint: envelope.checkpoint ?? null,
        errors: [...(envelope.freshness?.errors ?? [])],
        detail: null,
      },
      usage,
      apiCalls,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      report: {
        boxId: fallbackBoxId,
        collectorId,
        profileId: null,
        kind: "envelope-file",
        status: "unavailable",
        observedAt: null,
        checkpoint: null,
        errors: [`Windows envelope collector failed: ${detail}`],
        detail,
      },
      usage: { sessions: [], modelUsage: [] },
      apiCalls: [],
    };
  }
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

/**
 * Bare session ids for display; when two boxes report the same session id,
 * qualify each with its box so distinct sessions are never conflated.
 */
function serializeTaskSessionIds(
  task: { sessionIds: Set<string> },
  sessionById: Map<string, HermesSessionUsage>,
): string[] {
  const sessions = [...task.sessionIds].map((key) => ({
    sessionId: sessionById.get(key)?.sessionId ?? key,
    boxId: fleetItemBoxId(sessionById.get(key) ?? {}),
  }));
  const counts = new Map<string, number>();
  for (const { sessionId } of sessions) counts.set(sessionId, (counts.get(sessionId) ?? 0) + 1);
  return sessions
    .map(({ sessionId, boxId }) => ((counts.get(sessionId) ?? 0) > 1 ? `${boxId}:${sessionId}` : sessionId))
    .sort();
}

/**
 * Internal model-row accumulator: the public model-row fields from
 * FleetCostDashboardPayload plus the transient box set. Keeps the
 * aggregation strongly typed so contract drift fails typecheck instead of
 * compiling silently.
 */
type FleetModelRow = FleetCostDashboardPayload["modelRows"][number];

interface ModelRowAccumulator extends Omit<FleetModelRow, "boxes"> {
  boxes: Set<string>;
}

export function aggregateFleetCostDashboard(input: {
  companyId: string;
  range?: FleetDashboardQuery["range"];
  filters?: FleetDashboardQuery["filters"];
  grain: FleetDashboardGrain;
  usage: HermesUsageSnapshot;
  apiCalls: HermesApiCall[];
  attributions: HermesRunAttribution[];
  /** per-box collection reports; echoed to the payload for source transparency */
  sources?: FleetSourceReport[];
  freshness: {
    observedAt: string | null;
    checkpoint: FleetObservation["checkpoint"] | null;
    errors: string[];
  };
}): FleetCostDashboardPayload {
  const attributionBySession = new Map(input.attributions.map((row) => [row.sessionId, row]));
  const sessionById = new Map(input.usage.sessions.map((session) => [fleetSessionKey(session), session]));
  const sessionIds = new Set(
    input.usage.sessions
      .filter((session) => matchesRange(session, input.range))
      .filter((session) => {
        const attr = attributionBySession.get(session.sessionId);
        if (input.filters?.agentId && attr?.agentId !== input.filters.agentId) return false;
        if (input.filters?.issueId && attr?.issueId !== input.filters.issueId) return false;
        if (input.filters?.projectId && attr?.projectId !== input.filters.projectId) return false;
        if (input.filters?.model) {
          return input.usage.modelUsage.some((usage) => fleetSessionKey(usage) === fleetSessionKey(session) && usage.model === input.filters?.model);
        }
        return true;
      })
      .map((session) => fleetSessionKey(session)),
  );
  const modelUsage = input.usage.modelUsage.filter((usage) =>
    sessionIds.has(fleetSessionKey(usage)) && (!input.filters?.model || usage.model === input.filters.model)
  );
  const apiCalls = input.apiCalls.filter((call) =>
    sessionIds.has(fleetSessionKey(call)) && (!input.filters?.model || call.model === input.filters.model)
  );

  // Index cost-usage rows by box-qualified session so observed API calls are
  // correlated to a billing/cost identity through their own session, never by
  // provider/model alone.
  const modelUsageBySession = new Map<string, HermesModelUsage[]>();
  for (const usage of modelUsage) {
    const key = fleetSessionKey(usage);
    const list = modelUsageBySession.get(key);
    if (list) list.push(usage);
    else modelUsageBySession.set(key, [usage]);
  }

  // Attribute each observed API call to at most one model-row billing/cost
  // identity. A call is eligible only for identities present in its own
  // box-qualified session whose provider and model both match. When one
  // session reports multiple billing identities for the same provider/model
  // (split rows), the source cannot disambiguate which identity owns the
  // call; the call is counted as an ambiguous omitted sample on every
  // candidate row instead of guessing or duplicating the call's
  // latency/TTFT/throughput across all of them. Calls with no matching
  // identity in their own session attribute to no row.
  // AUTONOMOUS GAP-FILL C — mixed coverage contract (flagged in the PR body
  // and revision-3 artifact): ambiguity is tracked per model identity as an
  // omitted-sample count, never as a global boolean that discards valid
  // unique samples from other sessions.
  const callsByModelKey = new Map<string, HermesApiCall[]>();
  const ambiguousOmittedCallsByModelKey = new Map<string, number>();
  for (const call of apiCalls) {
    const sessionUsage = modelUsageBySession.get(fleetSessionKey(call)) ?? [];
    const candidateKeys = new Set(
      sessionUsage
        .filter((usage) => usage.model === call.model && usage.provider === call.provider)
        .map((usage) => modelAggregationKey(usage)),
    );
    if (candidateKeys.size === 1) {
      const key = candidateKeys.values().next().value as string;
      const list = callsByModelKey.get(key);
      if (list) list.push(call);
      else callsByModelKey.set(key, [call]);
    } else if (candidateKeys.size > 1) {
      for (const key of candidateKeys) {
        ambiguousOmittedCallsByModelKey.set(key, (ambiguousOmittedCallsByModelKey.get(key) ?? 0) + 1);
      }
    }
  }

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
  for (const sessionKey of sessionIds) {
    const session = sessionById.get(sessionKey);
    const attr = session ? attributionBySession.get(session.sessionId) : undefined;
    const key = attr?.issueId ?? `unattributed:${sessionKey}`;
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
    row.sessionIds.add(sessionKey);
    if (attr) row.runIds.add(attr.runId);
    taskMap.set(key, row);
  }

  const modelRowsByKey = new Map<string, ModelRowAccumulator>();
  const taskRows = [...taskMap.values()].map((task) => {
    const taskSessionIds = task.sessionIds;
    const taskUsage = modelUsage.filter((usage) => taskSessionIds.has(fleetSessionKey(usage)));
    const taskCalls = apiCalls.filter((call) => taskSessionIds.has(fleetSessionKey(call)));
    const attrTimes = [...taskSessionIds]
      .map((sessionKey) => {
        const session = sessionById.get(sessionKey);
        return session ? attributionBySession.get(session.sessionId) : undefined;
      })
      .filter((attr): attr is HermesRunAttribution => Boolean(attr));
    const starts = attrTimes.map((attr) => attr.runStartedAt?.getTime()).filter((value): value is number => value !== undefined);
    const finishes = attrTimes.map((attr) => attr.runFinishedAt?.getTime()).filter((value): value is number => value !== undefined);
    const wallClockMs = starts.length > 0 && finishes.length > 0 ? Math.max(0, Math.max(...finishes) - Math.min(...starts)) : null;
    const costUsd = taskUsage.reduce((sum, row) => sum + (usdToDashboardCost(row) ?? 0), 0);
    const outputTokens = taskUsage.reduce((sum, row) => sum + row.outputTokens, 0);
    const apiDurationMs = taskCalls.reduce((sum, row) => sum + row.apiDuration * 1000, 0);
    // Same-population throughput: the numerator is the sum of outputTokens
    // from the exact observed taskCalls and the denominator is those same
    // calls' duration. State-db usage output tokens stay separately labeled
    // usage totals and never enter sampled throughput.
    const sampledOutputTokens = taskCalls.reduce((sum, row) => sum + row.outputTokens, 0);
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
        usageApiCalls: 0,
        speedSampleApiCalls: null,
        speedAmbiguousOmittedApiCalls: 0,
        speedAvailability: "unavailable" as const,
        avgLatencyMs: null,
        avgTtftMs: null,
        throughputOutputTokensPerSecond: null,
        completedTasks: 0,
        costPerCompletedTaskUsd: null,
        avgTaskWallClockMs: null,
        turns: null,
        compactions: 0,
        stalls: null,
        stallsAvailability: "unavailable" as const,
        boxes: new Set<string>(),
      };
      modelRow.boxes.add(fleetItemBoxId(usage));
      modelRow.estimatedCostUsd += usage.estimatedCostUsd ?? 0;
      modelRow.actualCostUsd = usage.actualCostUsd === null ? modelRow.actualCostUsd : (modelRow.actualCostUsd ?? 0) + usage.actualCostUsd;
      modelRow.inputTokens += usage.inputTokens;
      modelRow.outputTokens += usage.outputTokens;
      modelRow.cacheReadTokens += usage.cacheReadTokens;
      modelRow.cacheWriteTokens += usage.cacheWriteTokens;
      modelRow.reasoningTokens += usage.reasoningTokens;
      modelRow.usageApiCalls += usage.apiCallCount;
      // Compactions come from this identity's own compression-task usage
      // rows, so one model's compactions can never land on another row and
      // whole-task totals are never copied onto every model row.
      if (usage.task === "compression") modelRow.compactions += usage.apiCallCount;
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
      sessionIds: serializeTaskSessionIds(task, sessionById),
      boxes: [...new Set([...task.sessionIds].map((key) => fleetItemBoxId(sessionById.get(key) ?? {})))].sort(),
      completionState: task.completionState,
      costUsd: round(costUsd),
      costPerCompletedTaskUsd: task.completionState === "succeeded" || task.completionState === "done" ? round(costUsd) : null,
      inputTokens: taskUsage.reduce((sum, row) => sum + row.inputTokens, 0),
      outputTokens,
      wallClockMs,
      turns: new Set(taskCalls.map((row) => row.turnId)).size,
      throughputOutputTokensPerSecond: apiDurationMs > 0 ? round(sampledOutputTokens / (apiDurationMs / 1000)) : null,
      avgLatencyMs: taskCalls.length > 0 ? round(apiDurationMs / taskCalls.length) : null,
      avgTtftMs: ttftSamples.length > 0 ? round((ttftSamples.reduce((sum, value) => sum + value, 0) / ttftSamples.length) * 1000) : null,
      compactions: taskUsage.filter((row) => row.task === "compression").reduce((sum, row) => sum + row.apiCallCount, 0),
      stalls: null,
      models,
    };
  });

  const trends = new Map<string, { bucket: string; costUsd: number; inputTokens: number; outputTokens: number; completedTasks: number }>();
  for (const usage of modelUsage) {
    const session = sessionById.get(fleetSessionKey(usage));
    if (!session) continue;
    const bucket = bucketDate(new Date(session.startedAt * 1000), input.grain);
    const row = trends.get(bucket) ?? { bucket, costUsd: 0, inputTokens: 0, outputTokens: 0, completedTasks: 0 };
    row.costUsd += usdToDashboardCost(usage) ?? 0;
    row.inputTokens += usage.inputTokens;
    row.outputTokens += usage.outputTokens;
    trends.set(bucket, row);
  }
  for (const task of taskMap.values()) {
    if (task.completionState !== "succeeded" && task.completionState !== "done") continue;
    // Bucket by the task's earliest session, not an arbitrary (sorted-first) id.
    let earliest: HermesSessionUsage | undefined;
    for (const key of task.sessionIds) {
      const session = sessionById.get(key);
      if (session && (!earliest || session.startedAt < earliest.startedAt)) earliest = session;
    }
    if (!earliest) continue;
    const bucket = bucketDate(new Date(earliest.startedAt * 1000), input.grain);
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
    const modelKey = modelAggregationKey(row);
    const calls = callsByModelKey.get(modelKey) ?? [];
    // AUTONOMOUS GAP-FILL C — mixed coverage contract (flagged in the PR body
    // and revision-3 artifact). Ambiguous omitted calls are counted per model
    // identity; they never discard this identity's uniquely attributable
    // samples from other sessions:
    //   available:   one or more unique samples, zero ambiguous omitted calls
    //   partial:     one or more unique samples and one or more ambiguous
    //                omitted calls — latency/TTFT/throughput/turns are computed
    //                from unique samples only and visibly labeled partial
    //   ambiguous:   zero unique samples and one or more ambiguous candidate
    //                calls — speed values, sample count, and turns stay null,
    //                never zero and never duplicated across split rows
    //   unavailable: neither unique nor ambiguous samples
    const ambiguousOmitted = ambiguousOmittedCallsByModelKey.get(modelKey) ?? 0;
    const speedAvailability =
      calls.length > 0 && ambiguousOmitted === 0 ? "available" as const
      : calls.length > 0 ? "partial" as const
      : ambiguousOmitted > 0 ? "ambiguous" as const
      : "unavailable" as const;
    const durationMs = calls.reduce((sum, call) => sum + call.apiDuration * 1000, 0);
    // Same-population throughput: numerator is the sum of outputTokens from
    // the exact uniquely attributed calls; denominator is those same calls'
    // duration. The row's state.db usage output tokens never enter sampled
    // throughput.
    const sampledOutputTokens = calls.reduce((sum, call) => sum + call.outputTokens, 0);
    const ttftSamples = calls.map((call) => call.ttft).filter((value): value is number => value !== null);
    const completedTasks = matchingTaskRows.filter((task) => task.completionState === "succeeded" || task.completionState === "done").length;
    const wallClockSamples = matchingTaskRows.map((task) => task.wallClockMs).filter((value): value is number => value !== null);
    const modelCostUsd = row.actualCostUsd ?? row.estimatedCostUsd;
    const costPerCompletedTaskUsd = completedTasks > 0 ? modelCostUsd / completedTasks : null;
    return {
      ...row,
      estimatedCostUsd: round(row.estimatedCostUsd),
      actualCostUsd: row.actualCostUsd === null ? null : round(row.actualCostUsd),
      speedSampleApiCalls: speedAvailability === "ambiguous" ? null : calls.length,
      speedAmbiguousOmittedApiCalls: ambiguousOmitted,
      speedAvailability,
      avgLatencyMs: calls.length > 0 ? round(durationMs / calls.length) : null,
      avgTtftMs: ttftSamples.length > 0 ? round((ttftSamples.reduce((sum, value) => sum + value, 0) / ttftSamples.length) * 1000) : null,
      throughputOutputTokensPerSecond: durationMs > 0 ? round(sampledOutputTokens / (durationMs / 1000)) : null,
      completedTasks,
      costPerCompletedTaskUsd: costPerCompletedTaskUsd === null ? null : round(costPerCompletedTaskUsd),
      avgTaskWallClockMs: wallClockSamples.length > 0
        ? round(wallClockSamples.reduce((sum, value) => sum + value, 0) / wallClockSamples.length)
        : null,
      // Turns come only from calls uniquely attributed to this identity; the
      // identity's own compactions were folded from its compression usage
      // rows during accumulation. Whole-task totals are never copied here.
      turns: calls.length > 0 ? new Set(calls.map((call) => call.turnId)).size : null,
      compactions: row.compactions,
      stalls: null,
      stallsAvailability: "unavailable" as const,
      boxes: [...(row.boxes as Set<string>)].sort(),
    };
  });

  // Global availability is derived from what rows actually render, never
  // from raw sidecar presence: if every model row is ambiguous or has no
  // attributed samples, model speed is globally unavailable even when
  // observed calls exist. The task surface is reported independently.
  const speedAvailabilityOf = (rows: Array<{ avgLatencyMs: number | null; avgTtftMs: number | null; throughputOutputTokensPerSecond: number | null }>) => ({
    avgLatencyMs: rows.some((row) => row.avgLatencyMs !== null) ? "available" as const : "unavailable" as const,
    avgTtftMs: rows.some((row) => row.avgTtftMs !== null) ? "available" as const : "unavailable" as const,
    throughputOutputTokensPerSecond: rows.some((row) => row.throughputOutputTokensPerSecond !== null) ? "available" as const : "unavailable" as const,
  });

  return {
    companyId: input.companyId,
    grain: input.grain,
    filters: input.filters ?? {},
    freshness: input.freshness,
    sources: input.sources ?? [],
    availability: {
      modelSpeed: speedAvailabilityOf(modelRows),
      taskSpeed: speedAvailabilityOf(taskRows),
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
          boxId: fleetItemBoxId(session),
          startedAt: session.startedAt >= 1_000_000_000 ? new Date(session.startedAt * 1000).toISOString() : null,
          billingMode: session.billingMode,
          costStatus: session.costStatus,
          estimatedCostUsd: session.estimatedCostUsd,
          actualCostUsd: session.actualCostUsd,
        })),
      ...input.usage.modelUsage
        .filter((usage) => !sessionById.has(fleetSessionKey(usage)) && !attributionBySession.has(usage.sessionId))
        .map((usage) => ({
          sessionId: usage.sessionId,
          boxId: fleetItemBoxId(usage),
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
  // One issue activity per run; joining raw activity_log fans out to every
  // issue activity row for the run and makes attribution non-deterministic.
  const runIssueLinks = db
    .selectDistinctOn([activityLog.runId], {
      runId: activityLog.runId,
      entityId: activityLog.entityId,
    })
    .from(activityLog)
    .where(and(eq(activityLog.companyId, companyId), eq(activityLog.entityType, "issue"), isNotNull(activityLog.runId)))
    .orderBy(activityLog.runId, desc(activityLog.createdAt))
    .as("run_issue_links");

  // context.issueId may be a non-UUID string (e.g. an external identifier); a
  // raw ::uuid cast would hard-fail the whole query, so guard it.
  const issueRef = sql`coalesce(${heartbeatRuns.contextSnapshot} ->> 'issueId', ${runIssueLinks.entityId})`;
  const issueRefAsUuid = sql<string>`case when ${issueRef} ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then ${issueRef}::uuid else null end`;

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
      issueId: issues.id,
      issueIdentifier: issues.identifier,
      issueTitle: issues.title,
      projectId: projects.id,
      projectName: projects.name,
    })
    .from(heartbeatRuns)
    .leftJoin(agents, and(eq(agents.companyId, companyId), eq(agents.id, heartbeatRuns.agentId)))
    .leftJoin(runIssueLinks, eq(runIssueLinks.runId, heartbeatRuns.id))
    .leftJoin(
      issues,
      and(
        eq(issues.companyId, companyId),
        eq(issues.id, issueRefAsUuid),
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
      // Only the company-scoped join result may be surfaced. Raw context or
      // activity references that fail the scoped join (cross-company,
      // missing, non-UUID, or stale) stay unattributed and are never echoed.
      issueId: row.issueId ?? null,
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

function stampBoxIdOnSnapshot(snapshot: HermesUsageSnapshot, boxId: string): HermesUsageSnapshot {
  return {
    sessions: snapshot.sessions.map((session) => ({ ...session, boxId })),
    modelUsage: snapshot.modelUsage.map((usage) => ({ ...usage, boxId })),
  };
}

function stampBoxIdOnCalls(calls: HermesApiCall[], boxId: string): HermesApiCall[] {
  return calls.map((call) => ({ ...call, boxId }));
}

function collectLocalHermesBox(boxId: string): FleetBoxCollection {
  const stateDbPath = defaultHermesStateDbPath();
  const sidecarDbPath = defaultHermesSidecarPath();
  const observedAt = new Date().toISOString();
  const base = { boxId, collectorId: "hermes-local", profileId: null, kind: "hermes-local" as const };
  if (!existsSync(stateDbPath)) {
    const detail = `Hermes state database not configured or missing: ${stateDbPath}`;
    return {
      report: { ...base, status: "unavailable", observedAt: null, checkpoint: null, errors: [detail], detail },
      usage: { sessions: [], modelUsage: [] },
      apiCalls: [],
    };
  }
  try {
    const usage = stampBoxIdOnSnapshot(readHermesSessionUsage(stateDbPath), boxId);
    // Per-call speed telemetry degrades to empty + an explicit error instead of
    // taking the whole local source down: aggregate usage still returns.
    const errors: string[] = [];
    let apiCalls: HermesApiCall[] = [];
    try {
      apiCalls = stampBoxIdOnCalls(readHermesApiCalls(sidecarDbPath), boxId);
    } catch (error) {
      errors.push(`Hermes telemetry sidecar unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
    return {
      report: {
        ...base,
        status: "ok",
        observedAt,
        checkpoint: { sequence: Date.now(), cursor: stateDbPath },
        errors,
        detail: null,
      },
      usage,
      apiCalls,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      report: { ...base, status: "unavailable", observedAt: null, checkpoint: null, errors: [detail], detail },
      usage: { sessions: [], modelUsage: [] },
      apiCalls: [],
    };
  }
}

/**
 * Cross-box fleet dashboard: collects every configured source (Mac-local
 * Hermes DBs plus the Windows staged-envelope adapter), normalizes each into
 * the same box-stamped snapshot shape, and aggregates them together.
 * Partial-source behavior is explicit: a failed or unconfigured source is
 * listed in `sources` (and, when a configured source failed, in
 * `freshness.errors`) while healthy sources still return real data. If no
 * source produced data at all, the endpoint fails closed with 503 rather than
 * presenting an empty dashboard as success.
 */
export async function buildFleetCostDashboard(
  db: Db,
  companyId: string,
  query: FleetDashboardQuery = {},
  options: { includeCrossBox?: boolean } = {},
): Promise<FleetCostDashboardPayload> {
  const collectorCompanyId = process.env.HERMES_COST_COMPANY_ID;
  if (!collectorCompanyId) {
    throw serviceUnavailable("HERMES_COST_COMPANY_ID is required for local Hermes cost collection");
  }
  if (collectorCompanyId !== companyId) {
    throw serviceUnavailable("Local Hermes collector company binding does not match requested company");
  }
  const includeCrossBox = options.includeCrossBox ?? true;
  const localBoxId = process.env.HERMES_COST_BOX_ID ?? DEFAULT_FLEET_BOX_ID;

  const sources: FleetSourceReport[] = [];
  const freshnessErrors: string[] = [];
  const boxes: FleetBoxCollection[] = [];

  const local = collectLocalHermesBox(localBoxId);
  sources.push(local.report);
  if (local.report.status === "ok") boxes.push(local);
  freshnessErrors.push(...local.report.errors.map((error) => `[${local.report.boxId}] ${error}`));

  if (includeCrossBox) {
    const windows = collectWindowsEnvelopeBox(process.env.HERMES_COST_WINDOWS_ENVELOPE_PATH ?? null);
    sources.push(windows.report);
    if (windows.report.status === "ok") boxes.push(windows);
    if (windows.report.status !== "not-configured") {
      freshnessErrors.push(...windows.report.errors.map((error) => `[${windows.report.boxId}] ${error}`));
    }
  }

  if (boxes.length === 0) {
    const detail = freshnessErrors.length > 0
      ? freshnessErrors.join("; ")
      : "No fleet observation sources produced data";
    throw serviceUnavailable(detail);
  }

  const attributions = await loadHermesRunAttributions(db, companyId);
  const observedAt = new Date().toISOString();
  const singleSourceCheckpoint = boxes.length === 1 ? boxes[0].report.checkpoint : null;
  return aggregateFleetCostDashboard({
    companyId,
    range: query.range,
    filters: query.filters,
    grain: query.grain ?? "day",
    usage: {
      sessions: boxes.flatMap((box) => box.usage.sessions),
      modelUsage: boxes.flatMap((box) => box.usage.modelUsage),
    },
    apiCalls: boxes.flatMap((box) => box.apiCalls),
    attributions,
    sources,
    freshness: {
      observedAt,
      checkpoint: singleSourceCheckpoint,
      errors: freshnessErrors,
    },
  });
}

export async function buildLocalFleetCostDashboard(db: Db, companyId: string, query: FleetDashboardQuery = {}) {
  return buildFleetCostDashboard(db, companyId, query, { includeCrossBox: false });
}
