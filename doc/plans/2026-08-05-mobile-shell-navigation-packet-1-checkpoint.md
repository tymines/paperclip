# Mobile Shell and Navigation Packet 1 checkpoint

Date: 2026-08-05

## Authority and source state

- Repository: `https://github.com/tymines/paperclip.git`
- Worktree: isolated local feature worktree (operator-local path intentionally omitted)
- Branch: `codex/mobile-shell-navigation-p1-20260805`
- Final integration parent: `d7d78ea3159e763756439faf49f8a2b77b7a2624`
- Published PR head before this checkpoint-only correction: `4be432caae794e72b21179ce505f4c89b2112ad5`
- The two implementation commits were replayed cleanly onto the final integration parent. No conflicts or overlapping user edits were present.

## Delivered contract

- The mobile top bar always exposes the 44 by 44 sidebar trigger, including routes with no breadcrumbs and routes supplying a custom mobile toolbar.
- The mobile sidebar is a labelled modal drawer: focus enters it, Tab and Shift+Tab remain inside it, Escape and backdrop close it, focus returns to the opener, and the application pane, bottom navigation, skip link, and backdrop are removed from background keyboard/accessibility interaction while open.
- The layout locks document scrolling and makes mobile `main` the single vertical scroll owner. Bottom-navigation visibility observes that element with a passive listener. Mobile content receives bottom-navigation and safe-area clearance.
- The bottom navigation is viewport-bounded, safe-area aware, exposes five 44-pixel-minimum targets, and becomes inert while hidden or blocked by the drawer.
- Controlled mobile `PageTabBar` instances render an accessible full-width select; uncontrolled instances retain Radix tab semantics inside a horizontal overflow owner. Desktop retains the existing tab-list path.
- The toast viewport clears the bottom navigation and safe area on mobile without introducing horizontal overflow; its desktop placement remains unchanged.

## React quality review

- No component definitions were added inside render functions.
- New effects have primitive/stable dependencies and complete cleanup: animation frame cancellation, document keydown removal, focus return, passive scroll-listener removal, and body-overflow restoration.
- The body-lock effect was narrowed to mount/unmount rather than viewport changes. The existing functional sidebar toggle remains unchanged; new state writes do not depend on prior state.
- No duplicate persistent global listener was added. The mobile scroll listener moved from `window` to the actual `main` owner and remains passive.
- No new barrel, heavy eager import, expensive derived state, or unjustified memoization was added. The focusable selector is module-static.
- Accessibility review covers dialog labelling/modality, focus entry/trap/return, Escape, inert background and nav, non-focusable backdrop, labelled select, semantic Radix tabs, and minimum mobile target geometry.
- Review correction preserved the desktop content-wrapper overflow path instead of applying the mobile clipping rule at desktop widths.

## Verification

- `pnpm install --frozen-lockfile`: pass. Windows emitted existing optional plugin SDK `.EXE` bin-link warnings only.
- `pnpm --filter @paperclipai/ui exec vitest run src/components/Layout.test.tsx src/components/BreadcrumbBar.test.tsx src/components/MobileBottomNav.test.tsx src/components/PageTabBar.test.tsx`: pass, 4 files and 15 tests.
- `pnpm --filter @paperclipai/ui typecheck`: pass.
- `pnpm --filter @paperclipai/ui build`: pass. Existing MarkdownEditor mixed dynamic/static import and chunk-size warnings remain.
- `pnpm typecheck`: pass across 25 workspace projects.
- `pnpm build`: pass across 25 workspace projects, with the same existing UI bundle warnings.
- Root `pnpm test:run` was not run locally because the stable project is intentionally split into serialized CI groups. GitHub's required server, workspaces-a, workspaces-b, and four serialized server-suite checks passed on the published head. The merge-train full-suite job passed on its single infrastructure-flake rerun after PostgreSQL cleanup hooks exceeded their timeout on the first attempt.
- `pnpm build-storybook`: pass, with existing third-party `use client`, sourcemap, and chunk-size warnings.
- `git diff --check`: pass.

### Browser evidence

Browser evidence is stored outside the repository in an operator-local temporary evidence directory; the absolute user path is intentionally omitted.

`agent-browser` verified the compiled, static Storybook Search surface at these viewports:

- Phone: 320x568, 375x812, 390x844, 430x932
- Breakpoint/tablet/landscape: 768x1024, 844x390
- Desktop: 1280x800, 1440x900

At all eight widths, `body.scrollWidth` equalled `body.clientWidth`. At phone widths the real controlled `PageTabBar` rendered a full-width select with a measured height of 44 pixels and no tablist. At 768 pixels and above it rendered the existing tablist and no select. A real browser ArrowRight interaction moved focus from the first to the second desktop tab. Screenshots and `search-viewport-geometry.json` are in the evidence directory.

## Limitations and unresolved risks

- A disposable full Paperclip fixture could not start because its brand-new embedded PostgreSQL failed on `CREATE EXTENSION IF NOT EXISTS pg_trgm` during migrations. No existing database or Paperclip home was used.
- Vite preview was rejected after it was found to proxy read-only API requests to an existing local server. Both preview processes and that browser session were stopped immediately; no write request was made.
- The existing compiled `Product/Navigation & Layout` Storybook story fails before rendering with `usePluginLauncherRuntime must be used within PluginLauncherProvider`. A blocker screenshot is preserved as `navigation-story-provider-blocker.png`. Fixing Storybook infrastructure is outside this packet.
- Therefore the full requested route-by-route shell screenshot and desktop geometry-comparator matrix is not claimed. Drawer, scroll-owner, bottom-nav visibility/inertness, hamburger variants, and tab callback behavior are covered by focused tests; responsive PageTabBar and overflow are additionally covered in a real browser.
- The feature branch and PR were published for review. No merge, deployment, live-system mutation, credential change, or external notification was performed by this packet.
