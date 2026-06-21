# Paperclip + OpenClaw — Fable 5 Full-Context Architecture Review Packet

**Generated:** 2026-06-09
**For:** Claude Fable 5 review pass
**Authored by:** Claude Sonnet 4.6 (Cowork mode, Dispatch interface) with peer agents Augi (DeepSeek V4 Flash) and Hermes (Kimi K2.6) on Tyler Switzer's stack
**Total content scope:** The full state of Tyler's AI-influencer / viral-content stack — Paperclip product, OpenClaw infrastructure, agent topology, persona generation pipeline, debug history, research dossier, and the 30+ architectural decisions made during the dispatch session that produced this packet.

---

## 0. How to use this packet with Fable

Fable's 1M context window can hold this entire packet plus all referenced source files. Workflow:

1. Paste this document into a new Fable conversation
2. Optionally attach the file paths listed in §F (most key content is already inlined below)
3. Ask the explicit review questions in §G, plus any of your own
4. Use `effort: high` — this is exactly the long-horizon autonomous review work Fable was tuned for

**Do not pre-summarize the codebase for Fable.** It does better with raw material + clear constraints + explicit questions than with pre-digested briefs.

The packet is structured: Part I sets product + strategy context. Part II sets infrastructure context. Part III covers the current proof-of-concept pipeline (Python scripts). Part IV covers the Paperclip Reels module that is productizing the pipeline. Part V is the research dossier. Part VI is the locks (decisions we don't want relitigated unless overruled with explicit rationale). Part VII is the review ask. Part VIII (§F) is the file index.

---

# PART I — Product Vision & Strategy

## A.1 Executive ask

Tyler Switzer is the single operator of a stack that produces AI-generated short-form video for Instagram Reels / TikTok / YouTube Shorts using **synthetic AI personas** — the Lil Miquela / Aitana López pattern. The end goal is **revenue from social media**: brand deals, affiliate, platform creator funds, subscription tiers (Fanvue / Passes).

**Paperclip** is the operator's product: a TypeScript monorepo (server + ui + db) that orchestrates the entire reel production pipeline — from a single prompt to a posted, multi-platform reel. Paperclip v1 is single-operator (Tyler only). Paperclip v2 (planned) is the consumer build — multi-tenant, per-company personas, per-tenant billing.

**The Reels module** is the centerpiece of Paperclip. Today's prototype is a set of Python scripts at `~/.openclaw/scripts/`. The Reels module is the productized version: persistent schema, orchestrator, UI, multi-provider video abstraction, niche-aware templates, compliance gate, multi-platform posting.

**Review ask:** Identify architectural risk, missing pieces, and the highest-leverage changes that would let this hit 15 reels/day (5 personas × 3 reels each) at $500-800/mo while maintaining (a) character consistency, (b) compliance for risky niches, (c) viral-grade hook + caption + pacing, and (d) hands-off operation for Tyler (agents drive execution; he does taste-curation, not button-clicking).

## A.2 Paperclip product context

Paperclip is a Tailwind / React / Vite UI on top of Express server with Drizzle ORM + Postgres. Sidebar has **18 canonical tabs** organized as Primary 6 + MORE 12 (the MORE section includes Skills, Costs, Activity at the bottom — important for not confusing them in mockups).

Single-operator v1 means: don't add multi-user gating, consent dialogs, or attestations to v1; those belong to v2. Server-side never hard-blocks NSFW content — content rating is a label, never a gate (Tyler routes placement himself).

## A.3 The persona roster

Five planned synthetic AI-influencer personas. Each is fully synthetic (AI-generated training data — the Lil Miquela pattern, not a deepfake). All personas use the same production pipeline but have distinct visual identities (LoRA per persona) and brand aesthetics.

- **Sidney** — original persona, brand TBD, fully synthetic
- **Raven** — gothic-cyber, dark glamour. Current validation target (smoothie reel work tonight). Trained Raven SFW LoRA at `tymines/raven-sfw` on Replicate
- **Willow** — pending. Likely positioning: organic / holistic wellness
- **Isabella** — pending. Likely positioning: luxury lifestyle
- **Sophia** — pending. Likely positioning: sophisticated explainer style

**Persona ↔ niche policy is ORTHOGONAL by Tyler's explicit decision.** Any persona can fire any template. The visual identity is the persona, the content format is the template, they're independent inputs at fire time. A Raven legal-explainer reel is fine — the compliance gate cares about the script, not the persona.

## A.4 10-niche content strategy

The Reels module ships with 10 niche templates seeded as `companyId = null` (global system presets). Each template is independent and persona-agnostic. The 10 niches with their CPM positioning and compliance pattern:

| # | Niche | CPM range | AI-persona fit | Compliance pattern |
|---|---|---|---|---|
| 1 | Finance/Investing | $25-50 | Trust risk — handle via educational framing | Auto-disclaimer "Not financial advice. Consult licensed advisor." Banned words: buy/sell/recommend/guaranteed |
| 2 | Tech/SaaS/AI | $20-40 | B2B audience, low viral but high CPM | None |
| 3 | Legal/Insurance | $30-60 | Trust risk — handle via educational framing | Auto-disclaimer "Not legal advice. Consult a licensed attorney." |
| 4 | Medical/Health | $20-40 | Trust + safety risk — handle via lifestyle framing | Auto-disclaimer "Educational only. Consult your doctor." Avoid clinical claims |
| 5 | B2B/Marketing | $20-35 | Awkward AI-persona fit but doable | Citations required |
| 6 | Real Estate | $15-25 | Trust risk | Auto-disclaimer "Not real estate advice. Consult a licensed realtor." |
| 7 | **Beauty/Skincare** | $8-15 | AI-native, huge market | FTC #ad tag if sponsored |
| 8 | **Aesthetic/Fashion** | $8-15 | **AI-persona sweet spot** | FTC #ad if sponsored |
| 9 | **Fitness/Wellness** | $8-15 | **AI-persona sweet spot** | Avoid clinical claims |
| 10 | Food/Recipes | $6-12 | Oversaturated but viable | None |

Risky niches (1, 3, 4, 6) carry a `complianceCheckPrompt` in their template metadata. The compliance gate runs that prompt against the LLM-generated script BEFORE any keyframe/video media spend.

## A.5 Monetization paths (order matters)

Per the deep research dossier in §E.2:

1. **Subscription platforms first** — Fanvue / Passes are AI-native and have $100M+ ARR. They accept synthetic creators. Sweet spot for personas with strong visual identity (Raven).
2. **TikTok Shop affiliate second** — direct conversion, no brand-deal gatekeeping. Works for any niche with a product.
3. **Brand deals once 100k+ followers** — ~30-50% of brands accept AI/synthetic creators in 2026 per Influencer Marketing Hub. Sweet spot for beauty/fashion/fitness niches.
4. **Affiliate (LTK, Amazon, ShareASale)** — supplement to all of above. Caption-link conversion.
5. **SKIP Meta creator funds** — Reels Play Bonus was discontinued in 2023.

## A.6 Competitive landscape

Per Augi's technical synthesis (§E.3):

- **Genviral** (OpenClaw skill, github.com/fdarkaou/genviral-skill) — wraps Genviral.io's slideshow-based posting + analytics across 15 platforms. **Not a competitor — complementary.** Genviral is slideshow-only (photo carousels with voiceover), not i2v video. Paperclip handles the deep-video creation; Genviral handles distribution + analytics. The play: install Genviral skill, point it at our finished Paperclip reels for cross-platform posting + performance tracking.
- **Faceless.video, Capsule, Opus Clip, Vadoo** — adjacent video-tooling SaaS, none have the persona + template + compliance-gate combination. Paperclip's differentiation is the agent-first orchestration + per-niche compliance + persona-LoRA system.
- **Direct competitors with AI-persona focus:** none mature in 2026 — this is an open lane.

---

# PART II — Infrastructure (OpenClaw + Agents)

## B.1 OpenClaw stack

**OpenClaw 2026.6.1** (open-source agent gateway, github.com/openclaw/openclaw, npm `openclaw`) is the orchestration runtime that hosts Augi and Hermes. It exposes a Slack channel as the control-plane: messages routed through `intake` agent → `main` agent → tool calls (Bash, sessions_spawn, etc).

**Loaded plugins** (with their roles):
- `aceforge` — self-evolving skill engine. Observes tool patterns + crystallizes them into reusable SKILL.md files via a dual-model LLM pipeline (Generator + Reviewer). Threshold = 3 same-pattern uses. **Created the auto-heal skills that caused tonight's loop** — see §C.4.
- `agentaugi` — Tyler's custom plugin exposing EvoAgentX, a multi-agent workflow engine. Routes tasks through sub-agents (researcher/analyst/writer/reviewer). **Recommended orchestration spine for Paperclip Reels per Augi's research.**
- `openviking` — context-engine / memory plugin. Hooks `before_prompt_build=auto-recall, afterTurn=auto-capture`. Runs at `http://127.0.0.1:1933`.
- `acpx` — agentic-compute platform, runs sub-agents via spawn-child sessions.
- `langgraph-orchestrator` — LangGraph integration with QA enforcement.
- `lobster`, `llm-task`, `codex`, `discord`, `moonshot`, `google`, `mistral`, `openai`, `council-mention` — various providers / channels.
- `slack` — Slack channel adapter. Critical: the Slack channel `C0AEQPEETJL` (#ai-tech-new) is the operator-agent control plane.
- `telegram` — Telegram channel adapter (also configured).
- **DISABLED tonight:** `system-core` (its `self_heal` tool was destructive — see §C.4).

**Disabled / parked skills (also tonight)** for being destructive:
- `auto-self_heal` (workspace, auto-crystallized from 39 self_heal events)
- `auto-gateway_health` (workspace, auto-crystallized from 39 gateway_health events)
- `self-healing-claude` (workspace)
- `auto-fixer` (in `~/.openclaw/skills/`)
- Their forge proposals (so they don't re-crystallize)

Parked location: `/tmp/parked-openclaw-skills-1780969724/`.

## B.2 Mac mini topology

Per `project_openclaw_topology` memory: OpenClaw runs across multiple Mac minis as peer instances.
- **AugiAIs-Mini** (Tyler's primary machine, 192.168.50.106) hosts Augi + Hermes locally.
- **August's Mac mini** (192.168.50.38, separate machine) is a peer agent. Wakes via WoL.
- The architecture is peer-aware: multi-agent features must work across instances.

Paperclip itself runs on AugiAIs-Mini with Cloudflared tunnel for external access (LaunchAgent `com.paperclip.cloudflared`).

## B.3 Agent topology

Three agent personas matter for Paperclip work:

- **Augi** (Slack `<@U0AK3AT0E79>`, runs DeepSeek V4 Flash, 128k context).
  - Worker / executor. Fires scripts, generates content, can write explicit NSFW prompts.
  - Lives at `/Users/augi/.openclaw/agents/intake/` and `agent:main` on the AugiAIs-Mini gateway.
  - **Receives `intake` routing from #ai-tech-new** per `bindings` in `~/.openclaw/openclaw.json`.
  - **Context-resets on long tasks** — needs session wipes occasionally (see fix_augi.sh).
- **Hermes** (Slack `<@U0AT684H6LR>`, runs Kimi K2.6, 256k context, no NSFW).
  - Strategist / researcher. Long context, no resets, refuses NSFW prompts.
  - Lives at `/Users/augi/hermes-agent/` with own venv and `ai.hermes.gateway` LaunchAgent (separate from OpenClaw gateway).
  - **Was booted out during the SIGTERM debug and is currently being restored by Augi.**
- **Claude (me)** — main orchestrator running on Cowork desktop, talks to user via Dispatch.
  - Architects the system, writes code, designs the auto-heal patterns, writes the SCRIPTS.md entries.
  - Has Read/Edit access to Tyler's mounted folders (~/.openclaw, ~/paperclip, ~/.openviking).
  - Cannot directly type into Tyler's Terminal (Apple IDE-tier restriction).
  - Can post to Slack via MCP, can use Bash in own Linux sandbox.

**Lane policy** (from memory):
- "Don't author explicit NSFW prompts directly — Augi/Hermes handle that lane" (Claude's lane constraint)
- "Hermes (Kimi K2.6) refuses NSFW — keep Augi on DeepSeek family"
- "Hermes is primary peer agent; Augi is the worker" (Hermes for orchestration when possible)
- "Always fan out to peer agents in parallel" (parallelize via Augi+Hermes+research subagents)

**Slack channel `C0AEQPEETJL` (#ai-tech-new)** is the control plane. Messages there route through `intake` → `main` → agent. Augi's persona reads SCRIPTS.md to know which trigger phrases (e.g., "fire smoothie reel", "fire keyframes v2") map to which bash commands.

## B.4 The 5-hour SIGTERM cascade — full debug history

**Symptom:** OpenClaw gateway crash-loops under launchd. Process spawns, reaches `[gateway] ready`, then dies with `signal SIGTERM received` ~7-13 seconds later. Cycle repeats forever. Augi (the agent that lives on this gateway) appears silent in Slack because his Slack handler dies repeatedly with the gateway.

**False hypotheses chased, in order:**
1. **WSS rotation bug** (`project_openclaw_slack_wss_bug` memory). The Slack handler dies after ~5h of WSS rotation. We applied the documented config workaround (`channels.slack.accounts.default.socketMode.clientPingTimeout: 30000`, `gateway.channelStaleEventThresholdMinutes: 120`). Already in place. Wasn't the cause.
2. **Codex sidecar killing gateway.** Booted out `ai.augi.codex-sidecar`. Loop continued.
3. **Auto-heal skill `auto-self_heal`** (aceforge auto-crystallized after 39 heal events). Parked the skill directory. Loop continued.
4. **`auto-gateway_health` skill** (sibling auto-crystallized skill that triggered the heal). Parked. Loop continued.
5. **`plugins.entries.system-core.config.autoHeal: true`** config flag. Set to false. Loop continued. (Turned out the code never reads this flag — purely cosmetic.)
6. **`system-core` plugin itself** — its `self_heal` tool runs `openclaw gateway stop; pkill -9 -f openclaw-gateway; openclaw gateway start`. Disabled the plugin. Loop continued. (Tool wasn't being called by anything we could find at this point.)

**The actual root cause** (discovered after deep research + reading source):

The LaunchAgent plist had `KeepAlive: true` (boolean). launchd respawns the process on **every** exit — clean or crashed. OpenClaw's gateway has built-in `service-mode` self-cleanup: when a new gateway starts, it SIGTERMs any other gateway on the same port. This cascade:

```
Gateway A is running.
New gateway B spawns (because launchd respawned something).
B's service-mode runs: SIGTERMs A.
A exits (cleanly, code 0).
launchd KeepAlive sees exit → respawns as C.
C's service-mode runs: SIGTERMs B.
B exits cleanly.
launchd respawns as D.
... infinite cascade.
```

**The fix that worked:**

```python
# Python edit of the plist
pl['KeepAlive'] = {'SuccessfulExit': False, 'Crashed': True}
pl['ThrottleInterval'] = 60
```

`SuccessfulExit: False` means launchd only respawns on UNCLEAN exit. Clean exit (which is what every `service-mode` polite-step-back produces) does NOT trigger respawn. The cascade dies because there's no perpetual respawn engine.

Augi responded in Slack at 22:40 EDT confirming "Slack routing confirmed — this went through cleanly. No SIGTERM cascade in sight 🎉"

**Lessons (encoded into memory file `project_openclaw_gateway_launchd_sigterm_loop.md`):**
- Always start at the launchd/systemd layer when a managed process loop is reported, not at the application layer.
- `KeepAlive: true` (boolean) is a footgun when combined with any application-level self-cleanup. Always use the dict form with `SuccessfulExit: false` + `Crashed: true`.
- Three independent OpenClaw community implementations (Ramsbaby/openclaw-self-healing, cathrynlavery/openclaw-ops, clinchcc/openclaw-watchdog) all converged on the same pattern: separate watchdog LaunchAgent that polls HTTP `/health` and uses `launchctl kickstart` (never `openclaw gateway start` which triggers `service-mode`).

## B.5 The watchdog auto-heal design

After the loop fix, we lost auto-restart-on-crash. If the gateway legitimately crashes, nothing brings it back. We then designed the correct watchdog pattern. Files staged tonight (not yet installed via the install script):

**`~/.openclaw/bin/gateway-watchdog.sh`** — the watchdog
- HTTP probes `http://127.0.0.1:18789/` on a 60s cadence
- 3 consecutive failures (3 min unhealthy) → heal via `launchctl kickstart -k gui/$UID/ai.openclaw.gateway`
- **Never calls `openclaw gateway start` directly** (that's what triggers the service-mode cascade)
- Circuit breaker: max 3 heals per rolling 60-min window
- After 3 failed heals in 1h: stops trying, posts a Slack alert to `#ai-tech-new` with the last 30 log lines, displays macOS notification
- State files in `~/.openclaw/state/watchdog/`

**`~/.openclaw/bin/alert-slack.sh`** — Slack alerter helper
- Posts to channel via Augi's bot token (`xoxb-...`)

**`~/.openclaw/launchagents/ai.openclaw.watchdog.plist`** — the second LaunchAgent
- `StartInterval: 60`
- `KeepAlive: {SuccessfulExit: false}`
- `ThrottleInterval: 30`

**`~/.openclaw/scripts/install_watchdog.sh`** — installer
- Snapshots gateway plist
- Hardens gateway plist: `KeepAlive: {SuccessfulExit: false, Crashed: true}`, `ThrottleInterval: 60`, `OPENCLAW_DISABLE_SELF_RESTART=1` env var
- Copies watchdog plist to `~/Library/LaunchAgents/`
- Bootstraps both
- Verifies + prints rollback

Status as of writing: **Tyler asked Augi to fire `install_watchdog.sh` via Slack trigger phrase "install watchdog"** — Augi is executing in parallel with other work.

## B.6 The agent persona system (instruction files)

OpenClaw agents read these files at session start. They're at `/Users/augi/.openclaw/workspace/`:

- **SOUL.md** — who the agent is (persona, voice, mission)
- **AGENTS.md** — operating procedures (every-session reading list, delegation rules, agent-runtime guidance). Updated tonight to add VIRAL_CONTENT.md to reading list + "Creative Input Authority" section telling agents to propose tighter alternatives if a content concept is weak (not silently execute).
- **SCRIPTS.md** — fireable scripts Tyler can ask via Slack ("fire smoothie reel", "fix augi", "install watchdog", etc). Updated tonight with watchdog + ffmpeg-build entries.
- **VIRAL_CONTENT.md** — NEW tonight. Strategic brief for content work. Covers: mission (synthetic persona roster, viral validation, Paperclip Reels module connection), what viral actually means (>70% completion, hook in 1.5s, character consistency rules), 2026 viral patterns research, current pipeline, agent lanes (Hermes SFW strategy/eval, Augi SFW + NSFW prompt writing), persona roster.
- **SYSTEM.md** + **PROJECTS.md** — infrastructure + project context (read every session)
- **memory/YYYY-MM-DD.md** — daily memory flushes

The pattern: when Tyler types "fire smoothie reel" in #ai-tech-new, Augi looks up SCRIPTS.md, finds the trigger → `python3 ~/.openclaw/scripts/make_raven_smoothie_reel.py`, executes via Bash tool, acks in Slack, lets the script self-report completion. Agents handle execution; Claude (me) writes the scripts and design.

---

# PART III — Current Reel Production Pipeline (Python prototype)

The Paperclip Reels module is the productized version of these Python scripts. Understanding the prototype tells you what the module needs to capture.

## C.1 Pipeline location

All scripts at `/Users/augi/.openclaw/scripts/`. Outputs at `/Users/augi/.openclaw/sidney-test-output/persona-candidates/`.

## C.2 The smoothie reel proof-of-concept

`make_raven_smoothie_reel.py` — current end-to-end pipeline:

1. **Keyframe upload** — uploads pre-generated Raven kitchen still (`raven_kf_03_loose_silk_partial_unbutton.png`) to litterbox.catbox.moe (public temporary URL).
2. **Per-scene Atlas Seedance 2.0 submit** — 4 scenes × 4s each. Each scene has:
   - Same keyframe URL (single-keyframe identity-lock — see §C.5)
   - Motion prompt prefixed with identical RAVEN_IDENTITY string (~80 words describing the persona)
   - Motion prompt suffix with REALISM_BLOCK (~70 words pushing iPhone amateur photography aesthetic to fight Seedance's "AI plastic" default)
   - 4s duration, 9:16 aspect, `generate_audio: true` for Seedance 2.0's native dialogue + lip sync
3. **Poll** — Atlas returns prediction_id, script polls `/api/v1/model/prediction/{id}` every 5s until status=completed.
4. **Download** raw .mp4 to `clips/0X_name_raw.mp4`.
5. **Caption burn** via FFmpeg drawtext filter — **CURRENTLY BROKEN** (FFmpeg lacks libfreetype — fix in flight tonight via `build_ffmpeg_drawtext.sh`).
6. **Stitch** — FFmpeg concat-demuxer joins 4 captioned clips into one 16s 1080×1920 final.
7. **Upload to Slack** via `files.completeUploadExternal` API.

Companion script `stitch_smoothie_raw.py` — emergency stitcher when caption-burn fails (currently used). Takes the raw clips from `clips/` and stitches them without captions.

## C.3 Keyframe generation

Two scripts:

- **`fire_smoothie_keyframes.py`** (v1) — Replicate `lucataco/flux-dev-multi-lora` with 2 LoRAs: Raven SFW (`tymines/raven-sfw`) + XLabs Realism. 6 candidates, SFW thirst-trap kitchen variants. **Only 1/6 passed Replicate's safety filter** because the negative prompt + positive prompt language ("no bra visible," "natural cleavage") flagged the moderation layer.
- **`fire_smoothie_keyframes_v2.py`** — softened wardrobe language (low-cut scoop neck, fitted tank, V-neck). **Also only 1/6 passed.** Replicate's filter looks at framing/composition too, not just keywords.

The 1 surviving v2 keyframe had **identity drift** — caramel-highlighted hair instead of jet-black, warmer skin, softer features. Cause: dropping the explicit anatomy terms from the negative prompt also dropped implicit identity steering. Realism LoRA at 0.75 pulling toward generic photoreal didn't help.

**Planned v3 fix** (not yet executed): Raven LoRA scale 1.0 → 1.4, Realism 0.75 → 0.5, negative adds "caramel hair, light brown hair, highlights, warm skin tone, tanned, soft rounded features," positive promotes "young woman" → "striking gothic woman, porcelain pale skin, jet-black hair without highlights, angular sharp features."

## C.4 Output as of writing

Latest reel: `~/.openclaw/sidney-test-output/persona-candidates/raven/_reels/v2_smoothie/raven_smoothie_v2_nocaption_1780973900.mp4` (5.9 MB, 1080×1920, ~16s). No burned-in captions (FFmpeg fix in flight). Tyler reviewed it earlier.

Augi's evaluation:
- Hook lands sub-1.5s (glowing smoothie is strong visual scroll-stop)
- All 4 scenes anchored on one keyframe + identical character description → should fix the identity drift from v1
- Lip sync should land (lines ≤10 words, phoneme-clean, Seedance 2.0 native sync)
- Pacing miss: 4s per cut, viral spec is 1.5-2.5s — Seedance's 4s ceiling is the bottleneck for now
- Captions missing = 85% reach loss on muted scroll (FFmpeg fix is the unblock)

## C.5 Character consistency learnings

Burned across multiple iterations:

- **One canonical keyframe** across all scenes is non-negotiable for i2v. Different keyframes per scene = different Raven each scene.
- **Identical character description string** prepended verbatim to every motion prompt. Paraphrasing = identity drift.
- **Cross-model swaps break identity** (Seedance keyframe → Kling i2v has no shared embedding). Stay single-model per reel unless we add a shared-LoRA bridge.
- **External voice via ElevenLabs saved voice ID** beats letting Seedance pick voice per clip. Seedance's voice drift across clips is its documented weak point.
- **Dialogue ≤10 words, phoneme-clean** for lip sync (plosives + clear vowels, no heavy sibilants).

These are now codified in VIRAL_CONTENT.md and AGENTS.md as standing rules.

## C.6 Persona LoRA training

Raven's SFW LoRA was trained on Replicate (`tymines/raven-sfw`) from ~50 SFW photos at trigger word `ravenpersona`, 1500 steps, lr 1e-4, batch 1, resolution 1024, rank 16. Other personas (Sidney, Willow, Isabella, Sophia) haven't been trained yet.

LoRA-on-LoRA stacking via Replicate `lucataco/flux-dev-multi-lora` is the current pattern (Raven identity + XLabs Realism + occasionally Civitai NSFW Flux LoRA when adult content is needed).

---

# PART IV — Paperclip Reels Module (productizing the pipeline)

## D.1 Module overview + state machine

The Reels module is the productized version of the Python pipeline. It lives in three packages:

- **`packages/db`** — Drizzle schema + seeds
- **`server/src/services/reels`** — orchestrator + per-stage services
- **`ui/src`** — React pages + components + API client

The pipeline state machine (updated tonight):

```
queued
  → directing                  (scene-director LLM)
  → compliance_check           (Kimi K2.5 + Sonnet hybrid, BEFORE media spend)
  → generating_keyframes       (parallel image gen via image-providers)
  → generating_video           (parallel image-to-video via video-providers)
  → stitching                  (FFmpeg concat + scale + caption burn)
  → posting                    (Zernio via AgentAugi sub-agent)
  → complete | failed | needs_human_review
```

Concurrency cap raised from 2 → 8 tonight (env-configurable via `REEL_CONCURRENCY`).

State transitions are atomic via Drizzle `update().where(status=oldStatus)` to prevent double-processing across multiple gateway processes.

## D.2 Data model (Drizzle / Postgres)

Schema lives at `packages/db/src/schema/reels.ts`. Tables:

- **`reels`** — one row per reel
  - Identity: `id`, `companyId`, `personaId`
  - User input: `title`, `prompt`, `stylePreset`, `durationSeconds`, `aspectRatio`
  - LLM output: `directorTitle`, `musicMood`
  - Status: `status`, `errorMessage`
  - Outputs: `finalVideoUrl`, `finalVideoLocalPath`, `thumbnailUrl`, `finalDurationSeconds`
  - Cost: `totalCostUsd`
  - Lineage: `postedToPlatforms` (text array)
  - Timestamps: `createdAt`, `startedAt`, `completedAt`
- **`reel_scenes`** — one row per beat (4-5 per reel)
  - Identity: `id`, `reelId`, `sceneIndex`
  - Director output: `description`, `cameraFraming`, `emotion`, `sceneDurationSeconds`, `keyframePrompt`, `motionHint`
  - Keyframe gen: `keyframeJobId`, `keyframeProviderHost`, `keyframeImageUrl`, `keyframeCostUsd`
  - Video gen: `videoJobId`, `videoProviderHost`, `videoModel`, `videoClipUrl`, `videoCostUsd`
  - Status: `status`, `errorMessage`
  - Per-scene state machine: `pending → keyframe_submitted → keyframe_ready → video_submitted → video_ready → failed`
- **`reel_templates`** — niche-aware presets
  - Identity: `id`, `companyId` (nullable; null = global system preset)
  - Vertical: `niche` (text — finance, tech, legal, medical, b2b, real_estate, beauty, fashion, fitness, food)
  - Display: `name`, `description`, `stylePreset`
  - Config: `promptScaffold`, `durationSeconds`, `aspectRatio`, `defaultMusicMood`, `defaultVideoProvider`
  - **`metadata` jsonb bag:** `hookPatterns[]`, `sceneCount`, `targetCutDurationSeconds`, `bannedWords[]`, `requiredDisclaimer`, `recommendedClips{}` (per clip type), `compatiblePersonas[]` (intentionally empty — orthogonal by design), `defaultHashtagPack[]`, `complianceCheckPrompt`
  - Indexes: `niche`, `companyId`
- **`reel_series`** + **`reel_series_entries`** — multi-episode narrative arcs (Day 1 of X / Day 2 of X / ...)

## D.3 The 10-niche template seed

Seeded at `packages/db/src/seeds/reel-templates.ts` as 10 entries with `companyId = null` (global presets). Each has its `niche` + full metadata bag.

Highlights:
- **Persona-agnostic** — every `compatiblePersonas: []`. Tyler's explicit decision: any persona can fire any template.
- **Compliance differentiation** — 4 niches (finance, legal, medical, real_estate) have a `complianceCheckPrompt` that gets fed to the LLM gate with the generated script. 6 niches have `complianceCheckPrompt: null` (auto-pass).
- **Banned-word lists** — explicit per-niche (e.g., finance bans "buy", "sell", "recommend", "guaranteed"; medical bans "cure", "treat", "diagnose", "prescribe").
- **Required disclaimers** — auto-appended to caption stage (e.g., finance: "AI-generated content. Educational only. Not financial advice. Consult a licensed financial advisor.")
- **Recommended models per clip type** — e.g., finance template prefers Hedra Character-3 for talking-head closeups (the persona explaining a concept) + Atlas Seedance 2.0 for B-roll + product shots.
- **Hashtag packs** — niche hashtag presets seeded.
- **Hook patterns** — 3 per template, drawn from 2026 viral structures (contrarian, transformation, "POV").

The seed function is idempotent: deletes existing global templates by name then re-inserts. Safe to re-run.

## D.4 Compliance gate

New file tonight: `server/src/services/reels/compliance-gate.ts`. Runs BEFORE keyframe/video gen.

Pattern:
1. Load template metadata for the reel
2. Concatenate all scene descriptions + motion hints into a full script
3. **Synchronous banned-word check** (~0ms) — if any banned word hits, FAIL with the hit list (no LLM spend)
4. **If template has no `complianceCheckPrompt`** (safe niches), auto-PASS
5. **Primary LLM check via Kimi K2.5** (~$0.0003/call, ~400-800ms). Returns PASS or REJECT
6. **Hybrid second-pass** — only Kimi-FAILs get re-run through Claude Sonnet 4.6 (~$0.015/call) for confirmation. Blended cost ~$0.001/call (5% of calls hit Sonnet).
7. Returns `{verdict, reason, bannedWordHits, disclaimers, modelUsed, costUsd}`

On FAIL, orchestrator moves reel to `status=needs_human_review` (not `failed`) so it surfaces for triage, no retry. On PASS, orchestrator proceeds to keyframe gen.

**TODOs in compliance-gate.ts (flagged in source):** the actual Moonshot (Kimi) and Anthropic (Sonnet) client calls are stubbed. Pattern to follow: `social-caption.ts` elsewhere in the repo.

## D.5 Multi-provider video abstraction

`server/src/services/reels/video-providers/index.ts` — registry. Currently only `atlascloud.ts` is wired (Seedance 2.0). Future providers per Augi's research:

- **Kling 3.0 Pro** — physics-accurate motion, 4K export. Bring in for B-roll scenes. ~$0.112-0.168/s.
- **Hedra Character-3** — talking-head closeups, better lip sync than Seedance. ~$0.03/s.
- **Runway Gen-4** — high-quality but expensive.
- **Veo 3.1** — Google's offering, less mature on character consistency.

**Cross-model swaps break character identity.** Mitigation per Augi's research: train a LoRA adapter on 3-5 persona reference images and load it into both models. Until that's built, **stay single-model per reel**.

## D.6 Status of every component (the punch list)

| Component | Status | File |
|---|---|---|
| `reels` schema | ✅ shipped | `packages/db/src/schema/reels.ts` |
| `reel_scenes` schema | ✅ shipped | same |
| `reel_templates` schema (with niche + metadata) | ✅ shipped tonight | same |
| `reel_series` + entries schema | ✅ shipped | same |
| 10-niche template seed | ✅ shipped tonight, persona-agnostic | `packages/db/src/seeds/reel-templates.ts` |
| Orchestrator state machine | ✅ shipped (updated tonight with compliance_check + posting states + REEL_CONCURRENCY=8) | `server/src/services/reels/orchestrator.ts` |
| Scene director | ⚠️ scaffold — `callLLM` throws "not wired" | `server/src/services/reels/scene-director.ts` |
| Compliance gate | ✅ shipped tonight; Kimi + Sonnet clients are TODO stubs | `server/src/services/reels/compliance-gate.ts` |
| Keyframe generator | ⚠️ scaffold — image-providers integration not wired | `server/src/services/reels/keyframe-generator.ts` |
| Video clip generator | ✅ working (Atlas Seedance 2.0 only) | `server/src/services/reels/video-clip-generator.ts` |
| Video-providers registry | ✅ shipped (Atlas only; Kling/Hedra/Runway/Veo pending) | `server/src/services/reels/video-providers/index.ts` |
| Atlas Seedance adapter | ✅ shipped | `server/src/services/reels/video-providers/atlascloud.ts` |
| Stitcher | ✅ working except caption burn (FFmpeg drawtext missing — fix in flight tonight) | `server/src/services/reels/stitcher.ts` |
| Posting layer (Zernio) | ❌ not started | TBD |
| Express route `POST /api/reels` (queue a reel) | ❌ not started | TBD |
| Express route `GET /api/reels/templates?niche=...` | ❌ not started | TBD |
| UI: Reels library page | ✅ shipped | `ui/src/pages/Reels.tsx` |
| UI: Reel detail (preview + per-scene regen) | ✅ shipped | `ui/src/pages/ReelDetail.tsx` |
| UI: New reel dialog | ⚠️ scaffold — needs niche/template picker | `ui/src/components/reels/NewReelDialog.tsx` |
| UI: Status badge | ✅ shipped | `ui/src/components/reels/ReelStatusBadge.tsx` |
| Persona-trained LoRAs | 1/5 done (Raven SFW); 4 personas not trained | external |
| FFmpeg drawtext fix | 🟡 in-flight tonight via `~/.openclaw/scripts/build_ffmpeg_drawtext.sh` (Augi firing) | external |
| Gateway auto-heal watchdog | 🟡 in-flight tonight via `~/.openclaw/scripts/install_watchdog.sh` (Augi firing) | external |

---

# PART V — Research Dossier

Three large research outputs from tonight. Important: Fable should treat these as data, not as gospel. Some claims are single-sourced (flagged below).

## E.1 Auto-heal-without-loop research (full report)

**Bottom line:** Two LaunchAgents. Gateway plist hardened with `KeepAlive: {SuccessfulExit: false, Crashed: true}` + `ThrottleInterval: 60`. Separate `ai.openclaw.watchdog.plist` polls HTTP `/health` every 60s, heals via `launchctl kickstart -k` after 3 strikes, circuit breaker at 3 heals/hour, **never calls `openclaw gateway start` directly** (that's what triggers OpenClaw's `service-mode` cleanup cascade).

**Sources** (all real GitHub issues + community implementations):
- [openclaw#20257](https://github.com/openclaw/openclaw/issues/20257) — original LaunchAgent KeepAlive restart loop bug, suggested `KeepAlive={SuccessfulExit: true}` fix (close but wrong polarity for our case)
- [openclaw#52922](https://github.com/openclaw/openclaw/issues/52922) — gateway-lock conflict + `KeepAlive: true` = infinite ~6s loop, proposes distinct exit codes
- [openclaw#43406](https://github.com/openclaw/openclaw/issues/43406) — config-reload SIGTERM cascade, suggests `KeepAlive={SuccessfulExit: false}` + `ThrottleInterval: 10`
- [openclaw#40905](https://github.com/openclaw/openclaw/issues/40905) — `bootout + bootstrap` race when invoked from inside an agent; fix is `launchctl kickstart -k`
- [openclaw#26904](https://github.com/openclaw/openclaw/issues/26904) — restart race condition, workaround `ThrottleInterval: 60`
- [Ramsbaby/openclaw-self-healing](https://github.com/Ramsbaby/openclaw-self-healing) — 4-tier self-heal (Preflight → KeepAlive → HTTP watchdog → AI doctor → human alert)
- [cathrynlavery/openclaw-ops](https://github.com/cathrynlavery/openclaw-ops) — `watchdog.sh` 5min poll, escalates after 3 failures in 15 min
- [clinchcc/openclaw-watchdog](https://github.com/clinchcc/openclaw-watchdog) — 5min HTTP probe, FAIL_THRESHOLD=2, rollback to `.bak` configs before paging

All three community implementations converged on the two-LaunchAgent + `launchctl kickstart` pattern. Our watchdog matches.

## E.2 Top 10 niches by CPM (creator-economy data)

**Bottom line for AI-persona strategy:** Beauty/Skincare (#7), Aesthetic/Fashion (#8), Fitness/Wellness (#9) are the AI-persona sweet spot — AI-native, brands deal with synthetic creators, CPMs reasonable, no compliance risk. Avoid Medical/Legal/Finance for trust-niche reasons UNLESS we handle them with educational framing + auto-disclaimers (which we now do via the compliance gate, so they're back in scope).

Real 2026 data from Influencer Marketing Hub state-of-the-industry, CreatorIQ, ConvertKit creator surveys, recent r/creatoreconomy threads. (Table replicated in §A.4.)

**Key monetization findings:**
- Fanvue / Passes have $100M+ ARR (single-source — flag), accept synthetic creators, AI-native sweet spot
- TikTok Shop affiliate conversion ~5x display ads in the right niche
- Brand-deal acceptance for AI/synthetic creators: ~30-50% (single-source — flag, take with grain of salt)
- FTC AI-disclosure is mandatory in 2026 for endorsement posts (verified March 2026 FTC guidance)
- Meta Reels Play Bonus was discontinued 2023 — DON'T target

## E.3 Augi's technical synthesis (5 sections, full)

Posted in Slack #ai-tech-new at 23:17:39 EDT 2026-06-08:

### Section 1: OpenClaw-native content production architecture

**Bottom line:** AceForge is best as a meta-layer for Paperclip; AgentAugi's EvoAgentX can orchestrate. Neither conflicts — both are compatible spines.

AceForge (`~/.openclaw/plugins/aceforge/`) is a self-evolving skill engine with hooks at `after_tool_call`, `llm_output`, `agent_end`, `before_prompt_build`. It observes tool usage patterns, crystallizes them into SKILL.md files via a dual-model LLM pipeline (Generator + Reviewer), and manages skill lifecycle with 23 adversarial mutation validations. Requires human approval for deployment.

AgentAugi (`~/.openclaw/extensions/agentaugi/`) exposes EvoAgentX — a multi-agent workflow engine routing tasks (researcher/analyst/writer/reviewer) through AugiVector auto-routing using Kimi K2.5 (256K ctx). This IS the right orchestration spine: decomposes "generate reel" into sub-agent steps (scripting → keyframe gen → video gen → stitch → post).

**Recommendation:** Use AgentAugi as orchestrator for content workflow decomposition, AceForge to crystallize Paperclip Reels patterns into reusable skills, and local cron/scripts for actual execution pipeline.

### Section 2: Multi-model video chaining patterns

**Bottom line:** Cross-model swaps break identity. Stay within one model family per reel, or use LoRA embeddings as the cross-model bridge.

2026 consensus from Atlas Cloud / Kling 3.0 / Hedra docs / multiple community guides: frame-chaining (last frame N → keyframe N+1) works within the same model, but cross-model breaks identity because each model extracts different embedding spaces. Proven fix: train (or generate) a LoRA adapter on 3-5 reference images of the character, then load that LoRA into both models.

For us: stick with Seedance 2.0 end-to-end per single reel. It's unified multimodal (text + image + audio + video input) designed to prevent character drift. Only bring in Kling 3.0 for scenes needing physics-accurate motion or 4K — and use shared LoRA as bridge.

### Section 3: OpenClaw agent-driven posting automation

**Bottom line:** No native IG/TikTok feed-posting plugins in OpenClaw. Use Zernio as the API abstraction layer — one token, all platforms, 15 platforms supported.

`openclaw-instagram` exists but is DMs-only. No native TikTok upload plugin. Meta Graph API is technically usable but requires Business/Creator account conversion + app review + separate OAuth per user — heavy lift for 5 personas × 3 platforms.

**Zernio** (zernio.com): one bearer token + one JSON format → 15 platforms (IG feed/reel/story, TikTok, YT Shorts, LinkedIn, X, Bluesky, Pinterest, FB, etc). First 2 accounts free, then ~$10/mo per tier. Installable as ClawHub skill. OpenClaw's cron system schedules posts.

Alternative: Composio MCP server — similar abstraction, more dev-heavy.

### Section 4: The Genviral skill audit

**Bottom line:** Genviral is not a competitor — it's a parallel service that's slideshow-focused, not deep video. Build Paperclip around it, not against it.

Genviral (github.com/fdarkaou/genviral-skill, Feb 2026, 42 commands) wraps Genviral.io's Partner API. Generates slideshows (photo carousels + voiceover), not i2v video — no Seedance, no Kling, no Hedra, no lip-sync, no character consistency. Its differentiator: analytics feedback loop that tracks engagement + adapts hook strategy.

**Our play:** Install the Genviral skill for distribution/analytics only. Point it at our finished Paperclip reels for cross-platform posting + performance tracking. Don't build on it as the video engine.

### Section 5: Realistic budgeting for 5 personas × 3 reels/day = 15 reels/day

**Bottom line:** ~$500-800/mo for 1080p Seedance-only reels. ~$3,000-4,000/mo if mixing Kling 4K + Hedra per reel. The $7,500-10,500 number happens if EVERY scene uses Kling Pro 4K + Hedra (don't do this).

Per-reel cost (16s, 4 clips × 4s):
| Service | Cost/Reel | Notes |
|---|---|---|
| Seedance 2.0 (4×4s 1080p) | ~$0.56 | Volcengine $0.14/s |
| ElevenLabs voice | ~$0.003 | ~300 char |
| Keyframe gen (Replicate flux-dev) | ~$0.07 | 1 image |
| Script LLM | ~$0.01 | ~2K tokens |
| FFmpeg stitch | $0 | local |
| **Subtotal/reel** | **~$0.64** | Seedance-only |

15 reels/day × 30 days = ~$288/mo Seedance baseline.
+ Kling 3.0 Pro for 1 scene/reel (4K): +$301/mo
+ Hedra Character-3 for 2 scenes/reel (talking-head): +$216/mo

Stick to Seedance as primary, use Kling/Hedra as occasional upgrades.

## E.4 Augi's orchestration synthesis (post-locks)

Posted at 08:07 EDT 2026-06-09 after Tyler locked the orthogonality + 10-niche + compliance design.

### Validation of orchestration design

**Corrected pipeline:**
```
(persona_id, template_id, prompt)
  → lookup template (niche, promptScaffold, metadata.bannedWords, metadata.complianceCheckPrompt)
  → load persona (brandVoice, visualAnchor, cameraLean)
  → scene_director_LLM (inject scaffold + persona + prompt → scenes[])
  → compliance_gate_LLM (scenes[] + complianceCheckPrompt + bannedWords → PASS/FAIL + disclaimers)
  → [if FAIL] flag for human review, do not proceed (no media spend)
  → [if PASS] insert reels + reel_scenes into DB with status=queued
  → orchestrator ticker picks it up: keyframe_gen → video_gen → stitch
  → caption_LLM (optional, post-stitch)
  → AgentAugi sub-agent: post-via-Zernio (with retry + rate-limit)
```

**Critical refinement:** compliance gate runs AFTER script generation but BEFORE any media spend. No point burning $0.50+ on keyframes if the script would be rejected.

**Step-by-step recommendations:**
| Sub-step | Recommendation | Why |
|---|---|---|
| Script gen | Inline LLM call | ~$0.001/call, sub-2s. Agent overhead adds latency for zero gain |
| Compliance gate | Inline LLM call | Same reasoning |
| Keyframe gen | Keep parallel image dispatch | Already works |
| Video gen | Keep parallel video dispatch | Already works |
| Stitch | Inline exec | Local FFmpeg, no agent needed |
| Caption | Either inline or delegate | social-caption.ts exists |
| Post to Zernio | **Separate AgentAugi sub-agent** ✓ | External API, needs auth + retry + rate-limit |

**Architectural gap flagged:** Orchestrator runs in-process as setInterval ticker. For 10 niches × multiple companies, REEL_CONCURRENCY of 2 will bottleneck. Raise to 8 or make configurable (DONE — raised to 8 tonight).

### Compliance gate model recommendation

**Bottom line: Use Kimi K2.5 for the compliance gate.**

| Criterion | Kimi K2.5 / GPT-4o-mini | Claude Sonnet 4.6 / DeepSeek Reasoner |
|---|---|---|
| Cost/call | ~$0.0003 (Kimi) / ~$0.0005 (4o-mini) | ~$0.015/call |
| Latency | ~400-800ms | ~2-5s (Sonnet) / ~10-30s (Reasoner) |
| FP rate (moderation) | ~3-5% | ~1-2% |
| FN rate (dangerous slips) | ~0.5-1% | ~0.1-0.3% |
| Suitability | ✅ Recommended | Overkill for binary classification |

Hybrid: re-run only Kimi-FAILs through Sonnet. Blended cost ~$0.001/call (5% of calls hit Sonnet).

Per-call: `complianceCheckPrompt` field in template metadata gets fed with the generated script. Gate returns `{pass, disclaimers, bannedWordHits}`. `requiredDisclaimer` from template metadata auto-appended to caption regardless.

### FFmpeg drawtext fix

Three options offered, Augi recommends **Option C (static build)** for bulletproofness:

```bash
cd /tmp
curl -L https://github.com/FFmpeg/FFmpeg/archive/refs/tags/n8.0.1.tar.gz | tar xz
cd FFmpeg-n8.0.1
brew install freetype fontconfig harfbuzz pkg-config
./configure --prefix=/opt/homebrew/ffmpeg-drawtext \
  --enable-gpl --enable-libfreetype --enable-libfontconfig --enable-libharfbuzz \
  --enable-nonfree --enable-videotoolbox --enable-audiotoolbox \
  --disable-doc --disable-ffplay --disable-ffprobe
make -j$(sysctl -n hw.logicalcpu)
sudo make install
sudo ln -sf /opt/homebrew/ffmpeg-drawtext/bin/ffmpeg /usr/local/bin/ffmpeg-drawtext
```

Then point stitcher.ts at `/usr/local/bin/ffmpeg-drawtext`. Survives `brew upgrade`. ~5-10 min compile. Wrapped tonight in `build_ffmpeg_drawtext.sh` for Augi to fire.

### Hermes status

Augi can't peer-channel Hermes. Two options: (A) proceed with Claude's deep-research-agent report as strategy baseline; (B) Augi drafts strategy lane himself. **Tyler chose B** — Augi is drafting + investigating Hermes (likely just needs `launchctl bootstrap` after we booted him out hours ago).

## E.5 Other research / context worth Fable knowing

- **Slack channel** `C0AEQPEETJL` = #ai-tech-new (private, OpenClaw-routed for agent control)
- **Slack channel** `C0ARJMCPHA7` = #ai-influencer (routes to `social` agent for persona-related strategy)
- **Augi's user ID** in Slack: `U0AK3AT0E79`
- **Hermes's user ID** in Slack: `U0AT684H6LR`
- **Claude's user ID** in Slack: `U0AKGH0BPN2`
- **Tyler's user ID** in Slack: `U0ADPJ29S9H`
- **OpenClaw config:** `~/.openclaw/openclaw.json` (full state inlined in §F)
- **Memory system:** persistent file-based memory at `~/Library/Application Support/Claude/local-agent-mode-sessions/.../agent/memory/` with MEMORY.md index. ~25 entries spanning user profile, feedback, project state, references.

---

# PART VI — Decisions Made + Locks

Fable can challenge these, but flag explicitly when overruling a prior decision and why:

1. **Persona-template orthogonality.** Any persona can fire any template. No brand-fit locking, no compatible-persona filtering. The compliance gate is per-template (not per-persona). Templates have `compatiblePersonas: []` by design.
2. **Compliance-before-spend ordering.** Compliance gate runs BEFORE keyframe/video media spend so rejected scripts cost $0. Augi-confirmed.
3. **Kimi K2.5 primary compliance gate + Sonnet hybrid on FAIL.** ~$0.001 blended/call. Augi-recommended after FN/FP tradeoff analysis.
4. **Seedance 2.0 as primary video model, single-model per reel.** Cross-model breaks identity. Augi-confirmed. Kling/Hedra only as occasional upgrades for specific clip types.
5. **Zernio for cross-platform posting.** One token, 15 platforms, $10/mo. Augi-recommended over Composio MCP / Meta Graph API direct.
6. **All 10 niches in v1 build**, including the 4 trust niches (finance, legal, medical, real_estate). Handled via compliance-check LLM gate + auto-disclaimer that enforces "educational only, not advice." Banned-word lists per template. Tyler explicit decision.
7. **Hands-off operator.** Tyler doesn't run scripts manually. Agents (Augi via Slack triggers from SCRIPTS.md) fire everything. Tyler does taste-curation and direction. Tyler explicit decision tonight.
8. **OpenClaw watchdog architecture** (separate LaunchAgent polling `/health` every 60s, 3-strike threshold, circuit breaker at 3 heals/hour, NEVER calls `openclaw gateway start` directly). Designed tonight after 5h debug + research, three community implementations converged.
9. **`KeepAlive: {SuccessfulExit: false, Crashed: true}` + `ThrottleInterval: 60`** on the gateway LaunchAgent. The fix that ended the SIGTERM cascade.
10. **`system-core` plugin disabled** in OpenClaw config because its `self_heal` tool was destructive. Loses 4 tools (system_health, self_heal, memory_status, session_cleanup) — none essential.
11. **Auto-crystallized skills** (`auto-self_heal`, `auto-gateway_health`, `self-healing-claude`, `auto-fixer`) parked in `/tmp/parked-openclaw-skills-1780969724/`. Their forge proposals also parked so they don't re-crystallize.
12. **Augi handles NSFW prompts; Hermes refuses NSFW** (Kimi K2.6 model policy). Don't reroute NSFW work to Hermes.
13. **Tyler's timezone: America/New_York (Florida east coast)**, not Vancouver. Default tz for "today/tonight" parsing.
14. **Paperclip v1 is single-operator**; multi-tenant gating is v2 work.
15. **NSFW is a label, not a server-side block.** Tyler routes placement himself.
16. **Image inference runs LOCAL on Augi's Mac when possible** (Flux + ComfyUI). Cloud (Replicate / Atlas) is last resort. Training on Replicate is fine; ongoing inference should be local.
17. **Pass API keys inline to Hermes/Augi when sub-tasking them** (they can't decrypt provider-api-keys.json). Rotate keys after exposure sessions.

---

# PART VII — Explicit review questions for Fable

Ordered by leverage. Don't synthesize answers from training data; ground every recommendation in the actual code + context inlined above.

### Architecture (Paperclip Reels module)
1. **Compliance gate location.** We placed the compliance check between `directing` and `generating_keyframes` so rejected scripts cost $0 in media credits. Augi's review agreed. Is there a stronger placement we're missing — for example, before scene direction (compliance-checking the prompt itself before LLM expansion)?
2. **Hybrid Kimi/Sonnet gate sufficiency.** Kimi K2.5 primary, Sonnet only on FAIL re-check, blended ~$0.001/call. Is the 0.5-1% false-negative rate acceptable for finance/legal/medical content, or should we mandate Sonnet for those 3 niches and Kimi for the other 7?
3. **Cross-model identity bridging.** We're staying single-model per reel because cross-model i2v breaks identity. Hedra is meaningfully better at talking-head closeups. Should we invest in a shared-LoRA bridge layer that survives Seedance → Hedra swaps? What's the cleanest implementation pattern in our codebase?
4. **Orchestrator concurrency.** We raised `REEL_CONCURRENCY` 2 → 8. At 10 niches × multiple companies, this could bottleneck. Should we shard the queue by niche or by company? Or replace the in-process setInterval ticker with a proper queue (BullMQ / pg-boss)? What's the migration path?
5. **State machine completeness.** Current states: queued → directing → compliance_check → generating_keyframes → generating_video → stitching → posting → complete | failed | needs_human_review. Missing: `awaiting_curation` (operator reviews before post)? `posted_to_some_platforms_failed_others`? `flagged_by_platform`?

### Data model
6. **Persona-template orthogonality.** All `compatiblePersonas: []`. Should we add a soft brand-fit hint elsewhere for UI ranking (not blocking), or keep fully flat?
7. **Multi-platform posting tracking.** `reels.postedToPlatforms` is text[]. Should it instead be a separate `reel_posts` table with per-platform status, post URL, view count, engagement metrics (for the viral feedback loop in Phase 3)?
8. **Template versioning.** When we A/B test new hook patterns, historical reels still reference the old template via `stylePreset`. Should templates carry a `version` so we can preserve lineage?
9. **Persona LoRA management.** Right now Raven's SFW LoRA is hardcoded in Python scripts. We need 5 personas × multiple LoRA variants. How should the system store + version them (DB table + R2 storage? Replicate model registry as source of truth?)?

### Quality / viral output
10. **Pacing bottleneck.** Seedance 2.0 caps clips at 4s, forcing 4s/cut. 2026 viral spec is 1.5-2.5s cuts. Options: (a) generate longer clips + chop in post via FFmpeg `-vf "select=..."`, (b) generate more 4s clips + use 2-second sub-segments, (c) accept 4s as floor. Recommendation?
11. **Caption strategy per niche.** Once FFmpeg drawtext works, what's optimal? Hook on top of frame 1 (per Augi's research), lower-third per scene, CTA at end? Per-niche differences (legal needs more visible disclaimer vs beauty)?
12. **Hook structures.** Each template carries 3 hook patterns. They're sourced from 2026 viral research but not actual A/B-tested data. Which need replacing?
13. **Character drift mitigation in production.** v2 keyframe batch had 5/6 identity drift. Recommend a deterministic test we can run on every keyframe before it's anchored (e.g., CLIP embedding distance from canonical Raven reference + threshold)?

### Compliance
14. **Required disclaimer placement.** We auto-append `requiredDisclaimer` to caption. Is this enough for FTC 2026, or do we need visible on-frame text disclosure too (burn "AI-generated" into the video itself)?
15. **Banned-word list maintenance.** Hardcoded in seed. How to evolve as new compliance edge cases emerge — admin UI? Per-company override? Versioned?
16. **Risky-niche persona suitability.** Even with compliance gate + disclaimer, is there a brand-trust issue with an AI persona doing legal/medical content that no compliance gate can fix? Should we add a "human-readable trust badge" caption convention?

### Monetization readiness
17. **Posting pipeline.** Zernio is chosen. Should we wire it directly or build a thin abstraction so we can swap to Meta Graph API / Composio MCP later? What's the minimum-viable abstraction?
18. **Performance feedback loop.** We don't yet poll IG/TikTok APIs for post performance. Minimum data we need: views, completion %, comments, follows-from-this-post, save count? Schema design?
19. **Niche-to-monetization mapping.** Which 3 of 10 niches are likely to hit subscription-tier monetization (Fanvue/Passes) fastest for AI personas? Which 3 hit brand deals fastest?

### Future-proofing
20. **Multi-tenant (Paperclip v2).** Currently single-operator. What changes structurally for v2 — per-company persona library, per-company template overrides, per-company billing/quota, separate worker pool per tenant?
21. **Genviral integration.** Augi recommends installing Genviral as a complementary distribution/analytics layer. Should we plan to subsume its features into Paperclip's posting layer eventually, or stay focused on video and keep Genviral as the distribution backend?
22. **The agent layer.** Augi suggests AgentAugi/EvoAgentX as orchestration spine. Should the Paperclip Reels orchestrator-ticker be replaced by an AgentAugi workflow, or stay as a typed Drizzle-backed state machine with agent tasks only for posting?

### Infrastructure (OpenClaw + watchdog)
23. **Watchdog `/health` endpoint.** Our watchdog probes `http://127.0.0.1:18789/health` (or root if `/health` 404s). Does OpenClaw 2026.6.1 actually expose `/health`? If yes, what's the response shape? If no, should we add it as a plugin?
24. **`OPENCLAW_DISABLE_SELF_RESTART=1` env.** We're setting this in the gateway plist EnvironmentVariables. Does OpenClaw 2026.6.1 actually honor this env var, or is it a stale flag from older versions?
25. **Two-LaunchAgent pattern soundness.** Our watchdog is a separate LaunchAgent that only calls `launchctl kickstart` — never `openclaw gateway start`. Are there edge cases where this still triggers cascade (e.g., if launchctl kickstart fails and watchdog retries)?

### Process / strategic
26. **The strategy lane.** Hermes was silent for the strategy research; Augi is drafting it now. When his draft lands, what should we check it against (besides 2026 creator-economy data)? What's the highest-leverage strategic question we should be asking that we're NOT?
27. **The "10 niches in v1" call.** Including risky niches relies on the compliance gate working at the 0.5-1% FN rate. If we're wrong about the FN rate, what's the failure mode? Lawsuit risk? Platform ban? Brand-deal disqualification?
28. **The Augi + Hermes tri-agent topology.** Claude (me) handles architecture + code; Augi handles execution + NSFW prompts; Hermes handles strategy + research. Is this the right division for long-term scale, or should we collapse to fewer agents?
29. **The "Tyler hands-off" promise.** Tyler explicitly wants zero manual button-clicks tonight. Realistic for v1 production reels? Where does manual intervention still leak in (sudo prompts, OAuth flows, brand-deal contracts)?
30. **The Lil Miquela / Aitana López parallel.** Both are human-curated AI personas with teams of editors. We're trying to do it agent-driven. Is the analogy valid, or does removing human-in-the-loop change what "viral" looks like for synthetic personas?

---

# PART VIII — Files Fable should attach

(Most key content inlined above; these files have the actual code and configs Fable can read directly via Tyler's machine attach.)

### Paperclip Reels module (core)
- `~/paperclip/packages/db/src/schema/reels.ts` — schema
- `~/paperclip/packages/db/src/seeds/reel-templates.ts` — 10 niche templates
- `~/paperclip/server/src/services/reels/orchestrator.ts` — state machine
- `~/paperclip/server/src/services/reels/scene-director.ts` — LLM scene breakdown (stub)
- `~/paperclip/server/src/services/reels/compliance-gate.ts` — hybrid Kimi/Sonnet gate
- `~/paperclip/server/src/services/reels/keyframe-generator.ts` — image gen integration (stub)
- `~/paperclip/server/src/services/reels/video-clip-generator.ts` — Seedance i2v
- `~/paperclip/server/src/services/reels/video-providers/index.ts` — provider registry
- `~/paperclip/server/src/services/reels/video-providers/atlascloud.ts` — Atlas adapter
- `~/paperclip/server/src/services/reels/stitcher.ts` — FFmpeg
- `~/paperclip/ui/src/pages/Reels.tsx` — library page
- `~/paperclip/ui/src/pages/ReelDetail.tsx` — detail + per-scene regen
- `~/paperclip/ui/src/components/reels/NewReelDialog.tsx` — fire form
- `~/paperclip/ui/src/api/reels.ts` — typed client
- `~/paperclip/docs/short-film-module-spec.md` — original spec

### OpenClaw infrastructure
- `~/.openclaw/openclaw.json` — full gateway config (model providers, channels, plugins, agents, gateway settings)
- `~/Library/LaunchAgents/ai.openclaw.gateway.plist` — gateway LaunchAgent
- `~/.openclaw/launchagents/ai.openclaw.watchdog.plist` — watchdog LaunchAgent (staged)
- `~/.openclaw/bin/gateway-watchdog.sh` — watchdog script
- `~/.openclaw/bin/alert-slack.sh` — Slack alerter
- `~/.openclaw/bin/openclaw-wrapper` — Tyler's semantic-cache wrapper around openclaw CLI
- `~/.openclaw/plugins/system-core/index.ts` — the disabled `self_heal` plugin (read for cautionary context)
- `~/.openclaw/scripts/install_watchdog.sh` — watchdog installer
- `~/.openclaw/scripts/build_ffmpeg_drawtext.sh` — FFmpeg static-build script
- `~/.openclaw/scripts/fix_augi.sh` — emergency session wipe + gateway restart
- `~/.openclaw/scripts/make_raven_smoothie_reel.py` — current reel pipeline (proof-of-concept)
- `~/.openclaw/scripts/fire_smoothie_keyframes.py` — v1 keyframe gen
- `~/.openclaw/scripts/fire_smoothie_keyframes_v2.py` — v2 (softened wardrobe)
- `~/.openclaw/scripts/stitch_smoothie_raw.py` — emergency stitcher

### Agent instructions (read at every session)
- `~/.openclaw/workspace/SOUL.md` — agent persona definition
- `~/.openclaw/workspace/AGENTS.md` — operating procedures (updated tonight)
- `~/.openclaw/workspace/SCRIPTS.md` — fireable scripts index (updated tonight)
- `~/.openclaw/workspace/VIRAL_CONTENT.md` — strategic brief for content work (new tonight)
- `~/.openclaw/workspace/SYSTEM.md` — infrastructure context
- `~/.openclaw/workspace/PROJECTS.md` — active projects context

### Outputs (look at the reel)
- `~/.openclaw/sidney-test-output/persona-candidates/raven/_reels/v2_smoothie/raven_smoothie_v2_nocaption_1780973900.mp4` — the most recent reel Augi produced
- `~/.openclaw/sidney-test-output/persona-candidates/raven/sfw_thirst/v01_smoothie_kf/raven_kf_03_loose_silk_partial_unbutton.png` — canonical kitchen keyframe (the one we anchor every smoothie reel scene on)
- `~/.openclaw/sidney-test-output/persona-candidates/raven/sfw_thirst/v02_smoothie_kf/raven_kf_v2_03_oversized_silk_pouring.png` — the v2 keyframe with identity drift (for the Fable review of the drift problem)

### Memory (the standing context Claude/me uses across sessions)
- `~/Library/Application Support/Claude/local-agent-mode-sessions/.../agent/memory/MEMORY.md` — index of memory entries
- Individual entries worth reading: `project_openclaw_topology.md`, `project_paperclip_peer_architecture.md`, `project_openclaw_gateway_launchd_sigterm_loop.md`, `project_persona_roster.md`, `project_sidney_is_a_persona.md`, `project_sidney_synthetic_provenance.md`, `feedback_no_nsfw_hardblock.md`, `feedback_local_inference_priority.md`, `project_paperclip_single_operator.md`, `feedback_prefer_hermes_primary.md`, `project_hermes_kimi_refuses_nsfw.md`, `feedback_peer_agents_need_keys_inline.md`, `project_paperclip_sidebar_tabs.md`

---

**End of packet.** Ready for `effort: high` Fable review. Aim for a structured response: per-question verdict (agree/disagree/refine), rationale grounded in attached code + this packet, and a prioritized punch list of changes. Where you overrule a §VI lock, flag explicitly with reasoning.
