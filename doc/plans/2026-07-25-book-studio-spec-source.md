# Book Studio — Spec v1 (Consolidated, Single Source of Truth)

**Author:** Ares · **Date:** 2026-07-24 · **Stage:** Design complete → Build (Hermes) next → Review (Ares) against every row herein
**Amendment v1.1 (2026-07-24, Tyler feedback):** decision controls renamed from the operator's seat + the full review-decision flow made explicit (§6) · sources & foundation documented (§0)
**Amendment v1.2 (2026-07-24, Tyler correction — user model reframed):** **Baily is the USER/author who operates the tab; Tyler is the developer building it and never uses it himself.** Every human-in-the-loop control is from Baily's seat; "you" in every UI string = Baily. Baily is NOT a critic AI — she's the author who writes with AI assistance, reviews, locks chapters, directs revisions, and is the sole decider. Nothing in the tab routes to Tyler.
**Amendment v1.3 (2026-07-24, Tyler confirm — Story Bible codex expansion made explicit):** the loom-plan bible model is now spelled out in §4.1 — all ~12 entity types enumerated, relationships as typed data, facts as structured records with `known_as_of` spoiler-gating (not prose blobs). All four were design targets since v1; v1.3 makes them buildable.
**Supersedes/folds in:** Director's Deck design doc + mockup · 53-feature parity checklist · Review Workflow rework · LOCK Feature Spec · Redesign v1 (earlier look/feel pass — visual language absorbed)
**Upstream inputs:** Book Studio — Build Spec v1 (2026-07-19) · Current State Audit (2026-07-19) · `book-studio-loom-plan` · locked v2 mockup ruling · live tab + source audit 2026-07-24
**Mockup:** `augibot2:/Users/augibot2/book-studio-directors-deck/Book Studio — Director's Deck Concept.html` — interactive, self-contained; Playwright **67/67 PASS** + **13/13 lock checks**, zero console errors, no overflow at 1600px or 390px
**Evidence:** `…/book-studio-directors-deck/evidence/` (walkthrough-annotated.png, d01–d06 incl. lock shots) · source basis `~/paperclip` @ `edf15e7`, live bundle string-verified

---

## 0. Sources & foundation — what this redesign is built on

This spec does NOT start fresh. It consolidates and builds directly on the prior Book Studio research:

| Source doc | What it contributed | Where it lives in this spec |
|---|---|---|
| **`09 - Book Studio/_Build Specs/Book Studio — Build Spec v1 (2026-07-19).md`** — the competitor research + issues analysis | The feature set being designed to: ~12 bible entity types, spoiler-gated atomic facts, 8-dim rubric, writer/critic separation, PASS/FAIL/NO_VERDICT, Director Mode levels, Run Plans, beats-as-steering, exception-based review, bible auto-extraction review queue, consistency engine. Its issues analysis (T0-x defects in the current tab) is the fix list. | §4 improvements table · §3 parity rows · fixes mapped below |
| **`book-studio-loom-plan`** (technical build plan) | The data-model ground truth: `locked` columns exist but are never read · `human_locked` frontmatter written-never-read · note offset fields already in schema · the phased build order (T0 fixes → T1 core → T2 consistency engine) | §7 LOCK wire-up · §5 review rework schema deltas |
| **Current State Audit (2026-07-19)** | The existing-tab feature inventory baseline | §3's audit (re-verified + extended 2026-07-24) |
| **Locked v2 mockup ruling** (`concept-mockup-v2.png`) | The approved base layout + visual language | §1 Concept, §2 Layout map |
| **Live tab + source audit (2026-07-24)** | 53-feature parity audit @ `edf15e7` + live bundle string-match | §3 parity contract, §5 current truth |

**Identified issues from that research → where each is fixed here:**

