# PreFlect Failure-Pattern Library + Prospective Step Scoring

**Date:** 2026-07-04
**Issue:** TYL-146
**Status:** Planning artifact — no code changes
**Purpose:** Upgrade Brainstorm from post-hoc critique to pre-execution plan validation by giving it a library of known failure modes to match against during planning.

---

## 1. Failure-Pattern Library

Each pattern has a **signature** (the tell), a **weight** (1–3, where 3 = execution-stopper), a **mitigation**, and a **match heuristic** (what Brainstorm scans for).

### P1. Silent Gate Skip
- **Weight:** 3
- **Signature:** Brainstorm/Zeus Critic lane returns HTTP error or empty response; the loop proceeds without critique. The `runLoop` catch block swallows the error and logs at `warn` — no hard stop.
- **Observed:** Board Audit 2026-07-02 — "Fix Zeus Brainstorm health — GLM model returned HTTP 400, critique step skipped."
- **Mitigation:** If any critique turn returns empty/error, the loop MUST NOT proceed. Post a `loop-error` message AND abort the plan (fail-closed). The empty-response guard in `chat()` already throws — verify the catch block in `runLoop` doesn't silently continue.
- **Match heuristic:** Brainstorm reviews its own lane health. If the last critique turn in history shows `(no response from the Brainstorm lane)` or `proxy HTTP`, flag as P1.

### P2. Chunk Bloat
- **Weight:** 2
- **Signature:** A single task touches 3+ files, spans multiple concerns, or says "refactor X and also add Y." The task description uses conjunctions ("and also," "while also," "in addition to").
- **Mitigation:** Split into atomic tasks. Each task = 1 logical change, 1–2 files max.
- **Match heuristic:** Count files referenced per task. Flag any task naming >2 files or containing "and also"/"while also"/"additionally."

### P3. Sequential Coupling
- **Weight:** 2
- **Signature:** Task N+1 cannot start until Task N completes, but this dependency is implicit — not stated as a prerequisite. The executor hits a wall because a file/function doesn't exist yet.
- **Mitigation:** Explicit prerequisite declarations between tasks. Every task that depends on a prior task's output must state: "PREREQ: Task N."
- **Match heuristic:** Scan for tasks that reference files/components created in earlier tasks without stating the dependency. If Task 3 says "add the new hook to Component X" but Task 2 is the one creating Component X, flag it.

### P4. Missing Stop-and-Verify
- **Weight:** 2
- **Signature:** Long sequence of 4+ tasks with no checkpoint between them. The plan is a monolith — one failure and everything after is garbage.
- **Mitigation:** Insert a stop-and-verify checkpoint every 3–5 tasks. Format: "STOP: verify X works. Test: run `pnpm test -- path/to/X`. Expected: all 3 tests pass." Then continue.
- **Match heuristic:** Count tasks between checkpoints. Flag any span >4 tasks with no "STOP"/"VERIFY"/"CHECKPOINT" marker.

### P5. Untestable Task
- **Weight:** 3
- **Signature:** A task has no concrete verification step. It says "test manually" or "verify it works" without a specific command or expected output. Cannot be TDD'd.
- **Mitigation:** Every task MUST include: the test command, the expected pass/fail behavior, and what "done" looks like. If it can't be tested, it can't be planned.
- **Match heuristic:** Look for tasks with no test command (no `pnpm test`, `npm test`, `cargo test`, `pytest`, etc.) OR with vague verification phrases: "manually test," "verify works," "check it."

### P6. Single-Writer Violation
- **Weight:** 2
- **Signature:** Two tasks in the same plan touch the same file but their ordering doesn't guarantee a clean merge. If dispatched to parallel workers, they collide.
- **Mitigation:** Either (a) order them sequentially with explicit dependency, or (b) merge them into one task, or (c) split the file so each task owns a different file.
- **Match heuristic:** Build a file→task map. Any file appearing in >1 task without a PREREQ link between those tasks is a violation.

### P7. Vague Output
- **Weight:** 1
- **Signature:** Task uses abstract language: "improve," "enhance," "optimize," "make better," "clean up." No concrete file path, component name, or API endpoint referenced.
- **Mitigation:** Rewrite with concrete targets. "Improve error handling" → "Add try/catch to `server/src/routes/issues.ts` L42–58 with 400/500 JSON responses."
- **Match heuristic:** Count tasks with zero file paths or zero component/endpoint names. Flag tasks containing only abstract verbs with no concrete target.

### P8. Tools Mismatch
- **Weight:** 1
- **Signature:** Plan assumes tools/MCP servers that aren't in the `tools-required` block (or the block is absent when it shouldn't be). Worker dispatched without needed tools → stalls.
- **Mitigation:** Verify `tools-required` block lists every MCP server/skill referenced in the plan steps. If a step says "fetch docs from context7" but context7 isn't in servers[], flag it.
- **Match heuristic:** Scan plan text for tool mentions (context7, github, slack, filesystem, etc.) and cross-check against the `tools-required` JSON block. Flag mismatches.

---

## 2. Scoring Rubric

### Per-Step Score

For each task in the plan, scan against all 8 patterns. Each match adds the pattern's weight:

```
step_score = sum(weight_i for each pattern_i that matches this task)
```

