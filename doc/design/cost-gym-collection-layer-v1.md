# Cost + Gym Collection Layer v1

Status: V1 local Mac reference path.

## Topology

Paperclip reads local fleet observations through a box-neutral envelope. The first source is the Mac-local Hermes collector:

- Hermes `state.db`: read-only source for session and model aggregate usage.
- Hermes user plugin: supported `post_api_request` hook that writes per-call speed samples to a sidecar SQLite database.
- Paperclip server: reads both local databases and exposes `/api/companies/:companyId/costs/fleet-dashboard`.
- Costs UI: renders combined cost, speed, freshness, and unattributed-session state.

No remote host calls are part of v1. Windows, Ares, and any future machines should publish the same envelope shape through a later transport.

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

The Hermes plugin sidecar uses `(session_id, api_request_id)` as its primary key and inserts with first-writer-wins semantics. Paperclip’s generic ingest helper also deduplicates by `observationId`.

Checkpoints are source-owned. The Mac collector currently uses a timestamp-backed sequence and state-db path cursor for the server response. A future cross-box sender should persist stronger cursors per source and replay from the last acknowledged checkpoint.

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

## Freshness And Availability

Collector failures are returned in `freshness.errors`. Missing per-call sidecar data makes latency and TTFT unavailable; the API returns `null` metrics with `availability` metadata. Stall signals are reserved and currently reported as unavailable rather than fabricated.

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

Cross-box transport, authentication between boxes, durable sender queues, and Windows/Ares probes are deferred. Future transports should submit the same `fleet-observation/v1` envelope and preserve the same idempotency, freshness, and fail-loud compatibility rules.
