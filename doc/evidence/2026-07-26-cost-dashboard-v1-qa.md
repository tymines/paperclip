# Cost Dashboard v1 — QA Evidence

**Date:** 2026-07-26
**Branch:** `feat/cost-dashboard-v1-mac`
**Feature verdict:** PASS
**Repository-wide suite verdict:** NO_VERDICT (base branch is already red; signatures documented below)
**UI screenshot verdict:** NO_VERDICT (linked-worktree runtime prerequisite absent)

## Artifacts

- Collection design: `doc/design/cost-gym-collection-layer-v1.md`
- Implementation packet / dispatch ledger: `doc/plans/2026-07-26-cost-dashboard-v1-mac.md`
- Mac reference plugin: `integrations/hermes-cost-telemetry/`
- Collector/attribution/aggregation: `server/src/services/fleet-cost-dashboard.ts`
- Dashboard scaffold: `ui/src/components/FleetCostDashboardPanel.tsx` and `ui/src/pages/Costs.tsx`

## Preserved prior worktree

The prior implementation was not modified:

- worktree: local preserved worktree; identify by branch and HEAD below
- branch: `feat/cost-dashboard-phase12-hermes-local`
- HEAD: `ccf86248535dc354824d136869656c8ff4cf5c75`
- status: clean
- `server/src/services/hermes-cost-performance.ts` SHA-256: `05e5b4cd341296ef63d972b67725894c2c85ae7947d6f259ba69609c2fd258c9`
- `integrations/hermes-cost-telemetry/__init__.py` SHA-256: `ac57f5a73bcecb0110c8dbc806424aa06771e56efbaf1da09cbf67f5458a45a6`

## TDD / review evidence

Initial RED evidence showed the collector/service, route, and plugin were missing. Cold review then returned FAIL on company scoping, fail-loud behavior, sidecar path consistency, missing trend/speed presentation, estimated-vs-actual labeling, and pricing-source grouping. A corrective commit added non-vacuous route/service/UI/plugin coverage.

Final cold re-review found one remaining behavior bug: model cost per completed task used estimated cost even when actual metered cost existed. A focused test failed with:

```text
Expected costPerCompletedTaskUsd: 0.25
Received costPerCompletedTaskUsd: 0.1
```

After changing the calculation to prefer `actualCostUsd` and fall back to estimate, the focused service/UI run passed 8/8.

## Current-head passing evidence

### Python plugin

```sh
python3 -m unittest -v integrations/hermes-cost-telemetry/test_plugin.py
```

Result: PASS — 4/4.

Covers supported hook registration, stable identity requirement, idempotent speed/TTFT persistence, and shared `HERMES_COST_TELEMETRY_DB_PATH` override.

### Fleet service + UI component

```sh
pnpm exec vitest run \
  server/src/services/fleet-cost-dashboard.test.ts \
  ui/src/components/FleetCostDashboardPanel.test.tsx
```

Result: PASS — 8/8.

Covers billing NULL-vs-included semantics, incompatible schema failure, source/version-separated model rows, observation replay idempotency, exact full session IDs, unattributed visibility under a bound company, actual cost per completed task, and rendered trend/cost/speed/availability labels.

### Company-bound endpoint and fail-closed collector

```sh
pnpm exec vitest run server/src/__tests__/costs-service.test.ts \
  -t 'fleet dashboard|local Hermes collector'
```

Result: PASS — 5/5 selected tests (17 unrelated tests skipped by name filter).

Covers combined company-scoped filters, missing/mismatched collector company binding, missing state DB, incompatible state schema, and HTTP 503 behavior.

### Scoped typechecks

```sh
pnpm --filter @paperclipai/shared typecheck
pnpm --filter @paperclipai/server typecheck
pnpm --filter @paperclipai/ui typecheck
```

Result: PASS.

### Production build

```sh
pnpm build
```

Result: PASS across the workspace, including server and Vite UI production bundles. Existing Vite chunk-size/dynamic-import warnings remain warnings only.

### Diff hygiene

```sh
git diff fork/master...HEAD --check
git status --porcelain
```

Result: PASS / clean before this evidence document was added. Secret-pattern scan returned no matches. Generated `.serena/` and `.rail_events.jsonl` artifacts were excluded/reverted.

## Repository-wide inherited failures

### `pnpm test:run`

Current result: FAIL — `34 failed | 155 passed` test files; `202 failed | 1250 passed | 1 skipped` tests. Stable runner confirmed zero attached Vitest/Tinypool survivors.

Observed inherited signatures include:

- test DB/schema drift around missing `issues.iteration_count` (Postgres `42703`), cascading into transaction-aborted failures;
- `server-startup-feedback-export.test.ts`: mocked server lacks `.on()`;
- `story-bible-generate.test.ts`: expected `draft.chapterNumber === 1`, received `undefined`.

The exact `issues.iteration_count` failures in `costs-service.test.ts` were reproduced on detached clean `fork/master` at `3224285a8`; the feature-specific tests in that file pass.

### `pnpm -r typecheck`

Current result: FAIL in unchanged `packages/plugins/plugin-llm-wiki/tests/plugin.spec.ts`:

- optional `iterationCount` fixture incompatible with required `number`;
- `IssueComment` fixtures missing `authorName` and `resolvedAuthorName`.

Scoped packages modified by this feature all typecheck successfully.

## UI screenshot blocker

An isolated dev launch used `/tmp/cost-dashboard-qa-home`, not the live fleet database. The repository dev runner stopped with:

```text
linked git worktree ... is missing .paperclip/.env.
Run `paperclipai worktree init` in this worktree before `pnpm dev`.
```

No runtime configuration was initialized merely to manufacture a screenshot. Automated component rendering is green; manual screenshot evidence remains NO_VERDICT.

## Deferred scope

- Cross-box transport/aggregation for Windows and Ares boxes
- Phase 4 alerting and provider balance thresholds
- Real stall-event measurement (explicitly unavailable/null in v1)
- Runtime screenshot once a review worktree has normal `.paperclip/.env` initialization