- **0:** Clean. No patterns matched.
- **1–2:** Minor. P7 or P8 match only — fix with a one-line edit.
- **3–5:** Moderate. P2, P3, P4, or P6 matched — structural fix needed.
- **6+:** Critical. P1 or P5 matched — plan unsafe to execute.

### Plan Risk Score

```
plan_risk = sum(step_score across all tasks) / num_tasks
```

Interpretation:
- **≤ 1.0:** Low risk — proceed.
- **1.1 – 2.5:** Medium risk — revise flagged tasks, re-score.
- **> 2.5:** High risk — structural replan needed.

### Convergence Gate

Brainstorm must not emit AGREED if `plan_risk > 1.0` OR if any task scores ≥ 3. The critique turn must name the highest-scoring pattern(s) and the specific task(s) affected.

---

## 3. Integration Point — Augmented CRITIC_SYS

Replace the current CRITIC_SYS constant in `server/src/services/zeus-plan.ts` (line 126) and `server/src/services/brainstorm-kickoff.ts` (line 139) with the augmented version below. The only addition is the failure-pattern reference block — the persona and rules stay identical.

### Augmented CRITIC_SYS (Zeus Pipeline)

```typescript
const CRITIC_SYS = [
  "You are Brainstorm, a sharp GLM-5.2 plan critic in the Zeus pipeline.",
  "Zeus (the orchestrator) proposes execution plans; you pressure-test them.",
  "Critique against: chunk size (each task should be ~1 logical change),",
  "sequencing, single-writer rule, risk, missing tests, and checkpoint placement.",
  "Be terse and specific (<=150 words).",
  "",
  "Approve only when each task is bite-sized and independently verifiable.",
  "When you genuinely approve, put AGREED on its own final line; otherwise",
  "give the single most important concrete fix.",
  "",
  "FAILURE-PATTERN REFERENCE — scan the plan for these known failure modes:",
  "P1 SILENT GATE: If prior critique turn is empty/error, do NOT proceed. Demand lane health check.",
  "P2 CHUNK BLOAT: Task touching >2 files or using 'and also'/'while also' → split it.",
  "P3 SEQUENTIAL COUPLING: Implicit dependency where Task N+1 needs Task N's output but doesn't say so.",
  "P4 MISSING CHECKPOINT: >4 tasks with no STOP/VERIFY marker between them → insert one.",
  "P5 UNTESTABLE: Task with no test command or vague 'verify it works' → reject, demand concrete test.",
  "P6 SINGLE-WRITER: Two tasks touching same file without PREREQ link → reorder or merge.",
  "P7 VAGUE: Task using 'improve'/'enhance'/'optimize' with no file/component name → demand specificity.",
  "P8 TOOLS MISMATCH: Plan references a tool not in the tools-required block → fix the block or drop the step.",
  "Name the pattern (e.g. 'P2 on task 3') when you flag it. If P1 or P5 fires, do NOT approve.",
].join(" ");
```

### Augmented CRITIC_SYS (Hermes Pipeline — Book Studio)

```typescript
const CRITIC_SYS = [
  "You are Brainstorm, a sharp GLM-5.2 plan critic (the plan-critic tier between",
  "Hermes and Ares). Pressure-test Hermes's plan against: chunk size, sequencing,",
  "single-writer rule, risk, missing tests, and checkpoint placement. Be terse and",
  "specific (<=150 words). Approve only when each task is bite-sized and",
  "independently verifiable. When you genuinely approve, put AGREED on its own final",
  "line; otherwise give the single most important concrete fix.",
  "",
  "FAILURE-PATTERN REFERENCE — scan the plan for these known failure modes:",
  "P1 SILENT GATE: If prior critique turn is empty/error, do NOT proceed.",
  "P2 CHUNK BLOAT: Task >2 files or 'and also'/'while also' → split.",
  "P3 SEQUENTIAL COUPLING: Implicit dependency on prior task output.",
  "P4 MISSING CHECKPOINT: >4 tasks with no STOP/VERIFY → insert one.",
  "P5 UNTESTABLE: No test command or vague 'verify it works' → reject.",
  "P6 SINGLE-WRITER: Two tasks on same file without PREREQ → reorder/merge.",
  "P7 VAGUE: 'improve'/'enhance' with no concrete target → demand specificity.",
  "P8 TOOLS MISMATCH: Tool referenced but not in tools-required block.",
  "Name the pattern when you flag it. P1 or P5 = do NOT approve.",
].join(" ");
```

---

## 4. What Was Skipped / When to Add

- **No code changes to server/UI.** This is a planning artifact. The CRITIC_SYS snippets above are integration-ready — paste them in when TYL-146 moves to implementation.
- **No framework.** The scoring rubric is a manual heuristic that Brainstorm applies during critique via the augmented prompt. A programmatic scorer (TypeScript function that parses plan text and computes step_score) can be added later if the LLM-based matching proves inconsistent.
- **No session DB mining (empty DB).** Patterns were derived from Zeus Critic soul doc, Board Audit, and common multi-agent failure modes from the PreFlect research. When real Zeus session transcripts accumulate, run a distillation pass to add observed patterns.
- **Pattern count: 8.** Chosen to be small enough that Brainstorm can hold them in-context. Add more when the current 8 stop catching failures (or when a new failure mode costs a full pipeline run).
