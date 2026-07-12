import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { callLLM } from "./chapter-generator.js";
import { compileChapterContext } from "./book-context-compiler.js";
import { persistChapterProse } from "./book-prose-writer.js";
import { logActivity } from "./index.js";
import type { Db } from "@paperclipai/db";
import { books, storyBibleOutline, manuscriptChapters } from "@paperclipai/db";
import { eq, and } from "drizzle-orm";

// --- Types ---
export interface ChapterProgress {
  chapterNumber: number;
  title: string;
  status: "pending" | "drafting" | "critiquing" | "complete";
  iterationCount: number;
}

export interface AutopilotState {
  bookId: string;
  companyId: string;
  bookTitle: string;
  status: "idle" | "running" | "paused" | "completed" | "failed";
  phase: "idle" | "assembling" | "drafting" | "critiquing" | "revising" | "advancing";
  currentChapter: number;
  totalChapters: number;
  currentIteration: number;
  iterationCapPerChapter: number;
  spendCents: number;
  budgetCents: number | null;
  softCapCents: number | null;
  guidance: string | null;
  startedAt: string | null;
  pausedAt: string | null;
  failReason: string | null;
  chapters: ChapterProgress[];
  /** In-memory only — not serialized to checkpoint */
  abortController: AbortController | null;
}

export interface AutopilotStartOptions {
  budgetCents?: number;
  iterationCapPerChapter?: number;
  guidance?: string;
}

// --- Checkpoint Dir ---
const CHECKPOINT_DIR =
  process.env.AUTOPILOT_CHECKPOINT_DIR ||
  path.join(process.env.HOME || os.homedir(), ".paperclip", "autopilot-checkpoints");

function ensureCheckpointDir() {
  mkdirSync(CHECKPOINT_DIR, { recursive: true });
}

function checkpointPath(bookId: string): string {
  return path.join(CHECKPOINT_DIR, `${bookId}.json`);
}

function writeCheckpoint(state: AutopilotState) {
  ensureCheckpointDir();
  const { abortController: _, ...serializable } = state;
  writeFileSync(checkpointPath(state.bookId), JSON.stringify(serializable, null, 2), "utf-8");
}

function loadCheckpoint(bookId: string): AutopilotState | null {
  const cp = checkpointPath(bookId);
  if (!existsSync(cp)) return null;
  const parsed = JSON.parse(readFileSync(cp, "utf-8")) as AutopilotState;
  parsed.abortController = null;
  return parsed;
}

// --- Module-level state map ---
const loops = new Map<string, AutopilotState>();

// --- Init: load existing checkpoints, demote crashed ---
export function initAutopilotOrchestrator() {
  ensureCheckpointDir();
  const files = readdirSync(CHECKPOINT_DIR).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const bookId = file.replace(/\.json$/, "");
    const state = loadCheckpoint(bookId);
    if (!state) continue;
    if (state.status === "running") {
      console.warn(`[autopilot] Demoting crashed loop for book ${bookId} to paused`);
      state.status = "paused";
      state.phase = "idle";
      writeCheckpoint(state);
    }
    loops.set(bookId, state);
  }
}

// --- Public API ---
export function getAutopilotState(bookId: string): AutopilotState | undefined {
  return loops.get(bookId);
}

export function getAllAutopilotStates(): AutopilotState[] {
  return Array.from(loops.values());
}

export function startAutopilot(
  bookId: string,
  companyId: string,
  bookTitle: string,
  options: AutopilotStartOptions,
  db: Db,
  actor: any,
): AutopilotState {
  if (loops.has(bookId) && loops.get(bookId)!.status === "running") {
    throw new Error("Autopilot loop already running for this book");
  }

  const softCapPct = 0.8;
  const budgetCents = options.budgetCents ?? null;
  const softCapCents = budgetCents !== null ? Math.floor(budgetCents * softCapPct) : null;

  const state: AutopilotState = {
    bookId,
    companyId,
    bookTitle,
    status: "running",
    phase: "assembling",
    currentChapter: 1,
    totalChapters: 0, // determined at loop start
    currentIteration: 1,
    iterationCapPerChapter: options.iterationCapPerChapter ?? 3,
    spendCents: 0,
    budgetCents,
    softCapCents,
    guidance: options.guidance ?? null,
    startedAt: new Date().toISOString(),
    pausedAt: null,
    failReason: null,
    chapters: [],
    abortController: new AbortController(),
  };

  loops.set(bookId, state);
  writeCheckpoint(state);

  // Fire background loop (no await)
  runAutopilotLoop(state, db, actor).catch((err) => {
    console.error(`[autopilot] Unexpected loop error for book ${bookId}:`, err);
  });

  return state;
}

