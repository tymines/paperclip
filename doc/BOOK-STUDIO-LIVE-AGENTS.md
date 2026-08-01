# Book Studio live agents (PR #30)

Book Studio's "live agents" are real fleet peers wired through the existing
jarvis peer-delegation contract — never raw models wearing agent names.

| Surface | Peer | Profile | Model (operator-declared) |
| --- | --- | --- | --- |
| Brainstorm / co-writer chat (`POST …/book-studio/books/:id/chat`) | `calliope` | Hermes profile `calliope` (launchd `ai.hermes.gateway-calliope`) | `JARVIS_PEER_CALLIOPE_MODEL` (e.g. `sol`) |
| Critic / baseline review (`runBaselineReview`, autopilot review step) | `hades` | Hermes profile `hades` | `JARVIS_PEER_HADES_MODEL` (e.g. `kimi-k3`) |

## Tyler's law — zero raw-model fallback

A raw-model answer is never passed off as a named agent, and there is **no
silent substitute**:

- Chat: if Calliope is unreachable/times out/fails, the route returns
  `502` with `provenance: { agent: "calliope", model, status: "degraded",
  detail }`. The UI shows an amber "Calliope unreachable — degraded, no
  model substitute" bubble. The user's message is still persisted.
- Review: if Hades cannot answer, `runBaselineReview` returns a degraded
  **NO_VERDICT** report (`criticProvider: "hades (agent lane)"`,
  `criticDegraded: true`, `noVerdictReason: "critic-lane-unavailable" |
  "critic-lane-indeterminate" | "critic-lane-unconfigured"`). NO_VERDICT
  halts and surfaces — it never silently passes.
- Successful responses carry `provenance: { agent, model, status: "live" }`
  and the delegation id (the audit trail row in `jarvis_delegations`).

## Response path

Server-side bounded wait (reuses the delegation contract end-to-end):
dispatch → poll the `jarvis_delegations` row (default 2s) until the peer's
result callback flips it terminal, or the lane timeout
(`BOOK_CALLIOPE_TIMEOUT_MS` 45s / `BOOK_HADES_TIMEOUT_MS` 120s). On timeout
the row is terminally `abandoned` (guarded, atomic) before the caller
degrades, so a late peer callback can never be presented as a fresh answer.

## Operator setup

1. Run the peer shim on the box that hosts the Hermes profiles:

   ```sh
   HERMES_PEER_BRIDGE_TOKEN=<shared-secret> \
   HERMES_BIN=/path/to/hermes \
   node scripts/hermes-peer-bridge.mjs   # listens on 127.0.0.1:18791
   ```

   Shim env: `HERMES_PEER_BRIDGE_PORT/HOST/TOKEN`, `HERMES_BIN`,
   `HERMES_VENV`, `HERMES_PEER_PROFILE_CALLIOPE` (default `calliope`),
   `HERMES_PEER_PROFILE_HADES` (default `hades`), `PEER_TURN_TIMEOUT_MS`.
   For persistence, wrap it in a launchd plist (mirroring
   `ai.hermes.gateway-calliope`).

2. Point Paperclip at the shim (`.env` — see `.env.example`):

   ```
   JARVIS_PEER_CALLIOPE_URL=http://127.0.0.1:18791
   JARVIS_PEER_CALLIOPE_TOKEN=<shared-secret>
   JARVIS_PEER_CALLIOPE_MODEL=sol
   JARVIS_PEER_HADES_URL=http://127.0.0.1:18791
   JARVIS_PEER_HADES_TOKEN=<shared-secret>
   JARVIS_PEER_HADES_MODEL=kimi-k3
   ```

   **Do NOT** point Calliope/Hades at the shared OpenClaw bridge (:18790) —
   its `/jarvis/dispatch` handler is a wire-up NOOP that always answers as
   "ares", which would fabricate results.

3. The shim host must reach the Paperclip result callback. Set
   `PAPERCLIP_BRIDGE_LOCAL_API_URL` on the Paperclip server when the shim
   runs on another box (same as the Ares lane).

## Tests

All lane tests mock the transport (`checkPeerReachable` /
`dispatchDelegation`) or point at a dead sink — no test ever touches
:18790/:18791 or a live agent. See
`server/src/__tests__/book-agent-lanes*.test.ts`,
`book-review-hades-lane.test.ts`, `book-studio-chat.test.ts`.
