# ACP in Paperclip Fleet/War Room — Scope, POC & Migration Plan

**Branch:** `feat/acp-fleet-capabilities` (worktree, off tag `restore/pre-acp-20260623`) · **Commit:** `5fb624c95`
**Date:** 2026-06-23 · **Box:** AugiAIs-Mini
**Scope of change:** additive, read-only. The existing Hermes↔Ares bridge is **untouched** and proven still running.
**Reference:** `AionUi-to-Paperclip-feature-port-spec.md` §2 (the ACP find).

---

## 1. How OpenClaw's gateway WS path actually works on this box

The OpenClaw gateway runs as `openclaw gateway --port 18789` (PID 2320), version **2026.6.1**, listening on `ws://127.0.0.1:18789`. It is a JSON-RPC-over-WebSocket server with **frame types** `req` / `res` / `event`. The connect sequence, verified live:

1. Client opens the WS; the gateway emits an `event` `connect.challenge` carrying a `nonce`.
2. Client sends `req method:"connect"` with a signed device payload: an **Ed25519 device key** (`device.id` = sha256 of the raw public key, `publicKey`, `signature` over a `v3|deviceId|clientId|mode|role|scopes|signedAt|token|nonce|…` string), `minProtocol/maxProtocol`, `role`, `scopes`, and an `auth.deviceToken`.
3. The gateway replies `hello-ok` with `protocol: 4`, `server.version`, `server.connId`, and a **`features` block** that self-describes the full method catalog (**186 methods**) and **27 event** streams.

After connect, the gateway answers self-describing RPCs that are exactly the ACP "what can you do" surface:

| RPC | Returns (verified) |
|---|---|
| `models.list` | 10 models w/ provider, contextWindow, reasoning, input modalities |
| `commands.list` | 159 slash commands w/ description, category, args |
| `agents.list` | 15-agent roster w/ workspace, runtime, `thinkingLevels` (= modes), default model |
| `agent.identity.get` | name/avatar (e.g. "Augi" 🦞) |
| `config.schema` | full config option schema |

Work execution uses `agent` → `agent.wait`; cross-box uses `device.pair.*` / `node.pair.*`. **Auth requires a paired device + token** — a raw device key alone is rejected (`unauthorized: gateway token missing`).

## 2. How Paperclip's Fleet/War Room connect to agents today

Agents live in Paperclip's Postgres store, each row carrying `adapter_type` + `adapter_config`. The Fleet view (`ui/src/pages/Agents.tsx`, nav label "Fleet" → `/agents`) reads them via `agentsApi`. The server adapter **registry** (`server/src/adapters/registry.ts`, `builtin-adapter-types.ts`) hard-wires every backend type:

`acpx_local, claude_local, codex_local, cursor, cursor_cloud, gemini_local, grok_local, openclaw_gateway, opencode_local, pi_local, hermes_local, process, http`.

Two paths matter here:

- **The Hermes↔Ares bridge** = `process`-adapter agents whose spawn recipe is literally `command: "echo", args: ["bridged"]` — **Ares, Augi, August, Builder, Codex, Content, Designer, Forge, Researcher, Reviewer, Social, Vision Coder**. The real work is carried by the **Hermes gateway** (`hermes_cli gateway run`, PID 86373) and **`bridge-daemon.mjs`** (PID 95999). This is the bridge that must not be ripped out.
- **`openclaw_gateway` adapter** (`packages/adapters/openclaw-gateway`, `@paperclipai/adapter-openclaw-gateway`) speaks the gateway-WS `connect` handshake with device-key auth, then `agent`/`agent.wait`. Used by CEO/CFO/CMO/COO/CPO/CTO/Intake/OpenClaw Agent (all → `ws://127.0.0.1:18789`).

**Everything is hard-coded.** Models are baked into the binary (`codex-models.ts`, `cursor-models.ts`, per-adapter `models` exports); modes, commands and team-eligibility are per-adapter assumptions, not read from the agent. Adding/altering a backend means editing adapter code. **Notable drift found:** the in-repo `openclaw_gateway` adapter pins `PROTOCOL_VERSION = 3`, but the installed gateway negotiates **v4** — a live correctness risk independent of this work.

## 3. What "adopting ACP" precisely means

ACP flips the model from *Paperclip declares each agent* to *each agent declares itself*:

- **Self-description on connect.** The `hello-ok` `features` catalog + `models.list`/`commands.list`/`agents.list`/`agent.identity.get` ARE the capability bag. The UI's model picker, mode (thinking-level) switch, slash-command list and team badge become **data-driven off the handshake — zero per-agent hard-coding**.
- **"Connecting as an ACP backend"** = anything that completes the gateway-WS `connect` handshake (or, for local CLIs, stdio ACP per the AionUi spec) and answers the self-describing methods. Our Hermes/Ares/workers qualify the moment they answer the handshake.
- **`team_capable`** in AionUi = `mcp_capabilities.stdio`. The OpenClaw gateway doesn't surface that verbatim, so we **derive** it from the advertised orchestration methods (`agents.create` + `sessions.create` + `tasks.list`). This is the one computed field; everything else is verbatim.
- **What consumes the handshake instead of config:** the Fleet capability display (this POC), the War Room session launcher (model/mode/command pickers), and team-eligibility — all replacing `builtin-adapter-types` + per-adapter model files.

