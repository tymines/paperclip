# War Room "Team Mode" — Build Plan + Phase-1 Data Model

> Status: Phase 1 (data model) + Phase 2 (read-only vertical slice) landed on
> branch `team-mode-warroom-readonly` (off `restore/pre-acp-20260623` =
> `af1eca6af`). Additive only — nothing ripped out. Verified rendering in real
> Chrome against live Tyler Co data, console-clean.
> Source spec: `AionUi-to-Paperclip-feature-port-spec.md` (Team Mode row +
> mailbox/task-board schema). Pipeline reference:
> `PAPERCLIP-ARES-PIPELINE-PLAN.md` and `~/.openclaw agent-rooms-v1/orchestration.md`.

## 0. The model (leader-directed, not a chatroom)

```
Tyler ──chat──▶ Hermes (orchestrator / CoS)   ← plans, gets approval
                    │
                    ▼
                  Ares (COO / distributor)     ← directs each task DOWN
                    │  reportsTo traversal
        ┌───────────┼───────────┬───────────┐
     worker       worker       worker      worker     ← teammates (Ares' reports)
        └───── results funnel UP to Ares ──┘          ← Ares integrates → Hermes
```

The War Room gets a **Team Mode** view that surfaces this as a **task board**
(who's assigned what, status, dependencies) + a **directed leader↔worker message
view**, with results funnelling back to the leader. This is the AionUi "Team
Mode" (Leader → Teammates + mailbox + task board) reimplemented onto Paperclip's
existing Hermes→Ares→workers pipeline — **not** a free-for-all room.

## 1. Map to what already exists (real sources)

| Team-Mode concept | Existing Paperclip source (reused, real) |
|---|---|
| Assignment (worker + task) | `jarvis_delegations` row — `agent`, `task`, `requested_by_actor_id` |
| Status (transport lifecycle) | `jarvis_delegations.status` = queued / running / completed / failed |
| Result funnel-up (worker→leader) | `jarvis_delegations.result` (+ `/jarvis/delegations/:id/result` callback) |
| Directed task (leader→worker) | `jarvis_delegations.task` |
| Live "what is each worker doing now" | `POST /agent-bridge/telemetry` → `agents.status` + `metadata.currentTask` → `agent.status` WS event |
| Proof-of-work per turn | `POST /agent-bridge/work` → `agent.work` WS event (broadcast-only today) |
| Leader & team hierarchy | `agents.role` (`coo` = Ares), `agents.reportsTo` (workers → Ares → Hermes) |
| Read API for the board | `GET /companies/:id/jarvis/delegations` (already exists) + `GET /companies/:id/agents` |

`postTelemetry` / `postWork` in the brief map to the live `/agent-bridge/telemetry`
and `/agent-bridge/work` endpoints — those are the real dispatch/telemetry feeds
the board consumes (directly via WS today; persisted via the new run-log table
going forward).

## 2. Phase 1 — additive data model (migration `0131_team_mode.sql`)

Three additive changes. Nothing dropped; no backfill; every statement
`IF NOT EXISTS` and reversible by dropping the branch.

1. **`agent_operations`** (new) — the **AgentOperation run-log**. Durable
   persistence for the `agent.work` events that are *broadcast-only* today and
   vanish after they're sent. 1:1 mirror of the `/agent-bridge/work` payload
   (`agentId`, `roomId`, `turnId`, `kind`, `tool_name`, `mutated`, `artifact`,
   `outcome`) + optional `delegation_id` linking a turn to its assignment.
   Population is gated behind `TEAM_MODE_OPLOG=1` (OFF by default) so the live
   ingestion path is byte-for-byte unchanged until explicitly enabled.
2. **`team_task_dependencies`** (new) — the task-board **blocks / blocked-by**
   edge set (AionUi's dependency graph). Edges between real `jarvis_delegations`
   rows. Starts empty; the board honestly shows "no dependencies recorded" until
   the leader records edges.
3. **`jarvis_delegations`** + two **nullable** columns:
   - `worker_status` — the typed worker verdict (DONE / DONE_WITH_CONCERNS /
     NEEDS_CONTEXT / BLOCKED / FAILED). Distinct from the transport `status`.
   - `team_run_id` — groups one leader-directed fan-out batch.

   Both NULL on every existing row — flat/legacy delegations are unaffected.
   (Names intentionally distinct from the *proposed* Ares-pipeline columns
   `ares_dispatch_id` / `qc_status` so the two efforts don't collide.)

Drizzle schema added: `schema/agent_operations.ts`, `schema/team_task_dependencies.ts`,
2 columns on `schema/jarvis_delegations.ts`, exported from `schema/index.ts`,
journal entry `idx 131`. `pnpm -C packages/db typecheck` (incl. migration-numbering
check) passes; migration applied cleanly to the dev instance (both tables + both
columns confirmed present).

## 3. Phase 2 — read-only vertical slice (shipped)

A **"Team Mode"** tab in the War Room header (next to "Conversation"). Renders:

- **Leader card + leadership chain** — rooted at **Hermes** (the leader / Chief
  of Staff), resolved by walking the real `reportsTo` graph UP from the COO to its
  top ancestor. The chain renders **Hermes (leader) → Brainstorm (plan critic) →
  Ares (COO / execution distributor) → workers**, every node sourced from real
  `agents` data. Honest empty states for any unresolved tier.
- **Task board** — four real status columns (Queued / In progress / Completed /
  Failed) from `GET …/jarvis/delegations` (polled 30s). Each card shows the
  worker, the directed task, the typed worker-status chip, and timing. Honest
  empty state when there are no in-flight assignments.
- **Directed messages** — for a selected assignment: leader→worker (the task)
  and worker→leader (the result) as a two-message directed thread.
- **Team roster** — Ares' real direct reports with live status dots,
  `metadata.currentTask`, and last-heartbeat times (kept live by the existing
  `agent.status` WS invalidation).
- **Dependencies** — placeholder bound to `team_task_dependencies` (empty today).

**Read-only by design:** no assign / approve / cancel actions are wired — those
are deferred to a post-review phase, per the brief.

### Real vs stubbed
- **Real:** leader + team roster (12 reports under Ares), per-agent status /
  role / title / heartbeat, the delegation ledger and its columns/cards, directed
  task + result text. (In Tyler Co the ledger currently has **0 rows**, so the
  board honestly shows the empty state; the roster and leader are live real data.)
- **Stubbed against a contract shape (clearly marked):** the typed worker-status
  contract (`ui/src/lib/team-mode-contract.ts`). The four-state contract is
  *documented* on `deerflow-port/subagent-isolation`
  (`agent-rooms-v1/orchestration.md` @ `18f111b`) but **not yet landed as shared
  importable TypeScript**. The board reads `worker_status` (col) / `metadata.workerStatus`
  and renders a real chip when present, "verdict pending" when absent — never
  invented. When deer-flow publishes the contract as a shared export, replace the
  stub body with a re-export; the board is already coded to it.
- **Additive-but-dormant:** `agent_operations` persistence (the run-log) is
  created but gated OFF (`TEAM_MODE_OPLOG`); the live `agent.work` stream is the
  read source until it's enabled.

## 4. Phase-2 (bigger) — full ACP transport adoption (SCOPED, not done here)

Per the AionUi spec the high-value end-state is to **adopt ACP (Agent Client
Protocol) in Fleet/War Room and retire the custom bridge**. Scope — explicitly
**not** started in this task; the bridge is left fully intact:

1. Stand up an ACP client layer in the Fleet box service (reuse
   `@office-ai/aioncli-core`, Apache-2.0 — confirm published license before
   vendoring) instead of re-implementing JSON-RPC.
2. Port the detection registry + `AgentMetadata`/handshake model; point spawn
   recipes at Hermes / Ares / workers (self-describing agents → no per-agent glue;
   `team_capable` falls out of `mcp_capabilities.stdio`).
3. Expose the detected roster to Fleet; let War Room open ACP sessions against any
   available agent.
4. Add the gateway/remote-agent model (Ed25519 device pairing) so Paperclip web +
   Mission Control mobile reach Box1/Box2 over WebSocket — the cross-box + phone
   path.
5. Keep the current bridge as a fallback during cutover; delete only once parity
   is verified.

Migration shape: the Team-Mode data model added here (assignment ledger +
run-log + dependency graph + typed worker-status) is transport-agnostic — it sits
above the bridge today and will sit above ACP unchanged, so this slice does not
block or get blocked by the ACP migration.

## 5. Coordination / non-collision

- Branched off the clean restore point; only Team-Mode files committed. The
  parallel **Designer** task's uncommitted `App.tsx` / `Design.tsx` edits were
  left untouched and **not** included in any commit.
- War Room tokens are scoped locally (`warRoomTokens.ts`, mirroring JarvisPage's
  locked DS set) — no global theme mutation, so the Designer's shared theme +
  Home/Fleet work is not clobbered. This task owns only the new War Room
  Team-Mode views.
- Schema column names chosen to not collide with the proposed Ares-pipeline
  columns.

## 6. Files

**New:** `packages/db/src/schema/agent_operations.ts`,
`packages/db/src/schema/team_task_dependencies.ts`,
`packages/db/src/migrations/0131_team_mode.sql`,
`ui/src/lib/team-mode-contract.ts`,
`ui/src/pages/jarvis/TeamModeBoard.tsx`,
`ui/src/pages/jarvis/warRoomTokens.ts`.

**Edited (additive):** `packages/db/src/schema/jarvis_delegations.ts` (+2 nullable
cols/index), `packages/db/src/schema/index.ts` (exports),
`packages/db/src/migrations/meta/_journal.json` (idx 131),
`ui/src/api/jarvis.ts` (2 optional fields on `JarvisDelegationRow`),
`ui/src/pages/jarvis/JarvisPage.tsx` (view toggle + render branch).
