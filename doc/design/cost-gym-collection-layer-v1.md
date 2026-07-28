# Cost + Gym Collection Layer v1

Status: V1 Mac reference path plus the zero-footprint Windows envelope adapter (cross-box aggregation live, transport deferred).

## Topology

Paperclip reads fleet observations through a box-neutral envelope. Two collection sources exist:

- **Mac-local collector (`hermes-local`)**: read-only Hermes `state.db` for session/model aggregate usage plus the user-plugin sidecar SQLite for per-call speed samples.
- **Windows envelope adapter (`hermes-windows-envelope`)**: consumes a staged `fleet-observation/v1` JSON envelope published by the Windows box. The adapter is zero-footprint toward Windows: no probes, no SSH, no API calls, no mutation of the Windows box. Its contract boundary is the envelope file itself; it is validated and tested against fixtures only.
- Paperclip server: collects every configured source, normalizes each into the same box-stamped snapshot shape, aggregates across boxes, and exposes `/api/companies/:companyId/costs/fleet-dashboard`.
- Costs UI: renders combined cost, speed, per-source status, freshness, and unattributed-session state.

Every configured source is listed in the payload's `sources` array with status `ok`, `unavailable`, or `not-configured` and a human-readable `detail`. A failed configured source contributes prefixed entries to `freshness.errors` while healthy sources still return real data (graceful partial-source behavior). If no source produces data, the endpoint fails closed with HTTP 503 rather than presenting an empty dashboard as success.

## Envelope

Every observation is wrapped with:

- `schemaVersion`: currently `fleet-observation/v1`
- `source`: `boxId`, `collectorId`, and optional profile id
- `observationId`: stable id used for replay idempotency
- `observedAt`: collector observation time
- `checkpoint`: monotonically useful sequence plus optional cursor
- `payloadKind`: `cost.usage.session`, `cost.usage.model`, or `cost.speed.api_call`
- `payload`: typed observation data
- `freshness.errors`: explicit collector errors

Consumers must fail loudly on unsupported schema versions. They must not turn incompatible payloads into empty successful collections.

## Idempotency And Checkpoints

The Hermes plugin sidecar uses `(session_id, api_request_id)` as its primary key and inserts with first-writer-wins semantics. Paperclip’s generic ingest helper also deduplicates by `observationId`; envelope normalization only yields observations that were not already present in the ingest store, so replaying a staged envelope never double-counts usage.

Checkpoints are source-owned. The Mac collector currently uses a timestamp-backed sequence and state-db path cursor for the server response. The Windows adapter echoes the checkpoint published inside the staged envelope. A future cross-box sender should persist stronger cursors per source and replay from the last acknowledged checkpoint.

## Cross-Box Identity

Normalized observations are stamped with their source `boxId`. Aggregation keys sessions by `(boxId, sessionId)` so identical session ids reported by two boxes never merge or dedupe against each other; when a task row contains the same session id from multiple boxes, the id is displayed box-qualified (`boxId:sessionId`). Model and task rows carry the sorted list of contributing `boxes`, and `unattributedSessions` carry their `boxId`. Hermes session ids are globally unique in practice, so the Paperclip run attribution join remains keyed on the bare full session id.

## Billing Semantics

Hermes subscription-included usage remains distinct from metered zero:

- `billing_mode=subscription_included`
- `estimated_cost_usd=0`
- `actual_cost_usd=NULL`
- `cost_status=included`
- `cost_source=none`
- `pricing_version` preserved

Paperclip never coerces nullable actual cost into `0`. Unknown actual cost remains `null`; included zero remains a labeled included estimate.

## Attribution

The attribution chain is:

```text
Hermes usage session_id
  -> heartbeat_runs.result_json.session_id
  -> heartbeat_runs.context_snapshot.issueId or run-linked activity_log issue
  -> issues.project_id
```

Only the full Hermes `session_id` is used. The 16-character display id is ignored because prefix collisions are possible.

Sessions that cannot be attributed are returned in `unattributedSessions` instead of being dropped.

Run-level issue attribution (`loadHermesRunAttributions`) surfaces only the issue resolved by the company-scoped `issues` join. Raw `context_snapshot.issueId` or `activity_log.entityId` references that fail that scoped join — cross-company UUIDs, missing issues, non-UUID external identifiers, or stale links — leave the run unattributed (`issueId: null`) and are never echoed into the payload, so no cross-company id can leak through the dashboard.

## Freshness And Availability

Collector failures are returned in `freshness.errors`. Missing per-call sidecar data makes latency and TTFT unavailable; the API returns `null` metrics with `availability` metadata. Stall signals are reserved and currently reported as unavailable rather than fabricated.

### Call-count contract

Model rows report two explicitly sourced call counts; a bare ambiguous `apiCalls` figure no longer exists:

