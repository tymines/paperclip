# Book Studio Completion v4

Status: Frozen for implementation by Tyler and Codex on 2026-08-04.

This is the authoritative combined work packet for the Book Studio usability and Calliope-completion change. It supersedes the incomplete 2026-08-01 continuity packet and the statement in `2026-08-03-book-studio-continuity-hades-v3.md` that brainstorm chat never mutates book content. It preserves the accepted Calliope-only and Hades-only agent-routing decisions in the 2026-08-03 v2/v3 documents.

A material behavior change requires Tyler's approval and a new packet version. Internal design may be refined only when it preserves every criterion below.

## Objective and deliverable

Make the active Book Studio Director's Deck complete and dependable for Baily: every visible control works, every Story Bible rail item opens its matching editable center, Calliope chat can stay open without blocking writing, conversations remain durable and reviewable, and an explicit Book Studio instruction can safely add approved material to the book.

Deliver two sequential, independently testable slices in one isolated feature worktree:

1. Core UI parity and controls.
2. Brainstorm and Calliope completion.

The final handoff includes source, tests, any backward-compatible schema/API work, isolated browser evidence, a contract/agent inventory, and a durable checkpoint. It is not authority to merge, deploy, restart, configure external runtimes, or contact agents.

## Repository, version, branch, and worktree

- Repository: `https://github.com/tymines/paperclip.git`
- Canonical development checkout: `C:\Users\tyler\Documents\Codex\Paperclip Development\paperclip`
- Base: current verified `origin/master`
- Immutable base commit: `826238c0f5cb211c947001f0847f75d511edbb4f`
- Base commit subject: `Merge pull request #35 from tymines/codex/book-studio-no-gemini-20260803`
- Feature branch: `codex/book-studio-completion-v4-20260804`
- Isolated worktree: `C:\Users\tyler\Documents\Codex\Paperclip Development\worktrees\book-studio-completion-v4-20260804`
- Packet version: `Book Studio Completion v4`

`master` is the live branch and is read-only for this task. All implementation and tests use the isolated feature worktree and a worktree-local Paperclip instance initialized with `--no-seed`. Never use `F:\Augi Vault\_work\paperclip`, `Paperclip-Active`, `paperclip-prod`, the default/live Paperclip instance, or live data.

## Baseline findings accepted into scope

At the immutable base:

- `DeckTopBar` explicitly renders `Studio` orange.
- The book selector is transparent and its native option presentation is unreadable in the reported normal state.
- The top Book Media button invokes an empty callback while `BookMediaPanel` exposes a separate fixed floating launcher.
- The rail exposes Overview, Characters, Locations, Style, eight Codex entity types, Relationships, Facts, and Review Queue, but `DirectorsDeckPage` mounts the same default-lore `CodexPanel` for every choice and does not pass the selected section.
- The legacy unrouted `BookWritingPage` contains working Overview, Character, Location, and Style editors that are absent from the active Director's Deck.
- PR #35 supplies a Calliope-only, book-scoped transcript baseline: pending/completed/failed rows, paired history DTOs, stable per-book conversation ID, and archive-on-reset. It does not supply a docked editor-compatible chat, textarea composer, archive viewer, retry reconciliation, or direct persisted book action.

## Slice 1: Core UI parity and controls

### 1. Brand and selector readability

- The top-left words `Book Studio` are both white in normal display; neither word uses the ember/orange accent.
- The book selector has an opaque dark surface and high-contrast title text without hover.
- The closed selector, focused selector, and expanded native options remain readable using keyboard and mouse in supported desktop browsers.
- Disabled/empty/loading states are visibly distinct and accessible.
- Focus indication remains visible; the change must not solve contrast by removing focus styling.

### 2. Rename the active book

- An obvious rename control is adjacent to the active book selector/title area.
- It opens prefilled with the current display title, rejects an empty/whitespace-only title, surfaces server errors, and leaves the old title intact on failure.
- Success updates every current title presentation immediately, including the selector, overview editor, chat heading, and media panel where mounted.
- Rename changes only the display title. It does not change the book slug, vault path, or content.
- The server mutation is company/book scoped and activity-logged.