| Prior-research issue | Fix in this spec |
|---|---|
| T0-7: *Suggest Rewrite* Accept is broken (writes into the note, never the manuscript) | §5.E — decoy removed; notes get **Send to revision** → diff proposal → real commit path |
| Autopilot `critiquing` / `revising` phases declared-but-dormant; only quality control is a <350-word redraft guard | §5.B — `critiquing` wired to the automatic baseline pass (different model); `revising` fires only on directed jobs |
| Review notes are passive storage; nothing consumes them | §5.C/E — notes become first-class (provenance/status/anchors) and actionable |
| Review button is a vestigial status-pill toggle, no-op unless Autopilot | §5.A — gate deleted; Review always available, all modes, with scope picker |
| Six-tab bible pane cannot hold ~12 entity types | §3 row 15 — 12 sections + Overview via rail → center Bible view |
| `locked` field never read (loom-plan); manuscript has no lock at all | §7 LOCK — enforcement on every AI write path + chapter/passage locks |
| Consistency engine unbuilt (T2) | §3 row 10 — designed in Export sheet, hidden until T2 implements it |

---

## 1. Concept

**User model (v1.2 — the frame everything else hangs on):** **Baily is the user.** She is the author — she writes with AI assistance, reviews, locks chapters, directs revisions, and makes every decision. **Tyler is the developer** building the tab for her; he never appears in its flows and nothing routes to him. The AI (writer/critic pipeline) assists Baily and escalates hard calls **to Baily**. Every "you" in the UI = Baily, the author.

*Baily directs, agents draft. Beats are the steering wheel, the gate is the quality wall, and only exceptions reach Baily.*

The Director's Deck — a direct evolution of the locked v2 layout Tyler approved (chapter queue rail · beat workspace · quality inspector), same dark palette (`--bg #0b0e13`, Inter, blue/green/amber/red states). **Hard rule: every feature in the current tab is retained — nothing is dropped** (§3 is the contract). Three always-visible surfaces so *what failed, why, and what Baily decides* is one glance away.

## 2. Layout map

- **Top bar** — book switcher + cover thumb + New Book · live status (`7 ready · 2 working · 1 exception`) · **Director Mode dial** (Co-writer·1 / Chapter·2 / Act·3, per-book) · Taste · Run Plan · Brainstorm ✦ · Media 🎬 · Export
- **Left rail** — Manuscript queue (gate dots + rubric score + summary chips + 🔒 markers) · Story bible (Overview + 12 canon sections, readiness dots, locks) · Review queue inbox w/ proposal count
- **Center workspace** — chapter header w/ structure chips (POV, target words, tension, cast, locations) · **stage track** (Compile→Draft→Critique→Revise→De-AI→Canon→Gate, clickable) · four views: **Beats** (editable steering cards + AI-proposed insertions) · **Prose** (editor: streaming draft, Mark Done, Annotations, Preview, Focus, autosave) · **Context** ("what the writer saw" — consulted entities + spoiler-gated facts as withheld/author-only chips) · **Bible** (entity browser). Bottom bar: **Your call** (your pending decisions — §6) · Draft (Fast | Craft) · Re-run gate
- **Right inspector** — **Gate** (PASS/FAIL/NO_VERDICT, writer/critic provenance, exception card w/ jump-to-beat + diff-proposal fix + **Needs your decision** escalate, budget guard) · **Rubric** (8 dims, thresholds, failures red) · **Notes** (CRUD + category filters + ✦rewrite→diff) · **Canon** (relationship meters, arc rules, context consulted)
- **Overlays** — decision card (in-app + Slack + mobile-sheet) · diff proposal (old strikethrough/new green, accept→commit) · Run Plan approval (beats, arc moves, threads, POV schedule, token+budget estimate) · bible review queue (approve/reject) · Taste profile sheet · Brainstorm drawer (chapter-scoped) · Media drawer (Cover/Illustrations/Trailer/Narration/Library) · Export sheet (4 formats + consistency engine) · narrate estimate
- **Mobile** — rail & inspector become bottom sheets (☰ Chapters & bible / ◇ Quality) · decision cards full-width above thumb zone · fixed bottom action bar

## 3. Feature-parity checklist — the anti-drop contract

