# Book Studio V5 PostgreSQL recovery checkpoint

Status: local implementation checkpoint; not merged, pushed, deployed, or run against a live service.

## Lineage

- Canonical remote verified: `https://github.com/tymines/paperclip.git`.
- Isolated worktree: `C:\Users\tyler\Documents\Codex\2026-08-04\book-studio-v5-postgres-recovery\work\paperclip-book-studio-v5-postgres-recovery`.
- Branch: `codex/book-studio-v5-postgres-recovery`.
- Frozen base: `46dc341998307bf072697a737f10d16027c6c1bb`.
- Source-evidence merge verified locally: `78c56de2fcddfeae010a356597847b0030205f35`.
- `git fetch origin` observed `origin/master` at `826238c0f5cb211c947001f0847f75d511edbb4f`, committed `2026-08-03T23:34:43-04:00`.

## Delivered behavior

- Reserves and persists a UUID dispatch identity before external Calliope dispatch and uses it as the delegation primary key.
- Adds deterministic, per-book locked reconciliation: terminal delegation states are surfaced; indeterminate process loss fails closed without automatic retry.
- Uses the same PostgreSQL advisory transaction lock for send, retry claim, reset, reconciliation, and completion; all terminal writes predicate on active/unarchived pending state.
- Rechecks the most recent active human message inside the mutation transaction.
- Rejects newline and comma-plus-then compound authorization messages while keeping valid single commands.
- Makes book rename/update and its activity record one transaction.

## Verification

- `pnpm install --frozen-lockfile`: passed (Windows package-bin warnings only).
- `pnpm --filter @paperclipai/server typecheck`: passed.
- `pnpm --filter @paperclipai/db typecheck`: passed, including migration-numbering check.
- `git diff --check`: passed.
- Added focused regression coverage in `server/src/__tests__/book-chat-recovery.test.ts`, `server/src/__tests__/book-chat-actions.test.ts`, and `server/src/__tests__/book-studio-chat-v4.test.ts` for scoped recovery, terminal/retryability semantics, compound authorization rejection, and reserved retry delegation IDs. Direct Vitest invocation for these suites could not collect tests due the known Windows Node ESM `drizzle-orm/pg-core/query-builders/select.types.js` require-cycle error; no tests ran.
- Temporary PostgreSQL 17 cluster: `initdb -D ...\postgres-test-cluster -A trust --username=postgres --no-locale --encoding=UTF8`; started only at `127.0.0.1:55439`; migration attempt used test-only `DATABASE_URL=postgres://postgres@127.0.0.1:55439/postgres` and was bounded/terminated after no progress. `pg_ctl stop -m fast` completed and `Get-NetTCPConnection` confirmed no listener on 55439. Log: `C:\Users\tyler\Documents\Codex\2026-08-04\book-studio-v5-postgres-recovery\postgres-test.log`.

## Limitations and rollback

- No live database, credentials, peer service, or external agent was contacted.
- Full migration application and PostgreSQL race integration regressions remain blocked by the bounded migration runner and known Windows Vitest collection cycle; do not treat them as passed. Existing real isolated PostgreSQL advisory-lock coverage remains in `server/src/__tests__/book-locks-race.test.ts`; new Book Studio-specific regression cases are present but uncollected.
- Roll back by reverting this single local commit before merge. The migration is additive (`dispatch_attempt_id` plus unique index); production rollback requires a separately approved database migration plan.