### 3. Exact Story Bible rail-to-center parity

- There is one authoritative section mapping shared by the rail and center routing so labels/IDs cannot drift silently.
- Clicking a rail item opens the matching center and visually marks the same selected item.
- Switching between items never falls back to unrelated `Lore` content.
- Switching books clears stale prior-book data immediately, then loads the same selected section for the new book or a clearly documented default.
- Loading, empty, migration-unavailable, and request-failure states are shown honestly in the center.

Required mappings:

| Rail selection | Required editable center |
| --- | --- |
| Overview | Display title plus book description/premise editor |
| Characters | Existing character list, create, edit, lock-aware delete, and existing generation-draft flow |
| Locations | Existing world/location list, create, edit, lock-aware delete, and existing generation-draft flow |
| Style | Existing style entries, create, edit, lock-aware delete, and existing generation-draft flow |
| Lore | Codex Lore |
| Factions | Codex Factions |
| Objects | Codex Objects |
| Systems | Codex Systems |
| Timeline | Codex Timeline |
| Threads | Codex Threads |
| Themes | Codex Themes |
| Glossary | Codex Glossary |
| Relationships | Codex Relationships |
| Facts | Codex Facts with chapter/spoiler behavior preserved |
| Review Queue | Bible Review Queue |

- The active Director's Deck is the only routed target. Reuse/extract legacy editors instead of maintaining two divergent implementations where practical.
- Existing character/location/style fields and data must not be reduced. Existing AI generation remains Calliope-only and preserves human accept/discard behavior.
- All mutations stay company/book scoped, respect locks and authorization, refresh the active view, and surface failure.

### 4. Make the top Book Media button work

- The top Film/Book Media button opens the existing `BookMediaPanel` for the active book.
- The top button closes/reopens or focuses the same panel predictably.
- Director's Deck does not show a second competing floating Media launcher.
- `BookMediaPanel` remains usable from any other existing caller through a backward-compatible controlled/uncontrolled contract.
- Switching books while the panel is open loads the new book and cannot display or mutate the prior book.
- Provider-unconfigured states remain honest; no mocked media output and no credential changes.
- Cover, illustration, trailer, narration, library, and asset-application behaviors are regression-tested at their existing contract boundaries.

## Slice 2: Brainstorm and Calliope completion

### 5. Preserve and complete per-book conversation continuity

- PR #35's Calliope-only rule remains: no model fallback and no substitute presented as Calliope.
- Each book has a distinct active transcript. Switching books loads only that book in chronological order with no stale flash or cross-book leakage.
- Closing/reopening chat, ordinary route navigation, and page refresh retain the active transcript and pending/failed state.
- A turn stays bound to the book and transcript that created it even if the user switches books while it is in flight.
- The stable conversation identifier is propagated to the configured `calliope` Hermes Harness peer lane. Paperclip persists lane/delegation provenance.
- The user message is durably stored as pending before dispatch. Exactly one Calliope reply or one honest failure resolves the turn.
- Retry is visible and idempotent: it reconciles or safely retries the failed turn without launching duplicate peer work or creating duplicate replies.
- Closing or refreshing while a request is pending allows the UI to reconcile the eventual persisted result; the user never needs to send “are you there?” to continue the original turn.
- Useful error reason/status is displayed without leaking secrets.

### 6. Dock chat without blocking the editor

- Desktop chat is a docked/collapsible panel with no full-screen click-blocking backdrop. The user can interact with Story Bible, manuscript, inspector, and other Book Studio controls while chat is open.
- Mobile may use a bottom/right sheet when required by viewport, but closing it never discards server history or the unsent draft for that book.
- Open/collapsed preference survives ordinary navigation/refresh in the current browser.
- The panel is keyboard reachable and does not trap focus away from the book editor.

### 7. Multiline composer

- Replace the single-line input with an auto-growing textarea, approximately three visible lines initially and capped near ten lines before internal scrolling.
- `Enter` sends; `Shift+Enter` inserts a newline.
- Send is disabled for whitespace-only input and while the same turn is being submitted.
- Pending, disabled, focus, and failure states are accessible and visible.

