# Book Studio V5 lock corrections checkpoint

Status: local correction candidate; not merged, pushed, deployed, or run against a live service.

## Lineage and scope

- Canonical remote: `https://github.com/tymines/paperclip.git`.
- Isolated worktree: `C:\pcv5c`.
- Branch: `codex/book-studio-v5-lock-corrections-20260805`.
- Exact frozen base: `050d8a80fc1ef8d43ed93d5ed7815120de51355c`.
- Allowed source scope: Book Studio route and Book Studio tests only. This checkpoint is the only documentation addition.
- Excluded: Fleet, Olympus, Mobile, merge, push, deployment, live databases/services/agents, credentials, and external notifications.

## Corrected invariants

- Retry acquires the shared `book-chat:<bookId>` advisory transaction lock before loading the active session or deciding whether the requested turn is the latest human instruction.
- Inside that same transaction, retry rejects any active pending turn, completed peer turn, non-failed/non-retryable turn, or stale human instruction before a conditional failed-to-pending claim.
- Retry claim predicates include the active session, exact book/turn/user row, retryability, prior conversation, and prior dispatch identity; the new durable dispatch identity is stored before dispatch.
- Send and retry lane-failure writes acquire the same book lock and require the exact active, unarchived, pending session/turn/dispatch attempt. A late failure cannot overwrite a newer retry or completion.
- Normal completion and authorized-action fallback completion use the same lock and exact active pending predicates. An action whose assistant completion insert fails rolls back before the locked fallback stores a truthful no-change result.
- Process-loss test doubles now implement the awaited Drizzle query shape, so reconciliation is actually executed rather than failing with `pending is not iterable`.

## Verification

- Dependency install: `pnpm install --frozen-lockfile` passed (expected Windows package-bin warnings only).
- Focused tests ran under task-local Node `20.20.2` because host Node `22.23.2` rejects the Drizzle ESM cycle before Vitest collection. Node 20 is supported by the repository.
- Focused command with `BOOK_STUDIO_POSTGRES_TEST_URL=postgres://postgres@127.0.0.1:55451/postgres`: 4 files passed, 32 tests passed, zero skipped.
- Real PostgreSQL race probes: 3 passed:
  - two concurrent retry claims produce one claim and one conflict;
  - retry waits for a lock holder that commits a newer human message, then rejects the stale retry;
  - a late failure for an old dispatch attempt waits for the lock and cannot overwrite a newer pending attempt.
- PostgreSQL binary: `PostgreSQL 17.10` from `C:\Users\tyler\PostgreSQL-Active\pg17\pgsql\bin`.
- Isolated cluster: `C:\pcv5c-test\postgres17-data`, trust auth, loopback-only `127.0.0.1:55451`; test databases were created and dropped by the suite. The cluster was stopped with `pg_ctl stop -m fast`; `pg_ctl status` reported no server and no listener remained on port 55451.
- `pnpm --filter @paperclipai/db typecheck`: passed, including migration numbering.
- `pnpm --filter @paperclipai/server typecheck`: passed.
- `pnpm --filter @paperclipai/ui typecheck`: passed.
- `pnpm typecheck`: passed for all 25 included workspace projects.
- `pnpm build`: passed for all 25 included workspace projects, including the production UI build.
- `git diff --check`: passed.
- `pnpm check:tokens` and a focused credential-pattern scan of every changed file: passed with no matches.

## Baseline limitations

- A broad, single-invocation run of all 23 Book-named server suites produced 234 passes and four failures in unrelated legacy tests: chapter generation timeout, legacy chat normalization mock returning no rows, export timeout, and rename mock returning 500.
- The same four files fail when run individually from a disposable untouched `050d8a80` worktree, including the same chat, export, and rename failures and chapter-generation timeouts. They are pre-existing baseline failures, not introduced by this correction, and were not changed under the frozen packet.
- Direct Vitest on host Node 22.23.2 still collects zero affected tests because of `ERR_REQUIRE_CYCLE_MODULE` in Drizzle. The verified Node 20 command is required on this host until the runtime/dependency loader issue is corrected separately.

## Rollback

Revert the single correction commit that contains this checkpoint. No migration or production rollback is required because this correction changes only Book Studio route logic, tests, and documentation.
