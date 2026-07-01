# Book Writing Tab — Design for Sign-Off
**TL;DR:** A Paperclip plugin tab wired to NousResearch/autonovel's pipeline. This doc covers architecture, data model, UX mockups, and integration plan.

**Why Phase 1 (Design) must precede implementation:**
- Autonovel is a 27-script Python CLI — no orchestrator, no backend, no UI. Wrapping it requires a clean adapter, not patchwork.
- The tab must survive Paperclip's plugin lifecycle (register, load, unload, error states).
- Tyler must approve the UX before we build.

---

## 1. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Paperclip UI (React)                      │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Plugin Tab: Book Writing                            │  │
│  │  ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌──────────┐ │  │
│  │  │ FOUNDATION│ │ DRAFTING│ │ REVISION│ │ EXPORT   │ │  │
│  │  │ Phase 1  │ │ Phase 2 │ │ Phase 3 │ │ Phase 4  │ │  │
│  │  └─────────┘ └──────────┘ └─────────┘ └──────────┘ │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │ HTTP/WS                           │
└──────────────────────────┼──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│              Paperclip Server (Express)                      │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Book Writing Service                                 │  │
│  │  - CRUD for books, seeds, chapters, audio             │  │
│  │  - Pipeline state machine (4 phases → sub-steps)      │  │
│  │  - Autonovel adapter (subprocess orchestration)       │  │
│  │  - Artifact storage (PDF, ePub, audiobooks)           │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │                                   │
└──────────────────────────┼──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│              Autonovel Engine (Python)                       │
│  ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌──────────┐        │
│  │gen_world│ │draft_ch..│ │gen_rev..│ │build_tex │        │
│  │gen_chars│ │evaluate  │ │reader.. │ │gen_art   │        │
│  │gen_out..│ │          │ │apply_cut│ │gen_audio │        │
│  └─────────┘ └──────────┘ └─────────┘ └──────────┘        │
└─────────────────────────────────────────────────────────────┘
```

### Key design decisions

1. **Server-side adapter, not client-side inline.** Autonovel is a Python CLI with ~27 scripts. Wrapping it in a Paperclip server service ensures:
   - Pipeline runs survive page refreshes
   - The heavy LLM calls don't block the browser
   - Multiple books can be worked on concurrently
   - Status is persisted in the DB

2. **Sequential phase execution.** Tyler's night-shift preferences mandate one step at a time. Each phase has:
   - `started_at` / `completed_at` timestamps
   - `status` (pending → running → completed / failed)
   - `result` (score, artifact paths, logs)

3. **Autonovel adapter as an abstraction layer.** The server should NOT embed autonovel scripts directly. Instead a thin `AutonovelAdapter` class:
   - Accepts a Python script name + args
   - Runs it as a subprocess (cwd = novel's branch directory)
   - Captures stdout/stderr + exit code
   - Returns structured results
   - This makes it easy to swap or version autonovel later

---

## 2. Data Model

### Table: `book_books`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| company_id | UUID (FK) | Company scoping |
| title | text | Book title |
| seed_concept | text | The seed.txt content |
| branch_name | text | Git branch name in autonovel repo |
| status | enum | draft → foundation → drafting → revision → export → complete |
| foundation_score | float | Last foundation evaluation score |
| current_phase | int | 1-4 |
| current_step | int | Step index within phase |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### Table: `book_phases`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| book_id | UUID (FK) | |
| phase_number | int | 1-4 |
| phase_name | text | foundation / drafting / revision / export |
| status | text | pending → running → completed → failed |
| started_at | timestamptz | |
| completed_at | timestamptz | |
| score | float | Phase evaluation score |
| iteration_count | int | For phase 1 (foundation loop count) |

### Table: `book_artifacts`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| book_id | UUID (FK) | |
| artifact_type | text | world_md / characters_md / outline_md / chapter / pdf / epub / audiobook / cover_art |
| file_path | text | Server-side path to artifact |
| file_size | int | Bytes |
| chapter_number | int? | Chapter number (for chapter artifacts) |
| score | float? | Evaluation score (for chapters) |
| created_at | timestamptz | |

### Phase 1 specific: World/Character/Outline data (for UI rendering)

Rather than parsing markdown on the client, the server extracts structured snippets:
- World: key locations, factions, magic systems (first heading per section)
- Characters: name, role, wound/want/need
- Outline: chapter summaries, beats
- Canon: entry count

These can be stored as JSONB on the book record or in a separate cache table.

---

## 3. Plugin Tab Architecture

### Paperclip Plugin setup

Following the Paperclip plugin system pattern:

```
plugins/book-writing-tab/
├── manifest.yaml
├── ui/
│   ├── index.tsx          # Plugin entry point
│   ├── BookWritingTab.tsx  # Main tab component
│   ├── phases/
│   │   ├── PhaseFoundation.tsx
│   │   ├── PhaseDrafting.tsx
│   │   ├── PhaseRevision.tsx
│   │   └── PhaseExport.tsx
│   ├── components/
│   │   ├── BookList.tsx
│   │   ├── BookDetail.tsx
│   │   ├── SeedInput.tsx
│   │   ├── PhaseProgress.tsx
│   │   ├── ArtifactViewer.tsx
│   │   └── PipelineControls.tsx
│   └── styles.css
└── package.json
```

### manifest.yaml
```yaml
id: book-writing-tab
name: Book Writing
version: 0.1.0
description: Autonovel-powered book creation pipeline
ui:
  slots:
    - type: taskDetailView
      export: BookWritingTab
    - type: sidebarItem
      export: BookWritingNavItem
