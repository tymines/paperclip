# Cost Dashboard — cross-box continuation (2026-07-27)

**Status:** implementation-authoritative for the cross-box slice on this branch
**Base:** `fork/master` at `a9c18bd17` (PR #27 rebased)
**Prior packet:** `doc/plans/2026-07-26-cost-dashboard-v1-mac.md`

## Scope

Continue PR #27: rebase onto current `fork/master`, then finish the cross-box
cost/speed aggregation with Mac and Windows collection layers per
`cost-dashboard-build-spec-v1.md` §4 (shared collection layer) and §5
(attribution), without touching the Windows box.

## Hard constraints

- Windows is zero-footprint: no probes, no SSH, no API calls, no mutation. The
  Windows adapter is built and tested against fixtures/contracts only.
- Company scoping, board/agent auth, fail-closed company binding, and error
  reporting are preserved.
- Graceful partial-source behavior: a failed or unconfigured source is explicit
  in `sources` / `freshness.errors`; healthy sources still return real data; if
  nothing produced data the endpoint still fails closed (503).
- No fake live data; no silent fallback presented as success.
- Replay idempotency and fail-loud schema incompatibility are enforced on the
  ingest/normalization boundary.

## Design

- `fleet-observation/v1` envelope is the single box-neutral contract.
- Windows adapter = staged envelope JSON file (`HERMES_COST_WINDOWS_ENVELOPE_PATH`),
  validated structurally, normalized into the same snapshot shape as the Mac
  collector, every item stamped with its source `boxId`.
- Aggregation keys sessions by `(boxId, sessionId)`; model/task rows merge
  across boxes and carry sorted `boxes`; unattributed sessions carry `boxId`;
  box-qualified session ids only when two boxes report the same id.
- Endpoint payload gains `sources[]` (`ok` / `unavailable` / `not-configured`,
  observedAt, checkpoint, errors, detail). UI renders source chips and box
  labels.

## Verification

See `doc/evidence/2026-07-27-cost-dashboard-cross-box-qa.md`.