export function pauseAutopilot(bookId: string): AutopilotState {
  const state = loops.get(bookId);
  if (!state) throw new Error("No autopilot loop found");
  if (state.status !== "running") throw new Error("Autopilot is not running");
  state.abortController?.abort();
  state.status = "paused";
  state.pausedAt = new Date().toISOString();
  state.phase = "idle";
  writeCheckpoint(state);
  return state;
}

export function resumeAutopilot(bookId: string, newBudgetCents?: number, db?: Db, actor?: any): AutopilotState {
  const state = loops.get(bookId);
  if (!state) throw new Error("No autopilot loop found");
  if (state.status !== "paused") throw new Error("Autopilot is not paused");

  if (newBudgetCents !== undefined) {
    state.budgetCents = newBudgetCents;
    state.softCapCents = Math.floor(newBudgetCents * 0.8);
  }
  state.status = "running";
  state.pausedAt = null;
  state.abortController = new AbortController();
  writeCheckpoint(state);

  runAutopilotLoop(state, db!, actor!).catch((err) => {
    console.error(`[autopilot] Unexpected loop error for book ${bookId}:`, err);
  });

  return state;
}

export function steerAutopilot(bookId: string, guidance: string): AutopilotState {
  const state = loops.get(bookId);
  if (!state) throw new Error("No autopilot loop found");
  state.guidance = guidance;
  writeCheckpoint(state);
  return state;
}