```

### Tab Registration
```typescript
// ui/index.tsx
import { registerPluginReactComponent } from "@paperclipai/plugin-sdk/ui";
import { BookWritingTab } from "./BookWritingTab";

registerPluginReactComponent("book-writing-tab", "BookWritingTab", BookWritingTab);
```

### API Routes (server-side)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/companies/:cid/books` | List books |
| POST | `/api/companies/:cid/books` | Create new book (with seed concept) |
| GET | `/api/companies/:cid/books/:id` | Get book details + phase status |
| PATCH | `/api/companies/:cid/books/:id` | Update book metadata |
| POST | `/api/companies/:cid/books/:id/start` | Start/advance pipeline |
| GET | `/api/companies/:cid/books/:id/artifacts` | List generated artifacts |
| GET | `/api/companies/:cid/books/:id/artifacts/:aid/download` | Download artifact |
| POST | `/api/companies/:cid/books/:id/retry` | Retry failed step |

---

## 4. UX Mockups (Text-Based)

### Tab: Books List

```
┌──────────────────────────────────────────────────────┐
│  📚 Book Writing                                     │
├──────────────────────────────────────────────────────┤
│  [+ New Book]                                        │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │ The Second Son of the House of Bells          │   │
│  │ Foundation: 8.2 | Drafting: 7.4 | ⏳ Step 3/7 │   │
│  │ [Continue] [View Artifacts]                   │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │ Aether's Edge (new)                           │   │
│  │ ⏸️ Phase 1 — evaluation loop (iteration 5/15) │   │
│  │ [Resume] [View Progress]                      │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │ (empty slot — click + New Book to start)     │   │
│  └──────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

### Phase 1: Foundation (seed → world → characters → outline → voice → canon)

Each sub-step shows:
- Current iteration count (e.g., "Iteration 8/15")
- Last evaluation score + trend (↑↓—)
- Which component is being refined (world / characters / outline / voice / canon)
- "View current draft" link for each component

```
┌──────────────────────────────────────────────────────┐
│  📖 Aether's Edge — Phase 1: Foundation              │
├──────────────────────────────────────────────────────┤
│  Overall Score: 7.1 / 10.0  ▲ (+0.3)                 │
│  Target: > 7.5                                       │
│                                                      │
│  ┌──────────┬──────────┬──────────┬──────────┐      │
│  │ 🌍 World │ 👤 Char. │ 📋 Outl. │ 🎭 Voice │      │
│  │ 7.8      │ 6.9      │ 7.2      │ 6.5      │      │
│  │ [View]   │ [View]   │ [View]   │ [View]   │      │
│  └──────────┴──────────┴──────────┴──────────┘      │
│                                                      │
│  Canon entries: 342/400+  ⬜⬜⬜⬜⬜⬜⬜⬜░░░                 │
│                                                      │
│  [▶ Continue Loop] [⏸ Pause] [⏹ Stop & Save]       │
│                                                      │
│  Activity Log (last 3):                              │
│  ✓ gen_world — 8.1 → kept                           │
│  ✓ gen_outline — 7.2 → kept                         │
│  ✓ evaluate — foundation_score: 7.1                 │
└──────────────────────────────────────────────────────┘
```

### Phase 2: Drafting (sequential chapters)

```
┌──────────────────────────────────────────────────────┐
│  📖 Aether's Edge — Phase 2: Drafting                │
├──────────────────────────────────────────────────────┤
│  Chapter 12/24  ████████████░░░░░░░░░  50%           │
│                                                      │
│  Current: Ch. 13 — "The Hollow Gate"                 │
│          ⏳ Drafting... (3 retries used)              │
│                                                      │
│  Last 3 chapter scores: 7.2 → 6.8 → 7.5             │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │ Chapter 12 - preview:                        │   │
│  │ "The wardstone pulsed once, then went dark.  │   │
│  │ Mira pressed her palm against the cold       │   │
│  │ granite..."                                   │   │
│  │ [Full chapter] [Retry] [Revise later]         │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  [▶ Continue] [⏸ Pause]                             │
└──────────────────────────────────────────────────────┘
```

### Phase 3: Revision

```
┌──────────────────────────────────────────────────────┐
│  📖 Aether's Edge — Phase 3: Revision                │
├──────────────────────────────────────────────────────┤
│  Cycle 2/6                                           │
│                                                      │
│  Progress: ████████░░░░░░  3 of 6 cycles complete    │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │ Adversarial Edit: 2,400 cuts identified       │   │
│  │ Reader Panel: 3/4 consensus on Ch. 7 rewrite  │   │
│  │ Revision Brief: generated for Ch. 7, 11, 19   │   │
│  │ Timeline: 35 min remaining (est.)             │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  Scores across cycles:                               │
│  C1: 6.2 → C2: 7.0 → C3: 7.4 (▲+0.4)                │
│                                                      │
│  [▶ Continue Revision] [⏸ Pause] [Skip to Export]  │
└──────────────────────────────────────────────────────┘
```

### Phase 4: Export (PDF, ePub, audiobook, cover art)

```
┌──────────────────────────────────────────────────────┐
│  📖 Aether's Edge — Phase 4: Export                  │
├──────────────────────────────────────────────────────┤
│  Export types:                                       │
│                                                      │
│  ✅ PDF     📄 aether-edge.pdf      (12.4 MB) [Download]│
│  ⏳ ePub    ████████░░ 80%                          │
│  ❌ Audiobook  — requires ELEVENLABS_API_KEY          │
│  ⏳ Cover Art  ████░░░░░░ 40%  (FAL_KEY required)    │
│                                                      │
│  Typeset preview: 4 ornaments generated               │
│  LaTeX build: successful (no errors)                  │
│                                                      │
│  [Generate All] [Download All as ZIP]                │
└──────────────────────────────────────────────────────┘
```

### New Book / Seed Input Dialog

```
┌──────────────────────────────────────────────────────┐
│  Create New Book                                     │
├──────────────────────────────────────────────────────┤
│  Book Title: [                              ]        │
│                                                      │
│  Seed Concept:                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │ A young cartographer discovers the world's   │   │
│  │ edge is not an ocean but a wall of frozen    │   │
│  │ time...                                      │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  [Generate Seed Concept] [Clear]                     │
│                                                      │
│  ── or select from templates ──                      │
│  [Fantasy] [Sci-Fi] [Mystery] [Romance]             │
│                                                      │
│  [Cancel] [Create Book]                              │
└──────────────────────────────────────────────────────┘
```

---

## 5. Autonovel Integration Strategy

### Approach: Clean Orchestrator (per zeus-coding skill guidance)

**Do NOT patch autonovel's 27 scripts.** Use the Clean Orchestrator pattern:

```
server/src/services/autonovel-adapter.ts
├── class AutonovelAdapter
│   ├── constructor(config: { repoPath, novelBranch, apiKeys })
│   ├── runPhase1(seed: string) → Promise<Phase1Result>
│   ├── runPhase2() → Promise<Phase2Result>
│   ├── runPhase3() → Promise<Phase3Result>
│   ├── runPhase4() → Promise<Phase4Result>
│   ├── evaluate(phase: number) → Promise<EvaluationResult>
│   ├── getArtifact(path: string) → Promise<Buffer>
│   └── abort() → Promise<void>
```

The adapter:
1. Clones autonovel repo (or uses existing clone)
2. Creates a git branch per novel
3. Runs scripts by calling Python subprocess from the novel's branch directory
4. Captures output (md files, JSON scores, PDFs)
5. Reports progress via event emitter or polling

### API keys

Autonovel requires:
- `ANTHROPIC_API_KEY` — for Opus-based evaluation and revision
- `FAL_KEY` — for art generation (optional)
- `ELEVENLABS_API_KEY` — for audiobook (optional)

These should be stored as Paperclip **secrets** scoped to the company, not in `.env`.

### Pipeline state machine

```
                    ┌──────────┐
                    │  SEED    │
                    └────┬─────┘
                         │ startPhase1()
                    ┌────▼─────┐
          ┌────────►│FOUNDATION├─────┐ fail
          │         │ (Phase 1)│     │
          │         └────┬─────┘     │
          │ score<7.5    │ score≥7.5 │
          └──────────────┘           │
                        ┌───────────▼────┐
              ┌─────────►DRAFTING        │
              │         │ (Phase 2)      │─────┐ fail
              │         └───────┬────────┘     │
              │ chapters< N     │ all done     │
              └─────────────────┘              │
                           ┌───────────────────▼───┐
                 ┌────────►│  REVISION             │
                 │         │  (Phase 3)            │─────┐ fail
                 │         └──────┬────────────────┘     │
                 │ plateau         │ cycles done         │
                 └─────────────────┘                     │
                           ┌─────────────────────────────▼──┐
                           │  EXPORT                        │
                           │  (Phase 4)                     │
                           └────────────────────────────────┘
                                  │
                           ┌──────▼──────┐
                           │  COMPLETE   │
                           └─────────────┘
