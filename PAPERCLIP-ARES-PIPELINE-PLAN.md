# Implementation Plan — Native Hermes → Ares → Workers Pipeline in Paperclip

> **Status: PROPOSED — held for Tyler's sign-off. No code written, live fleet/server untouched.**
> Author: Hermes (planning pass). Grounded in `~/paperclip` server code + `~/fleet-record/paperclip-architecture-decision.md` §4 and `orchestration.md`.
> Target build base: branch `paperclip-redesign-integration` (HEAD `b1f106407`, post-redesign + "Jarvis→War Room" rename already underway).

---

## 0. The decision in one paragraph

Today Paperclip dispatches **flat**: the in-app brain (`jarvis-brain.ts`) fans out to ~7 sibling peers via `delegate_to_*` tools, and issues wake their one assignee directly. `reportsTo` is rendered but never traversed. We will add a **single in-app COO/distributor tier — Ares** — so the in-app chief of staff (rebranded **Hermes**) hands an *approved plan* to Ares only; Ares **routes each task to the worker that `reportsTo` Ares** (real hierarchy traversal), collects every worker's result as the **single report-back hub**, runs **first-pass QC**, and **funnels ONE consolidated result back up** to Hermes → Tyler. The **Rooms transcript is the transport/shared context**, and the existing War Room **"Approve & send to team"** gate becomes the trigger that fires Ares (instead of a flat re-prompt).

---

## 1. Current state (grounded, cited)

| Concern | Where it lives today | Behavior |
|---|---|---|
| In-app CoS brain | `server/src/services/jarvis-brain.ts` | LLM turn; on tool-use calls `dispatchDelegation()` |
| Flat delegation tools | `jarvis-delegation-tools.ts` (`delegate_to_hermes/august/codex/content/social/researcher`, `dispatch_claude_code`) | 7 sibling targets, no `ares` |
| Dispatch transport | `jarvis-delegation.ts` `dispatchDelegation()` | fire-and-forget `POST {bridge}/jarvis/dispatch`; peer calls back `/jarvis/delegations/:id/result` |
| Delegation rows | `packages/db/src/schema/jarvis_delegations.ts` | `agent`, `task`, `status`, `result`, `metadata`, `conversationId` |
| Issue path | `issues.ts` → `issue-assignment-wakeup.ts` → `heartbeat.wakeup(assigneeAgentId)` | flat: issue → assignee |
| Hierarchy | `agents.ts`: `reportsTo`, `assertNoCycle`, `getChainOfCommand` (walks UP), `orgForCompany` (tree) | display/validation only; **not** traversed on dispatch |
| Rooms transport | `services/rooms.ts` + `routes/rooms.ts` POST `/messages` | posting a message wakes **every** agent member (bridge or `heartbeat.wakeup`) — fan-out, no distributor |
| Approval gate | `ui/.../JarvisPage.tsx` `onApprove()` | just re-sends a chat string `"Approved — send … and have Ares assign agents…"`; no structured wiring |
| Identity | `jarvis-persona.ts` loads `jarvis-augi-persona.md` ("Augi") | War Room branded "Hermes" in UI, but brain persona is still Augi |

**Net:** the Hermes→Ares funnel exists only in the OpenClaw/bridge layer; Paperclip only *surfaces* it. Making Paperclip *own* it is net-new backend work (per architecture-decision §4, §6).

---

## 2. Target model (replicate MissionControl natively)

```
Tyler ──chat──> Hermes (in-app CoS brain)
                   │  proposes plan; Tyler approves in War Room
                   ▼
                 Ares (in-app COO/distributor)         ← NEW in-app tier
                   │  reads reportsTo: distributes each task DOWN
        ┌──────────┼─────────────┬───────────┐
        ▼          ▼             ▼           ▼
     worker     worker        worker      worker      (agents whose reportsTo == Ares)
        │          │             │           │
        └──────────┴──────┬──────┴───────────┘
                          ▼  every worker reports ONLY to Ares
                 Ares: first-pass QC + consolidate
                          │  ONE consolidated result UP
                          ▼
                 Hermes → Tyler
```

Mirrors `orchestration.md`: Hermes plans + talks to Ares only; Ares distributes, QCs, consolidates both directions; workers execute and report only to Ares.

---

## 3. Data model changes (additive, reversible)

No destructive migrations. Two additions:

1. **New table `ares_dispatches`** (`packages/db/src/schema/ares_dispatches.ts`) — the consolidation parent that ties a Hermes plan to its fan-out of worker tasks:
   - `id`, `companyId`, `conversationId?`, `roomId?` (transport room)
   - `planTitle`, `planText`, `approvedByActorId`, `status` (`distributing | awaiting_workers | qc | consolidating | completed | failed`)
   - `consolidatedResult` (text, the ONE result UP), `qcNotes` (jsonb)
   - timestamps. Indexed by `companyId, createdAt` and `status`.
