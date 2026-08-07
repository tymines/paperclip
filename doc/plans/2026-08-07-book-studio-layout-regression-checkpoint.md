# Book Studio layout regression checkpoint — 2026-08-07

## Authority and lineage

- Repository: `https://github.com/tymines/paperclip.git`
- Verified base: `origin/master` at `59b20fb0c00087d4ff9f054479127cc8450693b8`
- Feature branch: `codex/book-studio-prose-scroll-fix-20260807`
- Implementation commit: `9b1f0da47832bbf845d6044efad15c3a0dffe106`
- Worktree: `C:\Users\tyler\Documents\Codex\2026-08-07\book-studio-prose-scroll-fix\work\paperclip-book-studio-prose-scroll-fix`

## Accepted behavior

1. The desktop left rail has separate Chapters and Story Bible modes; the chapter queue is never stacked above the complete Story Bible.
2. The Story Bible exposes Overview, Characters, Locations, Style, Lore, Factions, Objects, Systems, Timeline, Threads, Themes, Glossary, Relationships, Facts, and Review Queue.
3. The chapter Bible tab opens the page-owned complete Story Bible rather than a smaller embedded subset.
4. Run Plan and Review are visible at laptop-sized internal widths; compact tools remain available below that breakpoint.
5. The prose editor uses the remaining workspace height and owns the only vertical manuscript scrollbar.
6. No live application, release directory, service, data, credentials, or provider state is changed by this branch.

## Verification evidence

- Focused Vitest: 5 files, 23/23 tests passed.
- UI typecheck: passed.
- Production UI build: passed (existing chunk-size and dynamic-import warnings only).
- `tests/e2e/book-studio-regression-geometry.mjs`: passed at 1280x800, 1366x768 with a 208px app sidebar, 1440x900 with a 240px sidebar, 1093x614 with a 208px sidebar, and 430x932.
- Geometry assertions cover horizontal overflow, header clipping, Run/Review and compact-tool breakpoints, mutually exclusive rail modes, all 15 Story Bible labels, manuscript height, and editor-only vertical scrolling.
- `git diff --check`: passed.

## Limits and release status

- Geometry evidence uses the production-built stylesheet and a deterministic browser fixture; it is not an authenticated production screenshot.
- No live canary, server/API integration, mobile software-keyboard test, push, merge, or deployment has been performed.
- Live release remains `59b20fb0`; deployment requires a separate explicit release action after immutable review.