### 8. Reset archives, and archives are viewable

- `New conversation`/reset requires confirmation, archives only the current book's active brainstorm transcript, and starts a new empty active transcript.
- It never deletes transcript rows or modifies the title, Story Bible, outline, manuscript, media, vault, or Slack.
- Archived transcripts are grouped book-specifically and available in a read-only archive/history view with dates and chronological messages.
- Archive/history APIs are company/book scoped. Reset is activity-logged.
- Reset is disabled with a clear explanation while a turn is working unless the server can guarantee that a late result remains in its originating archived transcript.
- The existing stable Calliope/book memory may remain available to the agent after UI reset; reset clears the active visible conversation, not Calliope's durable global knowledge.

### 9. Direct Book Studio instruction authorizes safe additions

- The latest relevant human message in Book Studio is the authorization event. No Slack message, agent suggestion, earlier generic assent, or Calliope-authored text can authorize a book mutation.
- If Baily directly and unambiguously tells Calliope to add material to the book, Calliope applies the supported addition without requiring a redundant approval click.
- Generic assent such as `sounds good`, discussion, or an ambiguous destination/content produces a clarification question and no mutation.
- Supported non-destructive operations for v4 are:
  - set or append the Overview description/premise when the instruction makes the mode clear;
  - create or update a named Character;
  - create or update a named Location;
  - create or update a Style entry;
  - add or update an Outline beat/chapter-plan item when the destination is explicit.
- Destructive chat actions (delete a book/entity/chapter, erase text, rename/move a slug or vault path) are out of scope; Calliope directs the user to the governed UI instead.
- The human instruction and any structured authorization derived from it are persisted with the turn. Agent-returned actions are untrusted input.
- Server validation must exact-match the action to the human authorization and enforce an allowlist, operation schema, company/book scope, current board/human authority, field limits, locks, and current-record identity.
- Ambiguous, malformed, extra, out-of-scope, locked, stale, or unauthorized actions fail closed before mutation.
- Each authorized action is atomic and activity-logged with book, transcript/turn, actor, operation, and destination.
- On success, Calliope's visible reply confirms the exact destination and persisted change and the relevant center view refreshes. On failure, the reply says nothing changed.
- The old `to-draft` response-shaping endpoint is not evidence of persistence and may not be represented as a completed book change.

### 10. Persistent Calliope identity without Slack integration

- Book Studio invokes the actual configured `calliope` Hermes Harness identity/profile, not a same-name prompt simulation.
- Paperclip propagates the stable Book Studio conversation identity through its additive peer dispatch contract and records which lane/delegation handled the turn.
- Mocked/local tests prove Paperclip's boundary only. They do not prove that Box 2 honors shared durable memory.
- Live continuity requires a separately authorized development canary and any required external configuration acknowledgement. Do not contact Calliope or change Box 2/runtime configuration during this packet.
- No Slack API, transcript sync, Slack UI, Slack-originated authorization, or Slack write is included. Cross-interface knowledge is an agent-memory property, not a Book Studio/Slack coupling feature.

## Compatibility and affected-contract requirements

- Existing books, chat rows (including legacy rows), archived rows, Story Bible records, and media records remain readable.
- Preserve the current Calliope-only Book Studio creative lane and Hades-only Book Studio review lane. Ares remains outside Book Studio review.
- Preserve non-Book-Studio delegation behavior and backward compatibility for peer payload consumers.
- Identify and document all affected agents, prompts, structured action contracts, peer payload fields, routes, UI APIs, schema/migrations, media contracts, configuration, and durable instructions.
- If an external bridge/runtime change is required, implement only the backward-compatible Paperclip boundary and prepare an explicit change notice. Do not send or activate it without Tyler's authority.
- Every mutation must be company-scoped, authorized, lock-aware where applicable, failure-visible, and activity-logged.

## Explicit non-goals