*Audited 2026-07-24 from source (`BookWritingPage.tsx` 2,721 lines + 6 components + server routes) and the live instance (Emberfall Academy 10ch/16,119w · Talonsworn 25ch/44,858w · Hecate's Legacy). ✅ = rendered in mockup · 📄 = documented design target (Build implements, Review checks).*

| # | Current feature | New home | Mock |
|---|---|---|---|
| 1 | Book switcher (3 books) | Top bar select | ✅ |
| 2 | Cover thumbnail in header | Top bar | ✅ |
| 3 | + New Book | Top bar | ✅ |
| 4 | Autonomy dial Manual/Assisted/Autopilot (per-book) | Director Mode dial (same control, renamed) | ✅ |
| 5 | Autopilot status pill + Live badge + phase | Status line + per-chapter dots + stage track | ✅ |
| 6 | Pause / Resume autopilot | Chapter state + decision cards pause one chapter, not the run; run-level in Run Plan sheet | 📄 |
| 7 | Steer (guidance → autopilot) | Chapter-scoped Brainstorm + Run Plan "edit beats first" (steering lands as beats) | ✅ |
| 8 | Review (jump to reviewing) | Gate tab — exceptions surface automatically | ✅ |
| 9 | Brainstorm chat + history + →draft | ✦ drawer (chapter-aware, persistent, draft chips) | ✅ |
| 10 | Check Consistency | Export sheet → Consistency engine (hidden until T2 implements) | ✅ |
| 11 | Narrate Book (estimate→confirm→MP3) | Export → Audiobook + Media → Narration | ✅ |
| 12 | Export modal (MD/EPUB/PDF/Audiobook) | Export sheet | ✅ |
| 13 | Mobile ⋯ overflow + pane switcher | Mobile bottom sheets + view tabs | ✅ |
| 14 | Readiness bar (Chars/Locs/Style/Outline) | Rail `readiness 8/12` + per-section dots | ✅ |
| 15 | Six bible tabs → 12 sections + Overview | Rail rows → center Bible view per section | ✅ |
| 16 | Overview: title + premise edit | Bible → Overview card | ✅ |
| 17 | Danger zone: delete book (type-title confirm) | Bible → Overview danger zone | ✅ |
| 18 | Manuscript summary (word counts/coverage) | Bible → Overview "Chapter word counts" | ✅ |
| 19 | Characters CRUD + inline edit + delete confirm | Bible → Characters cards | ✅ |
| 20 | Character lock/unlock | 🔒 on card + rail row (see §7 LOCK) | ✅ |
| 21 | Character AI icon gen (+ custom prompt, icon lock) | 📷 Icon per card | ✅ |
| 22 | "Generate with AI" drafts (accept/discard) | ✦ Generate with AI per section | ✅ |
| 23 | Source badges (authored/co-created/imported) | Badge per card + `auto` in review queue | ✅ |
| 24 | Locations CRUD + image gen + lock | Bible → Locations (same card pattern) | 📄 |
| 25 | Style: POV/tense/comps/sample/banned/tropes | Bible → Style (banned clichés feed De-AI pass) | 📄 |
| 26 | Cover generation from style card | Media → Cover | ✅ |
| 27 | Outline: chapter cards, beats JSON edit, lock, delete | Chapter queue + Beats view (cards first-class; JSON in overflow) | ✅ |
| 28 | Outline: Add Chapter | Chapter queue header + | 📄 |
| 29 | Outline: "Generate with AI" multi-chapter beats | Proposed-beat recommendation strip | ✅ |
| 30 | Scene illustration per chapter | Media → Illustrations (per-chapter + custom prompt) | ✅ |
| 31 | Collapsible sections w/ counts | Rail groups | ✅ |
| 32 | Chapter selector + title + word count | Chapter queue + prose status bar | ✅ |
| 33 | AI Draft/Redraft (SSE, cancel, fallback, overwrite flag) | Draft split Fast/Craft; streaming + cancel in Prose | ✅ |
| 34 | Mark Done (assisted parking) | Prose toolbar | ✅ |
| 35 | Annotations (span-anchored, add/list/jump) | Prose 💬 + highlighted spans; click → jump + select | ✅ |
| 36 | Preview/Edit markdown toggle | Prose ◫ Preview | ✅ |
| 37 | Focus mode | Prose ⛶ | ✅ |
| 38 | Autosave (2s) + save status + error surface | Prose status bar + banner | ✅ |
| 39 | Autopilot live-refresh (8s poll, no clobber) | Live dot; silent unless chapter dirty | 📄 |
| 40 | Jump-to-chapter + highlight from notes | Note meta jump; Gate "Open flagged beat →" | ✅ |
| 41 | Review notes CRUD + 5 category filters | Notes tab (All/Pacing/Character/Plot/Prose/Consistency) | ✅ |
| 42 | Suggest Rewrite (diff, Accept/Reject) | ✦ rewrite → diff sheet → commit via prose-writer path — **fixes the broken Accept (T0-7)**; see §5 | ✅ |
| 43 | Notes panel collapse w/ count | Tab badge; inspector collapses <1050px | 📄 |
| 44 | Media: Cover (gen/regen, prompt, lock, job status) | Media → Cover | ✅ |
| 45 | Media: Illustrations | Media → Illustrations | ✅ |
| 46 | Media: Trailer (model pick, playback) | Media → Trailer | ✅ |
| 47 | Media: Narration (voice, per-chapter, stitch) | Media → Narration | ✅ |
| 48 | Media: Library (filters, download, set-as, durable localUrl) | Media → Library | ✅ |
| 49 | Assisted Mode panel (Suggest Next) | Evolved into per-section reco strips + Mark Done parking | ✅ |
| 50 | Narrate estimate/complete/error dialogs | Narrate sheet | ✅ |
| 51 | Error boundaries (per-pane) | Unchanged in build | 📄 |
| 52 | Amber "no provider keyed" honesty states | Media drawer amber note; pattern extends | ✅ |
| 53 | Toasts for async job states | Toast system | ✅ |

**Parity statement:** all 53 features have an explicit home. 📄 items (6, 24, 25, 28, 39, 43, 51) are documented targets — Build implements them, Ares reviews each row.

## 4. Spec improvements → where they landed

~12 bible entity types + relationships + atomic facts with `known_as_of` spoiler gating (Context view) · character depth (want/need/wound/lie, aliases, voice) · relationship arcs/meters/rules as gate constraints · 7-stage multi-pass pipeline (stage track) · 8-dim rubric scorecards · writer/critic separation with provenance (writer Gemini · critic DeepSeek — Claude excluded, Tyler's ruling) · PASS/FAIL/NO_VERDICT (NO_VERDICT halts + surfaces) · Fast vs Craft draft · diff-proposal flow (notes rewrites + gate fixes route through it) · consistency engine (Export sheet) · Director Mode 3 levels + Run Plans + budget guard · beats as the steering surface · exception-based review (passing chapters queue silently) · decision cards (in-app + Slack + mobile) · bible auto-extraction review queue (contradictions never silently overwritten) · import from manuscript · per-chapter structure fields · visible/editable TasteProfile · rolling storySoFar in the Context packet · live click-through QA before "done".

### 4.1 Story Bible — the codex expansion (loom-plan data model, made explicit)

*The current bible holds 4 loose entity types as prose blobs. The codex expansion (Build Spec v1 2026-07-19 + `book-studio-loom-plan`) grows it to a structured canon store. All four of Tyler's core additions are specified here; Build implements to this, Review checks against it.*

**① The fuller entity model — 12 entity types.** Characters · Locations · Lore · Factions · Objects · Systems (magic/tech rules) · Timeline (events) · Threads (promises/setups + payoff state) · Themes · Glossary (terms) · **Relationships** · **Facts**. Each is a rail section with readiness dots + locks (§2), opening into the center Bible view (§3 row 15). Overview/Style/Outline remain as non-entity bible surfaces (parity rows 16, 25, 27). Every entity is a typed record with its own fields (e.g. characters add want/need/wound/lie, aliases, structured voice) — never one prose blob.

**② Relationships between entities — typed data, first-class.** A relationship is a record: `{ fromEntity, toEntity, type, arc stage, meter (−100…+100), rules[] }` — any entity pair, not just character↔character. Surfaced in the Relationships bible section + the Canon inspector meters; **arc rules are gate constraints** (the gate can FAIL a chapter that violates a relationship rule, §6.3 flow).

**③ Facts as structured data — not prose blobs.** A fact is an atomic record: `{ statement, entityRefs[], known_as_of (chapter), source (chapter/scene), provenance (authored | co-created | auto-extracted), locked }`. Facts attach to entities by reference, are individually lockable (§7 — a locked fact can't be touched by the AI without Baily's unlock), individually editable, and flow through the bible review queue when auto-extracted (never silently overwritten).

**④ Spoiler-gating.** Every fact carries `known_as_of` = the chapter where it becomes known in-story. When the writer compiles context for chapter N, **only facts with `known_as_of` ≤ N enter the packet**; withheld facts never reach the model. The Context view ("what the writer saw") shows consulted entities + withheld facts as *withheld/author-only* chips so Baily can audit the gating (§2 center). Same rule applies to the critic's fact-check and the consistency engine.

## 5. Review workflow — current truth + rework

**Current truth (source-verified @ `edf15e7`, live bundle string-matched):** ① Review notes are passive storage — JSONB CRUD on `books.metadata.reviewNotes`; nothing consumes them (`book-context-compiler.ts` never reads them); *Suggest Rewrite* is a decoy (edits the note's own text via brainstorm chat, never the manuscript). ② The Review button is a vestigial status-pill toggle — no-op unless Autopilot, and even then only `setAutopilotState("reviewing")` local React state. ③ Autopilot's `critiquing`/`revising` phases are declared-but-dormant; the only quality control is a <350-word redraft guard. One good invariant: autopilot never overwrites non-empty prose.

**Rework (the operating model — Baily's seat):**
- **A.** Review always available in all three modes; the `autopilotMode` gate is deleted. Scope picker: this chapter (default) · pick a chapter · whole book (per-chapter critiques + cross-chapter canon pass, one report).
- **B.** One automatic pass on every landed draft, pre-human: quality rubric + story-bible fact-check with cited entities. **Annotates and scores only — never rewrites.** Pass → queues silently; fail → exception in the Review queue. (Wires up `critiquing`, run by a different model than the writer; `revising` stays dormant until Baily directs it.)
- **C.** Critiques accumulate as first-class notes — upgraded with provenance (`baily` = the author's own notes / `ai-critic` = the pipeline's), status (open/resolved), passage anchors (offsets already in schema).
- **D.** AI revises ONLY when Baily directs (she is the author and the sole decider; §6): chapter scope · passage scope (offsets) · canon-fix scope. Every revision returns a **diff proposal → Baily Accepts/Rejects**; accept writes through `persistChapterProse` + activity log. The never-overwrite invariant extends: the AI never writes outside an accepted proposal.
- **E.** Notes become actionable: **"Send to revision"** creates a directed job scoped to the note; the decoy *Suggest Rewrite* is removed.
- **API delta:** `POST …/books/:id/review` · `POST …/books/:id/revisions` · `POST …/revisions/:id/accept|reject` · notes schema +`provenance`, `status`, `linkedRevisionId?`.
- **State machine:** `drafted → baseline-check (auto) → [pass: queued | fail: exception] → critique notes accumulate → directed revision → diff proposal → accept/reject → re-run baseline → …` **The AI writes and checks; Baily critiques, directs, and commits — she's the only decider** (§6).

## 6. Review-decision flow — who decides what (v1.1, corrected v1.2)

*Every human-in-the-loop control is from **Baily's seat** — she is the author/operator. The controls are named from her perspective: "you" in the UI always means Baily. Nothing routes to Tyler; he is the developer, not a user, and has no in-tab role.*

### 6.1 The two controls, renamed + defined

| Control (was → now) | Where | What it does |
|---|---|---|
| ~~Ask Tyler~~ → **Your call** | Center bottom bar, always visible | Opens **Baily's decision inbox** — every pending decision card across the book (canon conflicts, lock conflicts, budget trips, NO_VERDICTs), newest first. Badge shows the pending count. Purely an inbox: nothing here is decided until Baily picks an option. |
| ~~Ask Tyler to decide~~ → **Needs your decision** | Gate exception card (right inspector) | Escalates *this specific exception* into a decision card **to Baily**. The chapter pauses (the run does not), the card lands in the **Your call** inbox **and** is pushed to Slack + mobile — Baily answers from any surface, all three resolve together. Until she answers, the chapter holds; nothing auto-resolves, ever. |

### 6.2 Who decides what — the authority table

| Actor | Can do | Can NEVER do |
|---|---|---|
| **Writer AI / critic AI** (the pipeline models) | Draft, run stages, score the rubric, fact-check, flag issues, write critique notes, propose diffs — and argue a position on a decision card with rationale | Decide. Commit anything. No writes outside an accepted proposal; no accepting/rejecting, unlocking, bible edits, or card resolutions. |
| **Baily** — the author, the only decider | Write with AI assistance · accept/reject every diff · answer every decision card · direct revision jobs (chapter / passage / canon-fix scopes) · lock/unlock anything · approve/reject bible review-queue proposals · approve Run Plans + budgets · resolve canon-vs-bible conflicts | — |
| **Tyler** — the developer | Builds and maintains the tab | Is not a user. No control routes to him; nothing in the tab's flows references him. |

*Default is Baily-only on every commit. If she later wants the pipeline to auto-accept within narrow limits (e.g. typo-class fixes under N words), that's a per-book delegation toggle — currently OFF and listed as open decision #5 (§8).*

### 6.3 The hard-problem flow (example: canon violation vs a locked bible fact)

The gate FAILs chapter 8: Kaelen's concealment violates the locked bible fact *"incapable of subterfuge" (ch.2)*. A hard constraint — not advisory. Three routes, all surfaced on the exception card **to Baily**:

1. **Review suggested revision (diff)** — the critic's proposed prose fix, conforming to the bible. Baily Accepts → commits through the diff path · Rejects → chapter holds.
2. **Propose a bible-fact edit** — if the *fact* is what's wrong, the fix routes to the bible review queue as a proposal. A **locked** fact can't be touched by the AI at all — editing it requires Baily's unlock first (§7). Never silent, never auto-applied.
3. **Needs your decision** — escalate to Baily. The decision card presents the options *with consequences*: *Tell the truth publicly* (canon-safe, raises danger, fires the ch.5 promise thread) · *Refuse to answer* (canon-safe, preserves the reveal) · *Allow the contradiction* (marked intentional growth — lands in the review queue as a proposed fact edit, logged, never silent).

**Escalation means:** this chapter pauses (run continues elsewhere) · card in-app + Slack + mobile for Baily · chapter holds until she picks · every outcome is activity-logged.

### 6.4 What always escalates to Baily (no auto-resolution)

Canon conflict involving a **locked** fact or entry · **NO_VERDICT** (missing/stale evidence — halts, surfaces, never silently passes) · budget guard trip · lock conflict on any write path (§7's Locked-Content card) · a chapter FAILing after its iteration cap · any bible contradiction (review queue, never silent overwrite).

**One line:** *The AI writes and checks. Baily critiques, directs, and decides. Nothing routes to Tyler — he's the developer.*

## 7. LOCK — Baily's safeguard

**Rule: locked = protected. The AI skips or asks, never clobbers — even on a directed revision.**

**Current-state truth (source-verified):** `locked` columns exist on outline chapters + every bible entity (working UI toggles) but **no AI write path reads them** except beats-revise; manuscript prose has no lock at all (`human_locked` frontmatter written at `book-prose-writer.ts:27`, never read — today's only protection is the blunt `?overwrite=1` proxy); media locks (cover/icon/image) genuinely work and are the pattern to generalize.

**Four rules:** ① Locked = protected at every granularity — checked before generating *and again before persisting* (TOCTOU); refusal = HTTP 409 `LOCKED`. ② Directed revision is not exempt — locked target → skip-and-report (in a run) or ask (single target → decision card); the accept path re-checks. ③ Only Baily locks/unlocks (the human author — never an AI actor); every change activity-logged. ④ Locks compose — chapter lock covers prose + beats + its passage locks; passage lock covers its span; bible locks cover entry fields; media locks unchanged.

**Data model:** add `manuscript_chapters.locked` (migration reads existing `human_locked` frontmatter; one switch also gates the chapter's outline/beats row) · new span-anchored `passage_locks` table (same re-anchoring as annotations) · bible entries: enforcement only, no schema change.

**Enforcement matrix (every AI write path):** autopilot draft→persist (skip + report) · draft/SSE/redraft incl. `?overwrite=1` (409 — overwrite does **not** bypass a lock) · beats revise (align to 409) · directed revision chapter/passage/canon scopes (decision card / exclude locked spans / exclude locked entries) · diff-proposal accept (re-check at accept) · bible generate-accept + review-queue approve (skip, flag "locked — left unchanged") · canon auto-extraction (never silently overwrite) · baseline pass §B (read-only, unaffected).

**The "ask" — Locked Content decision card:** *Keep locked—skip* (default) · *Unlock* · *One-time: unlock → apply → re-lock* (scoped, logged, never standing). In-app + Slack + mobile.

**API delta:** `PATCH …/chapters/:n/lock` (human-actor guard, logged) · `POST/DELETE …/chapters/:n/passage-locks` · AI endpoints return `409 {code:"LOCKED", scope, message}` → UI maps to the card · directed revision on locked target returns `200 {status:"needs-decision", decisionCard}`.

**UI (live in mockup, 13/13 Playwright-verified):** 🔒 badge in chapter queue (click = unlock + toast) · 🔓/🔒 toggle beside chapter title + dek state line · **🔒 Lock passage** in prose toolbar (locked spans: 🔒 gutter marker + amber tint) · Draft Fast/Craft refuse locked chapters with an honest ⛔ toast · lock color = amber (a state, not an error).

**Review-workflow interaction:** baseline pass stays read-only (locks never block checking) · critiques accumulate normally · "Send to revision" on locked content routes to the decision card · whole-run context: locked units skipped + reported, never silent.

**Acceptance criteria (Ares reviews Build against every row):** 1. Locked chapter × {autopilot, draft, SSE, `?overwrite=1`, directed revise, diff-accept} → no write, 409/skip + visible report. 2. Revision overlapping a locked passage → proposal excludes span or asks; accept never writes it. 3. Generate-accept/queue-approve on locked entry → unchanged + flagged. 4. No AI actor can set/clear a lock (route guard + test); all lock changes in activity log. 5. Queue badge, header toggle, passage control present; no silent skips anywhere. 6. Regression: unlocked behavior byte-identical to today.

## 8. Open decisions (spec-level — for Tyler as the developer building this for Baily)

1. **Raw-JSON beat editing** — keep in beat overflow for power users, or cards-only?
2. **Check Consistency placement** — Export sheet (as designed) vs a Gate-tab section once T2 makes it real.
3. **Live token-stream peek** during long craft runs, or silence until the gate?
4. **`?overwrite=1` does not bypass locks** (Ares's judgment call — override if you disagree).
5. **Pipeline auto-accept delegation (§6.2)** — keep the default (the AI directs and proposes, never commits; Baily accepts every diff), or grant the pipeline a narrow per-book auto-accept scope (e.g. typo-class fixes under N words)? Default = OFF.

---

*Build handoff: this spec + the mockup HTML + evidence PNGs. Review (Ares) checks every row of §3, §5's API delta, and §7's acceptance criteria against the build.*
