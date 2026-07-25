# Book Studio offline rebuild — build status

**Version:** 1.0
**Date:** 2026-07-25
**Integration branch:** `book-studio-rebuild-20260725`
**Verdict:** **NO_VERDICT — usable rebuild not produced**
**Deploy:** Not attempted.

## Built and verified on the integration branch

1. Canonical 27,372-character consolidated spec pinned byte-for-byte with SHA-256 evidence.
2. Canonical redesign source pinned with SHA-256 evidence.
3. Versioned implementation plan and auditable dispatch ledger.
4. Audited baseline QA:
   - Book Studio targeted tests: 63 PASS / 5 pre-existing FAIL (all five in existing autopilot state tests).
   - UI typecheck: PASS.
   - UI production build: PASS.
5. No Paperclip board/auth preflight, `/agents/me`, deploy, push, or PR was attempted.

## Not built

- Usable Review Workflow + Locks core: **NO_VERDICT**.
- Story Bible 12-type codex, relationships, facts, spoiler gating: **NO_VERDICT**.
- Director's Deck production UI and 53-feature retention: **NO_VERDICT**.

No incomplete worker commit was merged into the integration branch.

## Staged next — durable worker checkpoints

| Lane | Branch | Commit | State |
|---|---|---|---|
| Review + Locks backend | `work/book-studio-review-locks-20260725` | `4901670ab57e9cb6ebacac1bb9e3b74f452066f6` | Partial WIP. Server typecheck PASS; DB migration gate FAIL because journal entry is missing; no behavior test evidence. Do not merge as complete. |
| Story Bible backend | `work/book-studio-story-bible-20260725` | `5a28631a1446dbf6b314ecd372255e077aa9970e` | RED tests only; production modules absent. |
| Director's Deck UI | `work/book-studio-ui-20260725` | `d642b83ac398f9cdf05c6ef104b58f8d33af9b40` | RED contract test only; production components absent. |

## Worker/harness evidence

- Codex canary: PASS (`CANARY_OK`).
- First three Codex sessions: each became idle/hung during patch generation and was killed after bounded observation.
- Continuation sessions: core produced partial code then hung; Story/UI again hung before production patches.
- Minimal UI Codex retry: hung before production files.
- Claude Code fallback: unavailable (`Not logged in`).
- Aider edit canary: timed out after 120s and left the canary unchanged (`OLD`).

## Resume point

1. Start from `book-studio-rebuild-20260725`.
2. Repair/complete Review+Locks from `4901670ab` first:
   - add the missing migration journal entry;
   - write non-vacuous lock/review/revision behavior tests;
   - finish exact APIs and all enforcement paths;
   - require DB/server typecheck + targeted tests PASS before cherry-pick.
3. Implement Story Bible production code against RED tests in `5a28631a1`.
4. Implement Director's Deck production components against RED test in `d642b83ac` and run UI typecheck/build.
5. Merge only green commits; then run full local QA and produce the 53-row parity report.

## Delayed process-notification reconciliation

A later Slack notification described two workers as having exited normally with code 0. Live verification did not support that claim:

- `proc_9d22fe6ad934` reports `exit_code: -15`, `completion_reason: killed`, `termination_source: process.kill`.
- `proc_c6448ec76bd9` is no longer present in the process registry.
- Story branch remains unchanged at `5a28631a1` (RED tests only).
- Review/Locks branch remains unchanged at `4901670ab` (partial WIP with failed DB migration gate).
- Integration branch contains neither worker commit.

Therefore the delayed notification is not accepted as completion evidence and the verdict remains **NO_VERDICT**.

## Evidence pointers

- `doc/plans/2026-07-25-book-studio-rebuild.md`
- `doc/plans/2026-07-25-book-studio-spec-source.md`
- `doc/plans/2026-07-25-book-studio-redesign-source.html`
- `artifacts/book-studio/baseline-targeted-tests.txt`
- `artifacts/book-studio/baseline-targeted-tests-rerun.txt`
- `artifacts/book-studio/baseline-ui-typecheck.txt`
- `artifacts/book-studio/baseline-ui-build.txt`
- Worker-specific `artifacts/book-studio/worker-*.txt` files on the three worker branches above.