2. **Extend `jarvis_delegations`** with two nullable columns (no backfill needed):
   - `aresDispatchId uuid` (FK → `ares_dispatches.id`) — links a worker subtask to its parent fan-out.
   - `qcStatus text` (`pending | passed | bounced`) — Ares's first-pass verdict per worker result.

Existing flat delegations keep working with both columns NULL. Migration is a single `ALTER TABLE ADD COLUMN` + `CREATE TABLE` — drop-in reversible.

---

## 4. Ares routing — making `reportsTo` actually route

New service `server/src/services/ares-distributor.ts`:

- **`resolveAres(companyId)`** — identify the Ares/COO agent. Resolution order: (a) agent with `role === "coo"`; (b) explicit `metadata.distributor === true`; (c) fall back to the agent every worker `reportsTo`. Cached per company.
- **`directReportsOf(aresId)`** — `agentService.list()` filtered to `reportsTo === aresId` (the inverse of the existing `getChainOfCommand`). **This is the line that makes `reportsTo` route work**, not just render.
- **`distribute(plan, steps)`** — for each plan step, pick the worker under Ares best matched by `role`/`capabilities`/`title` (deterministic scoring; ties → least-loaded by in-flight delegation count). Create one `jarvis_delegations` row per step stamped with `aresDispatchId`, dispatched **through the existing `dispatchDelegation()` transport** (no new wire protocol). **Single-writer rule** from `orchestration.md` §3: code-writing steps serialize to one worker; read-type steps may fan out in parallel.
- Hermes never targets a worker directly: the only delegation tool Hermes keeps is **`handoff_to_ares`** (replaces the 7 `delegate_to_*` peers). Direct-to-worker tools are removed from Hermes's toolset (kept in code behind a flag for issue-path compatibility).

## 5. Consolidation / funnel-up

In `ares-distributor.ts`:

- Worker results still call back to the **existing** `/jarvis/delegations/:id/result` endpoint (`recordDelegationResult`). We add a post-commit hook: when a delegation row carrying an `aresDispatchId` flips to `completed`/`failed`, check whether **all siblings** for that `aresDispatchId` are terminal.
- When the last worker lands → Ares runs **first-pass QC** (`qcStatus` per row, using the `orchestration.md` ground-truth signals where available: build/test/lint result + `agent.work` mutated event; otherwise a rubric LLM pass). Bounced steps are re-dispatched to the same worker (redo), capped at N retries.
- Once all pass → **`consolidate()`** produces ONE result string (LLM summarization of worker outputs + QC notes) written to `ares_dispatches.consolidatedResult`, status `completed`, and posted **once** back up to Hermes's conversation/room. Hermes presents it to Tyler. This is the "ONE result UP" step that today only exists bridge-side (`runHermesTurn`).

## 6. Rooms as the real transport / shared context

- Each Ares dispatch gets (or reuses) a **room** (`type: "mission"`). Hermes's approved plan, Ares's distribution messages, worker check-ins, QC verdicts, and the final consolidation are all `roomMessages` — so the **transcript IS the shared context** (architecture-decision §2/§4).
- We **scope the existing room fan-out**: in `routes/rooms.ts` the current behavior wakes *every* agent member. We add routing metadata so a `kind: "ares-dispatch"` message wakes only the **targeted** worker (not all members), and worker replies (`kind: "worker-result"`) notify only Ares. This converts the room from broadcast to addressed transport without removing human-readable visibility.
- Message `metadata.kind` values introduced: `plan-approved`, `ares-dispatch`, `worker-result`, `qc-verdict`, `consolidated`. Rooms schema already has `metadata jsonb` + `messageType` + `parentMessageId` — **no schema change for rooms**.

## 7. Approval gate → Ares trigger (converse → approve → dispatch)

- Today `JarvisPage.onApprove()` just re-prompts the flat brain. We make it post a structured room message `metadata.kind === "plan-approved"` carrying the `ProposedPlan` (title + steps), to the mission room.
- New server hook (in `routes/rooms.ts` message handler, or a dedicated `routes/ares.ts` endpoint `POST /companies/:id/ares/dispatch`): on a `plan-approved` message, create the `ares_dispatches` row and call `aresDistributor.distribute()`. **Dispatch only fires after approval** — the gate is the trigger. Pre-approval, Hermes only converses/plans (no `handoff_to_ares` until the plan is approved).
- Keeps the human-in-the-loop contract: Hermes proposes → Tyler approves → THEN Ares distributes.

## 8. Identity reconcile (Jarvis/Augi → Hermes)

