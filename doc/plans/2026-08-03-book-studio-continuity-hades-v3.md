# Book Studio continuity and Hades review v3

Status: implementation checkpoint; not deployed, 2026-08-03
Repository: `tymines/paperclip`
Verified base: `origin/master` `4bd4eec3da41d2ae9a79a2d9a36f607c7b1bdb55`
Branch/worktree: `codex/book-studio-no-gemini-20260803` in the isolated `book-studio-no-gemini-20260803` worktree
Prior branch commit: `096b0aa46fc7dc188408145bbf14a0c786ae662e` (`Make Book Studio Calliope-only`)

## Version boundary

This v3 checkpoint preserves the accepted Calliope-only creative execution decision in v2. It supersedes only v2's statement that the Ares critic behavior was unchanged and the incomplete brainstorm-continuity implementation from the earlier v1 packet.

Ares is not a Book Studio reviewer. Ares remains the supervisor/distributor for War Room execution. Book Studio review belongs only to Hades.

## Agent identity and execution decisions

- Calliope is the `calliope` Hermes Harness profile on Box 2 and is the only Book Studio creative/brainstorm lane.
- Hades is the `hades` Hermes Harness profile on Box 2, with SOUL `Hades — Reviewer · Kimi K3 · Box 2`, provider `kimi-coding`, and model `kimi-k3`.
- Calliope and Hades are not OpenClaw bridge agents. Paperclip uses its existing peer dispatch/result-callback contract to address these named Hermes Harness profiles.
- Each Book Studio identity requires an explicit `JARVIS_PEER_<NAME>_URL` and `JARVIS_PEER_<NAME>_TOKEN`. A missing value produces `peer_unconfigured`; neither identity may inherit the legacy shared/default route.
- Baseline review and lens-specific `/review-runs` route only to Hades. They never call the generic critic/model provider chain when Hades is unavailable.
- A safe Hades failure returns 503. An indeterminate post-dispatch state returns 502. No review run, annotation, or chapter review-status mutation is stored for that failed request.
- Successful review provenance is `Hades / Kimi K3`; persisted runs identify reviewer `Hades` and model `Kimi K3`.

## Brainstorm continuity decisions

- Brainstorm history is persistent and scoped to one book.
- A submitted user turn is stored as `pending` before Calliope dispatch. Success pairs the user and assistant rows under one stable `turnId`; failure retains the user turn as `failed` and never fabricates an assistant reply.
- The history API returns paired turn DTOs, including legacy rows that predate `turnId`, and omits orphan assistant rows.
- Opening the drawer and switching books reloads the correct server transcript. A stale prior-book transcript is not displayed during the switch.
- Reset is archive-only: active rows receive `archivedAt`; no transcript row is deleted. The UI requires confirmation and explains retention. A reset failure remains visible and leaves the displayed transcript intact.
- Activity logging for reset is best-effort after the archive operation, so a logging failure cannot cause the API to claim the already-completed archive failed.
- Brainstorm chat itself does not mutate story-bible or manuscript content. Any later send-to-draft action remains an explicit user action.

## Database checkpoint

Migration `0161_book_brainstorm_continuity.sql` adds nullable `turn_id`, `via`, `delegation_id`, `error`, and `archived_at` fields plus non-null `status` with default `completed` to `story_bible_chat_messages`.

The migration was produced through Drizzle, then assigned the next repository-safe migration number because the generator's entry-count numbering collided with released files. The released `0157_snapshot.json` was restored unchanged. `0161_snapshot.json.prevId` equals the immutable `0160_snapshot.json.id`.

## Runtime activation gate

This code checkpoint does not configure Box 2, restart a service, deploy Paperclip, change a credential, or run an agent canary.

Before a live canary, the Box 2 Hermes Harness executor must explicitly allow the `calliope` and `hades` identity IDs, accept Paperclip's configured dispatch path, and reach the Paperclip result-callback base URL. Production must receive the four per-peer URL/token values and the appropriate timeout values through its secret/configuration mechanism. Placeholder-only documentation is in `.env.example`.

Tyler's explicit approval is required before live configuration, restart, deployment, or agent execution.

## Verification evidence

Completed in the isolated worktree:

- `pnpm --filter @paperclipai/db check:migrations` — passed.
- `pnpm --filter @paperclipai/db typecheck` — passed.
- `pnpm --filter @paperclipai/server typecheck` — passed.
- `pnpm --filter @paperclipai/ui typecheck` — passed.
- `pnpm --filter @paperclipai/server build` — passed.
- `pnpm --filter @paperclipai/ui build` — passed (existing bundle-size and mixed-import warnings only).
- `pnpm check:tokens` — passed; no forbidden tokens found.
- Focused server suite covering transcript normalization, peer configuration/diagnostics, lane state safety, Hades baseline review, review routes, brainstorm routes, and autopilot budget behavior — 8 files passed, 94 tests passed.
- Focused ChatDrawer suite — 1 file passed, 8 tests passed.

No live Box 2 reachability or end-to-end canary is claimed by these mocked/local checks.