- Slack integration or communication with Slack, Calliope, Hades, Ares, Baily, or another external person/agent.
- A different model fallback for Calliope.
- Changing Hades review ownership or Ares War Room ownership.
- Book slug/vault-path rename or destructive chat commands.
- General Book Studio redesign outside the accepted controls, center parity, media wiring, and brainstorm work.
- Live/production data, credentials, configuration, deployment, service restart, merge, or push to `master`.
- Importing transcripts from another system.

## Allowed write scope and ownership

Use one writing worker for the isolated v4 worktree. The worker may modify only the smallest necessary files under:

- `ui/src/pages/DirectorsDeckPage.tsx` and focused Book Studio components/tests;
- extracted/reusable Story Bible editor components and their focused tests;
- Book Studio UI API clients;
- company-scoped Book Studio routes/services/tests;
- `packages/shared` contracts when needed;
- `packages/db` schema/migrations only when required for durable idempotency/archive/action provenance;
- this plan and the final checkpoint/change notice.

The worker is not alone in the codebase. It must preserve/accommodate other contributors' work and never revert unrelated changes. Stop if the verified base or an overlapping active branch changes materially.

## Required tests and evidence

Run the narrowest proving tests first, then the repository-standard PR-ready gates appropriate to this broad cross-layer change.

Required focused evidence:

- Top bar component tests: all-white brand, selector contrast classes/states, rename success/validation/failure, title synchronization.
- Director's Deck integration tests: every rail ID maps to the matching center, book switching clears/reloads, and unsupported/stale sections cannot display the wrong content.
- Extracted Overview/Character/Location/Style editor tests covering existing CRUD/generation/lock-aware behavior and error surfacing.
- Book Media controlled-opening tests, no duplicate launcher in Director's Deck, active-book switching, and existing provider-honesty regression.
- Chat UI tests: docked desktop interaction, responsive sheet behavior, book-scoped loading, reopen/refresh, pending reconciliation/retry, textarea growth/keyboard semantics, reset confirmation, archive browsing, and in-flight book binding.
- Server tests: company isolation; history normalization; archive retention/listing; reset activity; pending/success/failure/idempotent retry; stable conversation ID/provenance; direct-add authorization positive cases and negative generic-assent/ambiguity/extra-action/locked/stale/cross-company cases; atomic mutation and activity logging.
- Migration generation/check/backfill tests if schema changes.
- Regression tests for Calliope-only creative routing, Hades-only review routing, Story Bible generation, locks, and Book Media routes touched by the diff.
- `pnpm --filter` typechecks/builds for touched packages, followed before PR-ready handoff by `pnpm -r typecheck`, the relevant test suite including focused browser tests, and `pnpm build` unless a documented baseline failure is reproduced unchanged on the immutable base.
- `git diff --check`, exact diff/stat, branch/head/status, and immutable commit if committed.
- Browser screenshots from the worktree-local development instance for: readable top bar; each legacy Story Bible editor; one Codex mapping; working top Media button; docked chat while editing; archive view; multiline composer. Include a focused mobile check.
- Contract/agent/config inventory and known limitations.

No browser test may target the live Paperclip installation. Initialize the v4 worktree instance with `pnpm paperclipai worktree init --no-seed`; do not seed live data.

## Time, retry, review, and stop conditions

- Implement Slice 1 and verify it before Slice 2 so failures remain attributable.
- No elapsed-time target overrides correctness. If v4 cannot be responsibly completed and verified in one cycle, stop at a clean slice boundary and return exact remaining criteria rather than claiming partial completion.
- Diagnose a transient setup/test failure and retry it once. Do not repeatedly mutate code around an unavailable external service.
- Use one independent review pass on the exact final diff/commit and one correction pass for concrete blocking correctness, safety, security, compatibility, or acceptance failures. Optional style preferences do not block.
- Stop and return to the primary assistant if scope must change, current `origin/master`/overlapping work changes materially, live data/credentials/configuration are required, an external bridge change is breaking, a migration is destructive/incompatible, or any action would merge/deploy/restart/push/contact external agents.
- Completion means all locally provable v4 criteria pass with evidence and the external Calliope-memory canary is explicitly listed as gated. It does not mean deployed or live.

