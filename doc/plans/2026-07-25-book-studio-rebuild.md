# Book Studio rebuild — offline implementation plan

**Version:** 1.0
**Date:** 2026-07-25
**Owner:** Hermes Build / SOL Box 1
**Integration branch:** `book-studio-rebuild-20260725`
**Base:** `edf15e7a3f4ba74100865c1efe68eb78e492472d` (the exact 2,721-line Book Studio baseline audited by the canonical spec)
**Deploy:** FORBIDDEN. Tyler reviews before any deploy.

## Canonical inputs

- `doc/plans/2026-07-25-book-studio-spec-source.md`
  - Vault path: `09 - Book Studio/_Build Specs/Book Studio - Spec v1 (2026-07-24).md`
  - Body: 217 lines, 27,372 Unicode characters, 28,069 bytes
  - SHA-256: `2f0a839e370d4fa5bd90b322989fcdf72fee5424642966c3a571f2223621be65`
- `doc/plans/2026-07-25-book-studio-redesign-source.html`
  - Vault path: `09 - Book Studio/_Build Specs/Book Studio - Redesign v1 (2026-07-24).md`
  - Body: 818 lines, 49,114 Unicode characters, 49,379 bytes
  - SHA-256: `f3762232c47f31a768384ccaec7c71e6fdf999d3f1dfc03381fe408044e769df`

The consolidated spec is authoritative where the older redesign source differs.

## Build order and lane boundaries

1. **Review workflow + Locks — usable core first**
   - Backend lane owns DB/shared/server changes and tests for review, revisions, diff acceptance, chapter/passage locks, human-only lock changes, activity logs, and lock enforcement across every AI write path.
   - UI lane owns the Director's Deck surface for Review/Gate/Notes/decision cards plus chapter/passage lock controls and honest lock conflict states.
2. **Story Bible codex**
   - Story backend lane owns typed entities, relationships, atomic facts, provenance, locks, `known_as_of`, spoiler-gated context compilation, company-scoped APIs, and tests.
   - UI lane owns Overview + 12 entity sections, typed relationship/fact editors, readiness/lock states, and Context audit chips for consulted/withheld facts.
3. **Director's Deck integration and 53-feature parity**
   - UI lane retains every feature in §3 of the canonical spec while reorganizing them into the new layout.
4. **Integration + QA**
   - Merge worker commits into the integration branch.
   - Resolve only mechanical registration/migration conflicts.
   - Run targeted tests first, then `pnpm -r typecheck`, `pnpm test:run`, and `pnpm build` with `BOOK_STUDIO_VAULT_ROOT` pointed at a temporary quarantine.
   - Produce a 53-row parity report and §7 lock acceptance evidence.

## Non-negotiable behavior

- Baily is the author/operator and only decider. Tyler is never a user or in-product destination.
- Writer/critic AIs may draft, score, flag, and propose; they never commit or resolve decisions.
- All revisions are diff proposals; accept rechecks locks and persists through the canonical prose path.
- `locked` is enforced before generation and immediately before persistence. `?overwrite=1` never bypasses a lock.
- Locked chapters cover prose + beats + passage locks. Locked bible facts/entities cannot be mutated by AI.
- `NO_VERDICT` halts and surfaces; it is never treated as PASS.
- Facts with `known_as_of > chapter N` never enter writer, critic, or consistency context for chapter N.
- No deploy, no PR, no board/API auth checks, no `/agents/me`, no Paperclip board operations.
- Strict TDD: tests must fail for the intended missing behavior before production code is added.

## Dispatch ledger

| Worker | Branch / worktree | Why this exceeds one session | Scope | Artifact pointer |
|---|---|---|---|---|
| Codex backend-core coder | `work/book-studio-review-locks-20260725` · `/Users/augi/paperclip-worktrees/book-studio-review-locks-20260725` | Cross-layer migration + shared contracts + multiple write-path enforcement + route/service tests cannot be safely completed as a solo-sized edit | Review workflow and Locks backend only | Worker commit(s), targeted test transcript in `artifacts/book-studio/worker-review-locks.txt` |
| Codex story-codex coder | `work/book-studio-story-bible-20260725` · `/Users/augi/paperclip-worktrees/book-studio-story-bible-20260725` | Twelve typed entity classes, graph relationships, atomic facts, spoiler-gated compilation, APIs, and tests form an independent multi-layer package | Story Bible backend only | Worker commit(s), targeted test transcript in `artifacts/book-studio/worker-story-bible.txt` |
| Codex UI coder | `work/book-studio-ui-20260725` · `/Users/augi/paperclip-worktrees/book-studio-ui-20260725` | The audited UI is 2,721 lines and must retain 53 behaviors while adding responsive Deck, review, locks, and codex surfaces | UI only; no DB/server edits | Worker commit(s), UI verification transcript in `artifacts/book-studio/worker-ui.txt` |

## Integration acceptance

- Review/Locks usable without Story Bible completeness.
- Canonical targeted tests green.
- §7 six lock acceptance rows have non-vacuous tests.
- Twelve entity types are present: Characters, Locations, Lore, Factions, Objects, Systems, Timeline, Threads, Themes, Glossary, Relationships, Facts.
- Relationship records expose from/to/type/arc stage/meter/rules.
- Facts expose statement/entity refs/known_as_of/source/provenance/locked.
- All 53 parity rows have `PASS`, `FAIL`, or `NO_VERDICT` evidence; missing evidence is never PASS.
- Final handoff names branch, commits, exact commands/results, built scope, and staged-next scope.
