# War Room → Hermes chat: root cause + fix (conversation, context, Brainstorm)

Branch base: `deploy/backend-20260621` (built on `8eac3273c` "Clear chat").
Status: built + verified locally. NOT pushed.

## Root cause of "Hermes repeats himself"
The War Room chat (`ui/src/pages/jarvis/JarvisPage.tsx`) posts each turn to
`POST /companies/:id/jarvis/voice` → `jarvisBrainReply()` (`server/src/services/jarvis-brain.ts`).
That brain tried provider keys in order **anthropic → deepseek → openai**:

- anthropic: no key
- deepseek: key present but **invalid — HTTP 401** ("Your api key ... is invalid")
- openai: no plain `openai` chat key (only `openai_admin` / `openai_realtime`)
- moonshot: key present but **invalid — HTTP 401**, and `callLlm` never even tried it

So `callLlm()` returned `null` on **every** turn and the brain fell back to
`deterministicReply()` — a stateless, keyword-routed template. "hi" and
"what should we work on" both miss every keyword, so both returned the **same**
final line ("N blocked issues, X of Y agents active…"). The fallback also never
consulted conversation history. The `/api/jarvis/health` `deepseek:true` flag
only means a key *exists*, not that it works — which masked the problem.

(Conversation history *was* already fetched via `fetchRecentTurns`, but it was
only injected as a system-prompt block and the dead-LLM fallback ignored it.)

## Fix (additive; OpenViking/QMD/memory-core untouched)
`server/src/services/jarvis-brain.ts`
1. **Real LLM, primary provider = local AugiVector/litellm proxy** (the same
   working model lane the live Hermes bridge uses): `AUGIVECTOR_URL`
   (default `http://localhost:3000/v1/chat/completions`), token `AUGIVECTOR_TOKEN`
   (default `local`), model `JARVIS_BRAIN_MODEL` (default `augivector-auto`).
   OpenAI-compatible → reuses the existing chat-completions helper. Tried first;
   key-based providers (anthropic/deepseek/**moonshot**/openai) remain as fallback.
   Added Moonshot support + a loud `logger.warn` when *no* provider answers
   (so a silent template fallback can never hide again).
2. **Real multi-turn**: prior turns are passed to the model as actual
   `user`/`assistant` message turns (not flattened into the system prompt).
   History window raised 5 → **20** turns for the brain (display still honors
   `cleared_at`).
3. **Full system + per-agent awareness**: `gatherContext` now pulls the live
   work queue (active issues w/ ref+title+status+priority+assignee), blocked
   issues, recent agent config changes (decisions/upgrades), and the **full
   fleet roster with each agent's live status** — injected into the brain
   context (and used by the offline fallback).
4. **Deterministic fallback rewritten** to be context-aware and non-repeating
   (greeting vs. "what should we work on" vs. blockers vs. fleet vs. decisions),
   varying by history — so even with zero LLM keys Hermes no longer repeats.

`ui/src/pages/jarvis/JarvisPage.tsx`
5. **New "Brainstorm" toggle** between "Conversation" and "Team Mode".
6. **Brainstorm view** (`BrainstormPanel`): streams the live Hermes↔Brainstorm
   planning transcript from the rooms transport (polls the planning room's
   messages every 3s). Honest empty state when no session is live — no faked feed.

## Verified (Chrome, console-clean)
- provider now `augivector` (real model), not a template.
- "hi" → contextual greeting citing real issues (TYL-110/109/108/107) + fleet state.
- "what should we work on" → different, contextual answer.
- "remind me what I just asked" → "You asked what we should work on" (multi-turn memory).
- "which agents are idle / highest priority" → "All 16 agents idle except Forge (error); highest is TYL-110 Spend-rate tracking…".
- Brainstorm tab renders with honest empty state.

## Live Hermes↔Brainstorm kickoff — remaining build (planned)
The Brainstorm **surface + live transport** are built; the **auto-kickoff** is not.
Concrete plan, building on existing plumbing (rooms = transport; bridge =
Hermes↔peers; see `PAPERCLIP-ARES-PIPELINE-PLAN.md`):
1. On "Approve & send to team" in Conversation, create/reuse a `type:"mission"`
   room named e.g. "Brainstorm · <plan title>" and post a `metadata.kind:"plan-approved"`
   message carrying the ProposedPlan. (`BrainstormPanel`'s room matcher already
   keys off names matching /brainstorm|planning/.)
2. Server hook (`routes/rooms.ts` or new `routes/ares.ts`) on `plan-approved`:
   dispatch the plan to **Brainstorm** (GLM-5.2) via the bridge, and have both
   Hermes and Brainstorm post their planning turns back into that room as
   `room_messages` — the transcript IS the live stream the panel already renders.
3. Scope room fan-out so planning turns wake only Hermes/Brainstorm (addressed,
   not broadcast). Converge → post final plan; Hermes presents to Tyler.
4. Optional: swap the panel's 3s poll for the existing rooms WS for instant streaming.