## 4. Migration map — bridge stays, ACP runs in parallel, cutover only later

| Phase | What | Bridge |
|---|---|---|
| **0 — this POC (done)** | Read-only ACP handshake reader + Fleet capability display, alongside the bridge. | untouched |
| **1** | Persist the handshake into an `agent_metadata`-style cache (AionUi shape); drive War Room model/mode/command pickers off it for gateway agents. | untouched |
| **2** | Open a real **ACP session** for ONE non-critical agent in parallel with its bridge path; diff outputs for parity. | runs in parallel |
| **3** | Extend to more agents; add the gateway/**remote device-pairing** model for cross-box (Box1 Hermes / Box2 Ares) and the phone→Fleet link. | still primary |
| **4 — cutover (later)** | Once parity is verified, flip the default to ACP; keep the bridge as **fallback**; remove only after a stable soak. | demoted to fallback, then retired |

## 5. Risks

- **Protocol drift.** Repo adapter pins v3; live gateway is v4. The ACP layer must negotiate/track protocol (the POC reader uses v4, verified).
- **Auth & pairing.** Gateway needs a *paired* device + operator token; Paperclip's per-agent gateway devices are not paired today (the POC authenticated via the box's local operator identity in `~/.openclaw/identity`). A per-agent pairing/token-provisioning story is required before cutover.
- **Transport dependency.** AionUi's `@office-ai/aioncli-core` is unverified for license/API. We deliberately **clean-roomed over the existing gateway WS** and took no new dependency.
- **Bridge semantics.** The Hermes→Brainstorm→Ares pipeline (`echo bridged` + `bridge-daemon`) is not yet replicated by an ACP session; **cutover only after parity** — hence bridge-stays.
- **Out of bounds.** No changes to OpenViking / QMD / memory-core.

## 6. Coordination with the Team Mode build (overlap flag)

The Team Mode task (separate branch off the same restore tag) owns the **War Room task-board UI**. This work owns the **ACP connection/adapter layer + the Fleet capability display**. Two reconcile points:
1. **`team_capable`** — this POC computes it from the advertised orchestration methods; the Team Mode board should consume that same flag/source rather than re-deriving it.
2. **Handshake cache** — when Phase 1 persists `agent_metadata`, the task board should read team/roster data from that cache (single source of truth), not a parallel one.

No code overlap today (their work is War Room board UI; this is Fleet + server `acp/`), but the data contract above should be agreed before Phase 1.

---

## What the POC actually proved (real vs stubbed)

A live end-to-end handshake against the running gateway, rendered in the **real Fleet view** in Chrome (renders + console-clean):

| Field | Source | Real / Derived |
|---|---|---|
| server version / protocol / connId | `connect` hello-ok | **real** (v2026.6.1, protocol 4) |
| method + event catalog | hello-ok `features` | **real** (186 methods, 27 events) |
| models (10) | `models.list` | **real** |
| modes (off/minimal/low/medium·default/high) | `agents.list[].thinkingLevels` | **real** |
| slash commands (159) | `commands.list` | **real** |
| roster (15 agents) | `agents.list` | **real** |
| identity (Augi 🦞) | `agent.identity.get` | **real** |
| team-capable (yes) | derived from method catalog | **derived** (only non-verbatim field) |

**Nothing is stubbed.** The single non-verbatim field, `teamCapable`, is explicitly marked *derived* in both the API payload (`provenance`) and the UI legend.

**Bridge confirmation:** Hermes gateway (PID 86373) and `bridge-daemon.mjs` (PID 95999) verified still running after all changes; the 12 `echo bridged` process-adapter agents are intact. ACP was added strictly **alongside** it.

### How it's wired (additive)
- `server/src/acp/gateway-handshake.ts` — the real handshake reader (device-key connect + capability reads → normalized bag w/ provenance).
- `server/src/acp/acp-router.ts` — `GET /api/acp/handshake` (read-only).
- `server/src/acp/acp-sidecar.ts` — runs the same router on port 18900 so the POC is browser-verifiable without restarting the shared backend.
- `server/src/app.ts` — env-flagged in-process mount (`PAPERCLIP_ACP_POC=1`), inert by default.
- `ui/src/components/AcpCapabilitiesPanel.tsx` + `ui/src/api/acp.ts` + `ui/src/pages/Agents.tsx` (Fleet) + `ui/vite.config.ts` proxy.