```

Each phase transition triggers:
1. Update book `current_phase` in DB
2. Create `book_phases` record
3. Run the autonovel sub-process
4. On completion: update scores, create artifact records, log activity
5. On error: set status= `failed`, log stderr, notify via comment

---

## 6. Dependencies & Risk Assessment

| Dependency | Risk | Mitigation |
|-----------|------|------------|
| Autonovel Python env | Low if Python 3.11+ available | Pin requirements in pyproject.toml |
| Anthropic API key | Medium — can be expensive on Opus eval cycles | Cap iterations (env var), track spend |
| FAL_KEY / ElevenLabs | Low — Phase 4 only, optional | Graceful fallback: "Not configured" |
| Paperclip plugin SDK | Low — slots.tsx already supports detailTab | Follow existing plugin patterns |

### Estimated effort
- **Phase 1 (Implementation):** ~3-4 hours
  - Server: book service + routes + autonovel adapter (~200 lines)
  - DB: migration for 3 tables (~50 lines)
  - Plugin: tab UI + phase components (~400 lines)
- **Phase 2 (Implementation):** ~2-3 hours
  - UI polish: progress bars, artifact viewer, pipeline controls
  - Error handling: retry, abort, resume
- **Phase 3 (Implementation):** ~2-3 hours
  - Wire Phase 4 export pipeline
  - Audiobook + art generation UI

---

## 7. Open Decisions for Tyler

1. **Where should autonovel live?** Clone on the Windows host (for local dev) or on Box 1 (for production)? Recommend: Windows for now (local Paperclip instance), migrate path later.
2. **Seed concept generation:** Should the tab include an LLM-assisted seed generator (like autonovel's `seed.py`), or require Tyler to provide the seed manually?
3. **Autonovel version pinning:** Pin to a specific commit or follow master? Recommend pin for reproducibility.
4. **Scope of Phase 1 implementation:** Build all 4 phases at once, or Phase 1 (Foundation) UI only first to prove the pattern?
5. **Publishing target:** What formats? PDF only, or also ePub, audiobook, and landing page (all supported by autonovel)?
