# Book Studio Completion v4 checkpoint

Date: 2026-08-04

## Outcome

Book Studio Completion v4 is implemented and committed locally in the isolated development worktree. Nothing was pushed, merged, deployed, restarted, or changed in a live installation.

## Immutable references

- Accepted work packet: [`2026-08-04-book-studio-completion-v4.md`](./2026-08-04-book-studio-completion-v4.md)
- Repository: `tymines/paperclip`
- Verified base: `origin/master` at `826238c0f5cb211c947001f0847f75d511edbb4f`
- Branch: `codex/book-studio-completion-v4-20260804`
- Worktree: `C:\Users\tyler\Documents\Codex\Paperclip Development\worktrees\book-studio-completion-v4-20260804`
- Implementation commit: `f2ded4551fd23898a2b9f20eba9c57721bd2d64c`
- Primary audit correction commit: `1d66271ef152f11e71eb916b1b42f8b749cf4873`

## Delivered inventory

### UI and book scope

- Added a shared 15-section Story Bible registry and aligned the Director's Deck rail and editors to it.
- Added the Book Studio brand, company-scoped book selector, and inline rename through the company-scoped `PATCH` route.
- Corrected section-to-entity mapping for Overview, Characters, World & Locations, Style & Voice, and Outline.
- Kept book switching controlled across the deck, media panel, section editor, and docked chat.
- Invalidated delayed section requests and remounted section state by book and section so prior-book data cannot flash or overwrite the active book.

### Durable Calliope chat

- Added per-book drafts, durable active history, read-only archives, confirmed archive-only reset, retry reconciliation, and stable `conversationId`/`turnId` provenance.
- Persisted user turns before dispatch and made send/reset mutually ordered with a book-scoped PostgreSQL advisory transaction lock.
- Made retry claims conditional and durable; an indeterminate dispatch stores `retryable=false` and its delegation ID so it can never launch duplicate work.
- Reset refuses pending work and archives the transcript plus its activity record in one transaction. No transcript deletion path was added.
- Switching books releases the old submitting state while late responses remain scoped to their originating book.

### Direct human-authorized actions

- Added a strict, fail-closed parser for one exact action in the latest human message only. Generic assent and compound/destructive instructions do not authorize changes.
- Commits an authorized book mutation, its activity record, the assistant confirmation, and completion of the pending user turn in one transaction. If durable confirmation fails, the mutation rolls back and a durable failure result states that nothing changed.
- Stored authorization snapshots as JSON-safe ISO timestamps.
- Added transaction-time duplicate checks for create operations under identity-scoped advisory locks.
- Added lock and timestamp predicates to the actual conditional update and requires exactly one returned row before logging success.
- Supported exact Overview, Character, World Location, Style, and Outline destinations without reducing governed fields.

### Agent and peer contract

- Calliope remains the only creative/brainstorm execution lane. No Ares, Slack, or generic-model creative fallback was added.
- Hades review behavior and Kimi K3 provenance remain unchanged.
- The peer request contract is additive: stable `conversationId`, durable turn/retry metadata, and delegation provenance are supplied without changing unrelated consumers.
- `AgentLaneUnavailableError` now carries an optional dispatched delegation ID across unexpected post-dispatch failures.

### Schema and configuration

- Added migration `0162_book_studio_completion_v4.sql` and its generated snapshot/journal entry.
- Added durable chat fields for turn/conversation identity, retry count and safety, direct authorization, action result, and active-turn uniqueness.
- No durable machine address, credential, token, model, or environment configuration was changed.
- External Calliope connectivity still uses the existing peer environment contract.

## Verification evidence

### Final focused correction gate

- `pnpm.cmd --filter @paperclipai/server exec vitest run src/__tests__/book-agent-lanes.test.ts src/__tests__/book-chat-actions.test.ts src/__tests__/book-studio-chat.test.ts src/__tests__/book-studio-chat-v4.test.ts src/__tests__/book-studio-rename.test.ts`
  - PASS: 5 files, 75 tests, including the primary-audit regression proving that an authorized mutation rolls back when its chat completion cannot be stored.