- `usageApiCalls: number` — sum of Hermes `state.db` `session_model_usage.api_call_count` for this exact billing/cost identity. This is the aggregate cost-usage telemetry source.
- `speedSampleApiCalls: number | null` — count of observed sidecar `api_calls` speed samples uniquely attributed to this exact billing/cost identity. `null` when ownership is ambiguous; exact (possibly `0`) otherwise.

The two may legitimately differ: they are different sources. UI and docs must never present them as interchangeable.

### Per-row speed availability

Each model row carries `speedAvailability`:

- `available` — at least one observed sidecar call is uniquely attributed to this identity; speed values, `speedSampleApiCalls`, and `turns` are exact.
- `unavailable` — no attributable observed calls; `speedSampleApiCalls` is `0` (exact), speed values and `turns` are `null`.
- `ambiguous` — one session reports multiple billing/cost identities for the same provider/model, so observed-call ownership cannot be determined without guessing. `speedSampleApiCalls`, speed values, and `turns` are `null`; nothing is fabricated or duplicated across the split rows.

Per-model `turns` is the count of distinct observed `turnId`s among calls uniquely attributed to that exact model identity — never the whole-task turn count. Per-model `compactions` is the sum of `api_call_count` over that identity's own `session_model_usage` rows with `task = "compression"` — exact per identity and never copied from another model or from task totals.

Global `availability` is derived from what rows actually render, never from raw sidecar presence:

- `availability.modelSpeed.{avgLatencyMs,avgTtftMs,throughputOutputTokensPerSecond}` — `available` only if at least one model row renders that metric. If every model row is ambiguous or has no attributed samples, model speed is globally `unavailable` even when observed calls exist.
- `availability.taskSpeed.*` — computed from each task's own observed calls and reported independently of model-row attribution ambiguity.
- `availability.stalls` — reserved; currently always `unavailable`.

### Envelope payload validation

`fleet-observation/v1` observations are validated completely per discriminated `payloadKind` (`cost.usage.session`, `cost.usage.model`, `cost.speed.api_call`) before ingest or dedupe: required ids/strings, timestamps, billing enum fields, nullable fields, finite numeric types, and nonnegative counts/durations/tokens, plus the observation wrapper (`observedAt`, `checkpoint`, `freshness`) and the box/source invariant (observation source must match the envelope source). Any missing, string, `NaN`/`Infinity`, negative, malformed, or wrong-kind field rejects the whole envelope with `FleetObservationEnvelopeError` identifying the observation, kind, and field. Nothing invalid enters the dedupe store and there is no partial normalization.

## Security

The v1 Mac collector reads only local files. It does not call remote boxes, provider APIs, or Hermes harness internals. The plugin writes under `$HERMES_HOME/cost-dashboard/telemetry.sqlite3` with private directory/file permissions where the OS allows it.

## Restart And Update Survival

Hermes aggregate state remains in Hermes-owned `state.db`. Per-call Paperclip telemetry is in a sidecar database outside harness source, so Hermes updates do not require source patches. Reinstalling or symlinking the user plugin after a Hermes profile rebuild restores per-call collection without changing Paperclip schema.

## Collector Usage

Set these environment variables only when defaults are not correct:

```sh
HERMES_HOME=~/.hermes
HERMES_STATE_DB_PATH=~/.hermes/state.db
HERMES_COST_TELEMETRY_DB_PATH=~/.hermes/cost-dashboard/telemetry.sqlite3
HERMES_COST_COMPANY_ID=<paperclip-company-id>
HERMES_COST_BOX_ID=mac-local
HERMES_COST_WINDOWS_ENVELOPE_PATH=<path to staged fleet-observation/v1 JSON from the Windows box>
```

`HERMES_COST_TELEMETRY_DB_PATH` is shared by the server and the Hermes user plugin; set it in both environments when using a custom sidecar location. `HERMES_COST_COMPANY_ID` is required for the local endpoint because Hermes `state.db` is global to the local profile. Paperclip fails closed with HTTP 503 when the binding is missing or does not match the requested company.

For Paperclip-launched Hermes runs, inject:

```sh
PAPERCLIP_RUN_ID=<heartbeat_run_id>
```

Install the user plugin from:

```text
integrations/hermes-cost-telemetry
```

The Paperclip endpoint remains company-scoped and supports `from`, `to`, `projectId`, `issueId`, `agentId`, `model`, and `grain=day|week|month`.

## Deferred Cross-Box Transport

Cross-box transport, authentication between boxes, and durable sender queues remain deferred. The Windows side of the contract is implemented as a zero-footprint adapter: the server reads a staged `fleet-observation/v1` envelope file and never contacts the Windows box. A later transport (agent push, authenticated polling, or file sync) only needs to deliver the same envelope shape; the normalization, idempotency, fail-loud compatibility, and cross-box aggregation rules are already enforced server-side and tested against fixtures (`server/src/services/__fixtures__/fleet-observation-windows-box.json`, `server/src/services/fleet-cross-box.test.ts`).
