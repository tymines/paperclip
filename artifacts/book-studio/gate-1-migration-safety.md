# Book Studio Review+Locks — Gate 1 migration safety

**Version:** 1.0  
**Branch:** `work/book-studio-review-locks-20260725`  
**Base WIP:** `4901670ab57e9cb6ebacac1bb9e3b74f452066f6`  
**Verdict:** **PASS**

## Scope

Ares gate blockers only:

1. Register `0157_review_locks.sql` in Drizzle `_journal.json`.
2. Backfill `manuscript_chapters.locked` from legacy `human_locked` frontmatter before enforcing `NOT NULL`.
3. Fail closed for non-empty legacy prose without available frontmatter, so migration cannot silently unlock authored content.
4. Preserve `DEFAULT false` for newly created chapters after the legacy backfill.

## RED evidence

Command:

```sh
pnpm exec vitest run packages/db/src/migrations/0157_review_locks.test.ts
```

Observed before the fix: **FAIL**, 3/3 tests failed:

- journal ended at `idx: 152`, tag `0156_tropes`;
- no ordered backfill existed before `SET NOT NULL`;
- no fail-closed legacy prose branch existed.

Command:

```sh
pnpm --filter @paperclipai/db typecheck
```

Observed before the fix: **FAIL**:

```text
Migration journal/file count mismatch: journal has 153, files have 154
```

## GREEN evidence

```sh
pnpm exec vitest run packages/db/src/migrations/0157_review_locks.test.ts
```

Observed: **PASS**, 1 file / 3 tests.

```sh
pnpm --filter @paperclipai/db typecheck
```

Observed: **PASS** (migration numbering check and TypeScript compile both exited 0).

```sh
pnpm exec vitest run packages/db/src/client.test.ts -t "applies an inserted earlier migration"
```

Observed: **PASS**, 1 passed / 7 skipped. This boots isolated embedded PostgreSQL and applies the complete migration set, exercising `0157` SQL syntax through the real migration runner.

```sh
git diff --check
```

Observed: **PASS**.

## Safety behavior pinned by tests

- `human_locked: true` → `locked = true`.
- `human_locked: false` → `locked = false`.
- Non-empty legacy prose with no readable frontmatter → `locked = true` (fail closed).
- Empty/new rows default to unlocked; the post-backfill column default remains `false`.
