# Cost Dashboard v1 — Mac-isolated implementation packet

**Status:** implementation-authoritative for this branch
**Base:** `fork/master` at `3224285a8`
**Preserved prior work:** `/Users/augi/paperclip-worktrees/cost-dashboard-phase12`, branch `feat/cost-dashboard-phase12-hermes-local`, commit `ccf862485` (must remain untouched)

## Dispatch ledger

One coherent coder lane is justified because this is not solo-sized: the feature crosses a supported Hermes extension, a generic fleet collection contract intended for both Cost and Gym, persistence/attribution, server API, shared contracts, UI, documentation, and multi-layer QA. Splitting writers would create overlapping schema/API contracts. A cold independent review follows only after pushed + green.

## Controlling requirements

Cost tracking is a Paperclip feature. Hermes already persists usage in profile-local `state.db` tables `sessions` and `session_model_usage`. The implementation must ingest and expose cost + speed by project, task/card, time (day/week/month trend), agent, and model, including combined filters. Speed signals: task wall clock, turns/iterations, throughput, latency/TTFT when available, compaction/stall events, and cost per completed task. The model decision surface must compare cost and speed together.

Billing semantics are mandatory: subscription-included usage currently has `billing_mode=subscription_included`, `estimated_cost_usd=0`, `actual_cost_usd=NULL`, `cost_status=included`, and `cost_source=none`. Never coerce unknown/NULL actual cost into metered zero. Preserve billing mode, cost status/source, and pricing version.

No Hermes harness source patches. Read durable state or use a supported user-plugin hook. Cross-box wiring is out of scope until Windows and Ares boxes return, but the protocol must be box-neutral and reusable for both Cost and Gym.

Attribution chain: `usage -> full Hermes session_id -> Paperclip heartbeat run_id -> issue_id -> project_id`. Existing runs expose full Hermes `session_id` in `heartbeat_runs.result_json.session_id`; issue attribution can come from `heartbeat_runs.context_snapshot.issueId` and/or run-linked activity, with issue.projectId as the project join. The supported plugin may additionally capture `PAPERCLIP_RUN_ID` per API request. Never join on the 16-character display session id.

## Prior branch audit

Reusable:
- supported `post_api_request` user plugin; sidecar SQLite; idempotent `(session_id, api_request_id)` key
- read-only `state.db` access and per-call speed sidecar
- exact full-session join guard and tests

Must be corrected/completed:
- prior reader drops `billing_mode`, `cost_status`, `cost_source`, and `pricing_version`
- prior model usage coerces nullable actual cost to `0`
- attribution only gets issue/project through `cost_events`; it must resolve run context/activity even without a pre-existing cost event
- no generic Cost+Gym collection envelope, checkpoint/freshness contract, or ingest boundary
- no Paperclip endpoint wired for the telemetry view
- no dashboard scaffold for combined cost × speed comparison, trends, task/project/agent/model grains, or freshness/unattributed state
- no latency/TTFT or stall representation; unsupported measurements must be explicit `null`/unavailable rather than fabricated

## Required build, strict TDD

1. Write failing tests first and record RED output before each production slice.
2. Port/adapt the supported plugin and read-only Mac collector from `ccf862485`, preserving prior branch untouched.
3. Define a versioned, generic fleet observation envelope usable by both Cost and Gym. Include stable source identity (`boxId`, profile/collector), observation IDs, schema version, observed time, sequence/checkpoint, payload kind, payload, and explicit freshness/errors. Ensure replay idempotency and fail-loud schema incompatibility. Implement only the local Mac reference source/ingest path; no remote host calls.
4. Preserve billing semantics and nullable actual cost from Hermes tables. Tolerate WAL/live reads and fail loudly on incompatible schema.
5. Implement exact session-to-run attribution, issue resolution from run context/activity, and project resolution from issue. Surface unattributed sessions instead of dropping them.
6. Expose a company-scoped read endpoint/query accepting date range plus optional project/issue/agent/model filters and grain (`day|week|month`). Return trends and task/model comparison rows with cost, cost status, tokens, wall clock, turns, throughput, per-call latency/TTFT when available, compactions, stalls when available, completion state, and cost per completed task. Unsupported metrics are `null` with availability metadata.
7. Add a bounded dashboard scaffold to the existing Costs page (or a focused child component): combined filters, freshness/unattributed warning, trend, and model/task comparison table. Reuse existing design system and cost views; do not redesign unrelated tabs. Must visibly distinguish Included / Metered / Unknown cost semantics.
8. Add `doc/design/cost-gym-collection-layer-v1.md` documenting topology, envelope, idempotency/checkpoints, security, restart/update survival, attribution, freshness, and deferred cross-box transport. Add collector usage docs.
9. No secrets, no provider-balance expansion, no alerting implementation (Phase 4), no cross-box probes, no Windows calls, no harness patch.
10. Run targeted tests, Python plugin tests, `pnpm -r typecheck`, `pnpm test:run`, and `pnpm build`. Quarantine Book Studio writer side effects with `BOOK_STUDIO_VAULT_ROOT=/tmp/book-studio-vault-quarantine` for broad Vitest runs.
11. Commit all intended files with a conventional commit. Do not push or open a PR; boss handles integration/review/push.

## Mechanical acceptance criteria

- prior worktree remains byte/commit unchanged and clean
- test evidence proves NULL actual cost + subscription-included zero remain distinguishable
- replayed observations cannot duplicate usage
- malformed/incompatible source produces nonzero/fail-loud behavior, never an empty successful collection
- exact full session IDs attribute to runs; prefix collisions do not
- runs without cost events still resolve issue/project from run context/activity
- unattributed data appears explicitly
- endpoint enforces company scope and combined filters
- UI renders cost and speed together and labels metric availability/freshness
- no harness source or remote-box touch
- focused tests, typecheck, full test, and build pass
