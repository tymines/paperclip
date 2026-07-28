# 2026-07-27 — Cost dashboard cross-box QA evidence

Branch: `feat/cost-dashboard-v1-mac` (PR #27), rebased onto `fork/master` `a9c18bd17`.
Scope: cross-box fleet cost/speed aggregation — Mac-local collector plus
zero-footprint Windows envelope adapter — per `cost-dashboard-build-spec-v1.md`
and `doc/plans/2026-07-27-cost-dashboard-cross-box.md`.

All commands run with `BOOK_STUDIO_VAULT_ROOT=/tmp/book-studio-vault-quarantine`
(the Book Studio default vault path is not part of this packet).

## Rebase

- `git fetch fork master` → `git rebase fork/master`: clean, zero conflicts.
- Overlap check before rebasing: zero files shared between branch changes and
  master's post-merge-base changes (`comm -12` empty).

## Focused suites (all real, all passing)

| Suite | Result |
| --- | --- |
| `server/src/services/fleet-cross-box.test.ts` (new) | 9/9 pass |
| `server/src/services/fleet-cost-dashboard.test.ts` | 7/7 pass |
| `server/src/__tests__/costs-service.test.ts` | 22/22 pass |
| `ui/src/components/FleetCostDashboardPanel.test.tsx` | 1/1 pass |
| `python3 -m unittest integrations/hermes-cost-telemetry/test_plugin.py` | 5/5 OK |

Cross-box coverage (`fleet-cross-box.test.ts`, fixtures in
`server/src/services/__fixtures__/fleet-observation-windows-box.json`):

- Windows envelope normalization preserves billing semantics
  (`subscription_included` actual=NULL vs metered `actual`), stamps `boxId` on
  every session/model/call row.
- Fail-loud envelope validation: unsupported schema version, missing source
  identity, unknown payloadKind, non-object envelope all raise
  `FleetObservationEnvelopeError` — never an empty "success".
- Replay idempotency: second normalization of the same envelope inserts 0,
  skips 8 — cross-box usage cannot double count.
- Source statuses: `not-configured` (env unset, no fabricated error),
  `unavailable` (missing/malformed/wrong-schema file, real error surfaced),
  `ok` (fixture parses with source identity and checkpoint).
- Cross-box merge: same model on both boxes merges into one row tagged
  `boxes: [box-2-windows, mac-local]`; one task row spans both boxes with
  summed cost/tokens and wall clock across both runs; identical session ids on
  different boxes stay distinct (`boxId:sessionId` qualification); trends sum
  correctly; no double counting.
- Orchestration: Mac + Windows sources reported per-source; Windows failure
  still returns Mac data with `[windows-box]`-prefixed `freshness.errors`;
  unconfigured Windows lists as `not-configured` with empty errors; all-sources
  -failed fails closed (503-shaped `serviceUnavailable`).

## Gates

| Gate | Result |
| --- | --- |
| `pnpm --filter @paperclipai/shared typecheck` | pass |
| `pnpm --filter @paperclipai/server typecheck` | pass |
| `pnpm --filter @paperclipai/ui typecheck` | pass |
| `pnpm build` (full) | pass |
| `pnpm test:run` (full suite, branch) | 6 failed files / 11 failed tests — **identical set on clean `fork/master` baseline** (gym, jarvis-delegation, plugin-secrets-handler, reddit-adapter, server-startup-feedback-export, story-bible-generate); zero regressions introduced; none cost/dashboard related |

Baseline method: full `pnpm test:run` on the branch, then `git stash -u`, full
`pnpm test:run` on the rebased base, `git stash pop`, diff of failing-file
lists → identical.

## Review feedback addressed (CodeRabbit on PR #27)

- Plugin telemetry failures can no longer propagate into the Hermes agent run
  (hook failure-isolated; regression test added).
- Sidecar read failure degrades to empty per-call telemetry + explicit error
  instead of an unmapped 500; aggregate usage still returns (design contract).
- Route maps only collector failures / status-carrying errors to 503; other
  errors propagate instead of being mislabeled.
- Route reuses `FleetCostDashboardGrain` from `@paperclipai/shared` (no
  duplicate enum).
- Attribution join deduplicated to one issue activity per run
  (`selectDistinctOn`, mirroring `costService.byProject`) and the issue-id
  `::uuid` cast is guarded against non-UUID context values.
- Completed-task trend bucket uses the task's earliest session, not the
  sorted-first session id.
- Range-filter test fixture uses realistic epoch timestamps (the old
  `started_at = 100` made the range assertion inert).
- UI: `+N more` indicators on truncated task/model lists; fleet dashboard query
  error state renders an explicit error instead of "loading" forever; evidence
  doc no longer carries a machine-local absolute path.

## Residual items

- Model-row speed metrics: per-call sidecar rows carry only provider+model, so
  when one provider+model spans two billing identities, latency/TTFT/throughput
  are computed over the same call set for each billing row. Needs a sidecar
  schema extension to partition by billing identity (deferred, heavy lift).
- Windows transport (agent push / authenticated polling / file sync) remains
  deferred; the adapter consumes a staged `fleet-observation/v1` envelope file
  and never contacts the Windows box.