- `pnpm.cmd --filter @paperclipai/ui exec vitest run src/components/book-studio/ChatDrawer.test.tsx src/pages/DirectorsDeckSections.test.tsx src/components/book-studio/BookMediaPanel.test.tsx src/components/book-studio/deck/DeckTopBar.test.tsx`
  - PASS: 4 files, 18 tests.
- `pnpm.cmd --filter @paperclipai/db typecheck`
  - PASS, including migration numbering validation.
- `pnpm.cmd --filter @paperclipai/server typecheck`
  - PASS after the correction commit contents were staged.
- `pnpm.cmd --filter @paperclipai/ui typecheck`
  - PASS.

The focused feature suite before the review correction passed 88/88 tests. The broader selected regression suite for top bar, deck, media, generation, locks, Codex, and Hades passed 100/100 tests.

### Repository gates

- `pnpm typecheck`
  - PASS across the repository on the primary-audit correction in approximately 69 seconds.
- `pnpm build`
  - PASS across the repository on the primary-audit correction in approximately 79 seconds; only existing Vite chunk/dynamic-import warnings were emitted.
- `pnpm test`
  - NOT GREEN: 139 failures in approximately 104 seconds, dominated by Windows/runtime infrastructure behavior (`spawn pnpm ENOENT`, `EFTYPE`, CRLF/path assumptions, runtime service timing, and unavailable `/c/WINDOWS/System32/OpenSSH/sshd`).
  - A representative workspace-runtime test was run twice from an exact clean worktree at base `826238c0`; both runs failed with `spawn pnpm ENOENT` and 55 tests skipped. This establishes that representative failure independently of this feature diff, but it does not prove every full-suite failure is baseline-only.

### Browser/API verification

- An isolated disposable Paperclip instance was migrated and served on port `3101` with its Book Studio vault redirected to isolated instance data.
- The corrected `/BOO/book-writing` route reached the Book Studio book, chapter, queue, Codex, and related API endpoints without observed 4xx/5xx responses or page/server exceptions.
- Visual locator and screenshot evidence was not obtained: `agent-browser snapshot -i` timed out twice with Windows socket error `10060`, and the Edge/Playwright fallback remained in an unresolved navigation until timeout despite the successful API traffic.
- All exact helper browser/server processes were stopped; port `3101` was confirmed no longer listening.

## Independent review and correction

One independent review pass identified eight blocking risks. The single correction pass addressed them with:

1. non-retryable durable state for indeterminate dispatch outcomes;
2. JSON-safe authorization timestamps;
3. conditional lock/timestamp writes with affected-row validation;
4. advisory transaction ordering for send and reset;
5. keyed editor state plus delayed-response invalidation;
6. book-scope submission cleanup;
7. serialized transaction-time create deduplication; and
8. atomic reset activity logging.

The final focused tests above cover the corrected retry, JSON round-trip, stale/locked write, reset, and UI book-switch behavior.

The primary accountability audit then identified one additional correctness gap: the approved book mutation could commit before its assistant confirmation and pending-turn completion were durably stored. Commit `1d66271e` closes that gap by sharing the route transaction with the action executor and adds a rollback regression test. No second review cycle or scope expansion was introduced.

## Known limitations and cleanup record

- A live external Calliope memory/cross-session canary was not run because the required external agent lane was not available under the local verification boundary. The durable local contract and mocks are verified.
- No browser screenshot or visible-locator proof is available for this checkpoint; API traffic and absence of observed server/page errors are the only browser-session evidence.
- A temporary exact-base verification worktree is unregistered, but Windows left a residual directory at `C:\Users\tyler\Documents\Codex\Paperclip Development\worktrees\baseline-book-studio-v4-826238c0` after `git worktree remove --force` returned `Result too large`. Its exact resolved path and unregistered state were reverified. A native PowerShell deletion attempt was blocked by the execution policy, so no deletion occurred.
- The frozen packet's trailing blank-line warning was normalized in the primary-audit correction; `git diff --check` is clean.

## Release state

Local implementation only. Push, pull request, merge to live `master`, deployment, service restart, external notification, and cleanup of the residual base directory all remain explicitly unperformed.