// --- Main loop ---
// Rewired 2026-07-12 (deferred item 2): the loop now chains manuscript PROSE,
// not outline beats. Scope = the approved outline (story_bible_outline); each
// remaining chapter gets a freshly compiled context packet (spec §5) → prose
// draft → persist into manuscript_chapters via the same persistChapterProse
// path every other writer uses. The chain continues while each generation
// succeeds and stops on error, pause, or book completion. It NEVER overwrites
// a chapter that already has prose (human text is inviolable — spec §2.2).
async function runAutopilotLoop(state: AutopilotState, db: Db, actor: any) {
  try {
    const [book] = await db
      .select({ id: books.id, slug: books.slug })
      .from(books)
      .where(eq(books.id, state.bookId));
    const bookSlug = book?.slug ?? "";

    // Scope = the approved outline, in order.
    const outline = await db
      .select({ chapterNumber: storyBibleOutline.chapterNumber, title: storyBibleOutline.title })
      .from(storyBibleOutline)
      .where(eq(storyBibleOutline.bookId, state.bookId))
      .orderBy(storyBibleOutline.chapterNumber);

    if (outline.length === 0) {
      state.status = "failed";
      state.failReason =
        "No outline chapters — Autopilot chains prose over approved beats. Draft an outline first.";
      state.phase = "idle";
      writeCheckpoint(state);
      return;
    }

    // Which chapters already have prose (skip — never overwrite).
    const manuscripts = await db
      .select({ chapterNumber: manuscriptChapters.chapterNumber, content: manuscriptChapters.content })
      .from(manuscriptChapters)
      .where(eq(manuscriptChapters.bookId, state.bookId));
    const hasProse = new Set(
      manuscripts.filter((m) => (m.content ?? "").trim().length > 0).map((m) => m.chapterNumber),
    );

    state.totalChapters = outline.length;
    state.chapters = outline.map((ch) => ({
      chapterNumber: ch.chapterNumber,
      title: ch.title,
      status: hasProse.has(ch.chapterNumber) ? ("complete" as const) : ("pending" as const),
      iterationCount: 0,
    }));
    writeCheckpoint(state);

    for (const ch of outline) {
      if (state.status !== "running" || state.abortController?.signal.aborted) break;
      if (hasProse.has(ch.chapterNumber)) continue;

      const chapterProgress = state.chapters.find((c) => c.chapterNumber === ch.chapterNumber);
      if (!chapterProgress) continue;
      state.currentChapter = ch.chapterNumber;

      // --- Phase: Assembling (fresh context packet per chapter, spec §5) ---
      state.phase = "assembling";
      chapterProgress.status = "drafting";
      writeCheckpoint(state);
      const ctx = await compileChapterContext(
        db,
        state.bookId,
        ch.chapterNumber,
        state.guidance ?? undefined, // steer guidance honored at each chapter
      );

      // --- Phase: Drafting (prose — Gemini → DeepSeek → Anthropic) ---
      state.phase = "drafting";
      writeCheckpoint(state);
      const prose = await callLLM(ctx.systemPrompt, ctx.userPrompt);
      if (!prose || !prose.trim()) {
        throw new Error(`Writer returned empty prose for chapter ${ch.chapterNumber}`);
      }
      state.spendCents += 5; // rough estimate per draft call

      // Re-check right before writing: if prose appeared meanwhile (e.g. a
      // human edit or a manual draft), skip — autopilot never overwrites.
      const existingNow = await db
        .select({ id: manuscriptChapters.id, content: manuscriptChapters.content })
        .from(manuscriptChapters)
        .where(
          and(
            eq(manuscriptChapters.bookId, state.bookId),
            eq(manuscriptChapters.chapterNumber, ch.chapterNumber),
          ),
        )
        .then((r) => r[0]);
      if (existingNow && (existingNow.content ?? "").trim().length > 0) {
        chapterProgress.status = "complete";
        writeCheckpoint(state);
        continue;
      }

      // --- Phase: Advancing (persist via the shared prose path) ---
      state.phase = "advancing";
      writeCheckpoint(state);
      const persisted = await persistChapterProse(db, {
        bookId: state.bookId,
        bookSlug,
        chapterNumber: ch.chapterNumber,
        prose,
      });
      chapterProgress.title = persisted.title;
      chapterProgress.status = "complete";
      writeCheckpoint(state);

      try {
        await logActivity(db, {
          companyId: state.companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "chapter.prose_written",
          entityType: "book",
          entityId: state.bookId,
          details: {
            bookId: state.bookId,
            chapterNumber: ch.chapterNumber,
            chars: prose.length,
            source: "autopilot",
            usedCharacters: ctx.usedCharacters,
            hadStyle: ctx.hasStyle,
            hadBeat: ctx.hasBeat,
          },
        });
      } catch { /* non-fatal */ }

      // Budget soft-cap: pause (never cancel) with continue-prompt semantics.
      if (state.softCapCents !== null && state.spendCents >= state.softCapCents) {
        state.status = "paused";
        state.pausedAt = new Date().toISOString();
        state.phase = "idle";
        writeCheckpoint(state);
        await logActivity(db, {
          companyId: state.companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "autopilot.paused",
          entityType: "book",
          entityId: state.bookId,
          details: { reason: "budget_soft_cap", spendCents: state.spendCents, budgetCents: state.budgetCents },
        }).catch(() => {});
        return;
      }
    }

    // Book completion: every outlined chapter has prose.
    if (state.status === "running") {
      const remaining = state.chapters.filter((c) => c.status !== "complete").length;
      if (remaining === 0) {
        state.status = "completed";
        state.phase = "idle";
      }
      writeCheckpoint(state);
    }
  } catch (err) {
    // Stop-on-error: surface the reason, do not silently continue the chain.
    state.status = "failed";
    state.failReason = err instanceof Error ? err.message : String(err);
    state.abortController = null;
    state.phase = "idle";
    writeCheckpoint(state);
    console.error(`[autopilot] Loop failed for book ${state.bookId}:`, err);
  }
}