- The in-app CoS brain becomes **Hermes** (the redesign branch already renamed UI copy). Change: `jarvis-persona.ts` default persona path/identity → Hermes chief-of-staff persona; persona file selectable via existing `JARVIS_PERSONA_PATH`. Hermes's job narrows to: converse, plan, get approval, hand to Ares, present the consolidated result. Hermes does **not** talk to workers.
- Ares gets its own persona/identity (COO distributor) — config-driven, mirroring the bridge's `identityPrefix`. No worker-facing tools on Hermes.
- We keep file/symbol names (`jarvis-*`) to avoid a churny rename in this change; identity is reconciled at the persona/role layer. (A later cosmetic rename can follow once routing is proven.)

---

## 9. File-by-file change list

**New:**
- `packages/db/src/schema/ares_dispatches.ts` — new table.
- `server/src/services/ares-distributor.ts` — resolveAres, directReportsOf, distribute, QC, consolidate.
- `server/src/routes/ares.ts` — `POST /ares/dispatch`, `GET /ares/dispatches/:id` (status/transcript).
- `server/src/services/ares-distributor.test.ts` — unit tests (routing, single-writer, consolidation, QC bounce) — **all dispatch mocked**.
- Migration file under `packages/db` for the table + 2 columns.

**Edited:**
- `packages/db/src/schema/jarvis_delegations.ts` — add `aresDispatchId`, `qcStatus`.
- `jarvis-delegation-tools.ts` — replace 7 `delegate_to_*` with `handoff_to_ares` (others gated behind a compat flag).
- `jarvis-delegation.ts` — emit completion hook when a row with `aresDispatchId` goes terminal.
- `jarvis-brain.ts` — Hermes toolset = `handoff_to_ares` only (post-approval); wire consolidation follow-up.
- `routes/rooms.ts` — addressed routing for `kind: ares-dispatch`/`worker-result` (scope the fan-out).
- `jarvis-persona.ts` — Hermes identity default.
- `ui/src/pages/jarvis/JarvisPage.tsx` — `onApprove()` posts structured `plan-approved` message instead of a re-prompt.
- DB barrel `packages/db/src/schema/index.ts` — export new table.

---

## 10. Safe verification (do NOT disturb live fleet or :3100)

1. **Isolated worktree, not a checkout.** The live tree is on `paperclip-home-redesign` with uncommitted changes. I will create a **dedicated git worktree** off `paperclip-redesign-integration` (matches the repo's existing `.claude/worktrees/` pattern) so the live working dir is never touched.
   - Branch: `paperclip-ares-native-pipeline` off `paperclip-redesign-integration`.
2. **Separate instance, separate port.** Run the QA instance on a non-live port (e.g. `PAPERCLIP_LISTEN_PORT=3190`), with its **own ephemeral embedded Postgres** + a throwaway company — never the live DB, never :3100.
3. **Neutralize the real fleet.** For the QA instance only: point every bridge/peer URL at a dead sink — `OPENCLAW_BRIDGE_URL=http://127.0.0.1:1` and `JARVIS_PEER_*_URL` likewise — and run the brain with `enableDelegation:false` for evals. Real `dispatchDelegation()` HTTP calls thus go nowhere; unit tests mock the transport entirely. **Zero packets reach the live bridge (:18790) or live agents.**
4. **Verification gates (in the task list):** unit tests for routing/consolidation/QC; a scripted end-to-end on the QA instance with a fake 2-worker org (mock workers POST results back to the QA instance's own callback) proving plan→approve→distribute→consolidate→one-result-up; `git diff` review; typecheck/build.
5. **Rollback anchor:** record the base SHA (`paperclip-redesign-integration` = `b1f106407`) and tag `ares-pipeline-base` before the first commit; every change is additive/flagged so revert = drop the branch/worktree. Nothing merged.

---

## 11. Risks & sequencing

- **R1 — accidental live dispatch during testing.** Mitigated by dead-sink bridge URLs + `enableDelegation:false` + mocked transport + separate port/DB. Highest-priority guardrail.
- **R2 — room fan-out change regresses existing broadcast rooms.** Mitigated by gating addressed-routing on the new `metadata.kind` values only; untagged messages keep today's wake-all behavior.
- **R3 — Ares resolution ambiguity** (no agent marked COO in a given company). `resolveAres` falls back safely and the dispatch endpoint errors loudly rather than fanning out flat.
- **R4 — single-writer serialization vs. throughput.** Read work parallel, write work serial per `orchestration.md`; configurable.

**Sequencing:** (1) schema + `ares-distributor` service + unit tests → (2) approval-gate trigger + rooms transport → (3) brain/persona reconcile → (4) QA-instance e2e → **HOLD for review.** No merge, no deploy.

---

## 12. Explicitly NOT in scope / held

- No merge to any redesign branch; no deploy; no touching the live :3100 server or live :18790 bridge.
- No change to the live `paperclip-home-redesign` working tree.
- Issue→assignee path left intact (flat) for now; optional follow-up to also route issues through Ares.
- Cosmetic file/symbol rename (`jarvis-*` → `hermes-*`) deferred to a later cleanup.
