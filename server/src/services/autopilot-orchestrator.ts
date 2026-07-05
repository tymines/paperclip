import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { generateChapterDraft, reviseChapterContent, callLLM } from "./chapter-generator.js";
import { logActivity } from "./index.js";
import type { Db } from "@paperclipai/db";
import { storyBibleOutline } from "@paperclipai/db";
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

// --- Pricing constants ---
const GEMINI_INPUT_PRICE_PER_1M = 1.25;   // $1.25/1M input tokens
const GEMINI_OUTPUT_PRICE_PER_1M = 10;     // $10/1M output tokens

function estimateCostCents(promptTokens: number, candidateTokens: number): number {
  const costUsd = (promptTokens / 1_000_000) * GEMINI_INPUT_PRICE_PER_1M +
                  (candidateTokens / 1_000_000) * GEMINI_OUTPUT_PRICE_PER_1M;
  return Math.ceil(costUsd * 100); // convert to cents
}

// --- Critique Prompt ---
const CRITIQUE_SYSTEM_PROMPT = `You are a professional fiction editor reviewing a chapter outline.
Evaluate pacing, character voice, dialogue, plot consistency, and adherence to style.
Return ONLY valid JSON: { "hasIssues": boolean, "issues": string[], "praise": string, "score": number }`;

function buildCritiqueUserPrompt(chapterTitle: string, beatsText: string, guidance: string | null): string {
  const parts = [`Review the following chapter outline: "${chapterTitle}"`, `\nBeats:\n${beatsText}`];
  if (guidance) parts.push(`\nAuthor's guidance: ${guidance}`);
  parts.push("\nRespond with the JSON object only.");
  return parts.join("");
}

// --- Beat to text ---
function beatToText(beat: Record<string, unknown>): string {
  return (beat.description as string) ?? (beat as any).toString ?? JSON.stringify(beat);
}

// --- Parse critique JSON from LLM response ---
function parseCritique(raw: string): { hasIssues: boolean; issues: string[]; praise: string; score: number } {
  try {
    // Try direct parse
    return JSON.parse(raw);
  } catch {
    // Try extracting from markdown code block
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) return JSON.parse(jsonMatch[1].trim());
  }
  return { hasIssues: true, issues: ["Failed to parse critique"], praise: "", score: 5 };
}

// --- Main loop ---
async function runAutopilotLoop(state: AutopilotState, db: Db, actor: any) {
  try {
    // Determine existing chapters
    const existingChapters = await db
      .select({ chapterNumber: storyBibleOutline.chapterNumber, title: storyBibleOutline.title })
      .from(storyBibleOutline)
      .where(eq(storyBibleOutline.bookId, state.bookId))
      .orderBy(storyBibleOutline.chapterNumber);

    // Initialize chapter progress
    if (state.chapters.length === 0) {
      for (const ch of existingChapters) {
        state.chapters.push({
          chapterNumber: ch.chapterNumber,
          title: ch.title,
          status: "complete",
          iterationCount: 0,
        });
      }
      // Find the next chapter number
      const maxExisting = existingChapters.length > 0
        ? Math.max(...existingChapters.map((c) => c.chapterNumber))
        : 0;
      state.currentChapter = maxExisting + 1;
      state.chapters.push({
        chapterNumber: state.currentChapter,
        title: `Chapter ${state.currentChapter}`,
        status: "pending",
        iterationCount: 0,
      });
    }

    // Calculate total chapters (current + any already in progress)
    if (state.totalChapters === 0) {
      state.totalChapters = Math.max(state.currentChapter, existingChapters.length + 1);
    }

    writeCheckpoint(state);

    while (state.status === "running" && state.currentChapter <= state.totalChapters) {
      if (state.abortController?.signal.aborted) break;

      const chapterProgress = state.chapters.find(
        (c) => c.chapterNumber === state.currentChapter,
      );
      if (!chapterProgress) break;

      // --- Phase: Assembling ---
      state.phase = "assembling";
      chapterProgress.status = "drafting";
      writeCheckpoint(state);

      // Get previous chapter summary for continuity
      const prevChapter = existingChapters.length > 0
        ? existingChapters[existingChapters.length - 1]
        : null;
      const previousChapterSummary = prevChapter
        ? `"${prevChapter.title}"`
        : undefined;

      // --- Phase: Drafting ---
      state.phase = "drafting";
      writeCheckpoint(state);

      const draft = await generateChapterDraft({
        bookTitle: state.bookTitle,
        chapterNumber: state.currentChapter,
        previousChapterSummary,
        userPrompt: state.guidance ?? undefined,
      });

      // Estimate draft cost
      state.spendCents += 5; // rough estimate per draft call
      chapterProgress.title = draft.title;
      writeCheckpoint(state);

      // --- Phase: Critiquing ---
      state.phase = "critiquing";
      writeCheckpoint(state);

      const beatsText = draft.beats.map(beatToText).join("\n");
      const critiqueRaw = await callLLM(
        CRITIQUE_SYSTEM_PROMPT,
        buildCritiqueUserPrompt(draft.title, beatsText, state.guidance),
      );
      const critique = parseCritique(critiqueRaw);
      state.spendCents += 3; // rough estimate per critique call
      writeCheckpoint(state);

      // --- Phase: Revising (loop) ---
      let iterationCount = 0;
      while (critique.hasIssues && iterationCount < state.iterationCapPerChapter) {
        iterationCount++;
        state.currentIteration = iterationCount + 1;

        // Check chapter not locked
        const existing = await db
          .select({ locked: storyBibleOutline.locked })
          .from(storyBibleOutline)
          .where(
            and(
              eq(storyBibleOutline.bookId, state.bookId),
              eq(storyBibleOutline.chapterNumber, state.currentChapter),
            ),
          )
          .then((r) => r[0]);
        if (existing?.locked) break;

        state.phase = "revising";
        writeCheckpoint(state);

        const reviseInstruction = `Revise based on feedback:\n${critique.issues.join("\n")}${state.guidance ? `\nAdditional guidance: ${state.guidance}` : ""}`;

        const revised = await reviseChapterContent({
          bookTitle: state.bookTitle,
          chapterTitle: draft.title,
          existingBeats: draft.beats as Record<string, unknown>[],
          revisionInstruction: reviseInstruction,
        });

        state.spendCents += 5; // rough estimate per revise call
        chapterProgress.iterationCount = iterationCount;

        // Re-critique
        state.phase = "critiquing";
        writeCheckpoint(state);

        const reCritiqueRaw = await callLLM(
          CRITIQUE_SYSTEM_PROMPT,
          buildCritiqueUserPrompt(revised.title, revised.beats.map(beatToText).join("\n"), state.guidance),
        );
        const reCritique = parseCritique(reCritiqueRaw);
        state.spendCents += 3;

        if (!reCritique.hasIssues) {
          draft.beats = revised.beats;
          draft.title = revised.title;
          break;
        }
        // Copy issues for next iteration
        critique.issues = reCritique.issues;
      }

      // --- Phase: Advancing ---
      state.phase = "advancing";
      writeCheckpoint(state);

      // DB insert (point of truth)
      const [inserted] = await db
        .insert(storyBibleOutline)
        .values({
          bookId: state.bookId,
          chapterNumber: state.currentChapter,
          title: draft.title,
          beats: draft.beats,
          source: "ai-draft",
          locked: false,
        })
        .returning({ id: storyBibleOutline.id });

      // Mark chapter complete
      chapterProgress.status = "complete";
      chapterProgress.iterationCount = iterationCount;
      writeCheckpoint(state);

      // Re-read total chapters from DB
      const countResult = await db
        .select({ count: storyBibleOutline.id })
        .from(storyBibleOutline)
        .where(eq(storyBibleOutline.bookId, state.bookId));
      state.totalChapters = countResult.length + 1; // +1 for the one we're working on
      writeCheckpoint(state);

      // Log chapter complete
      try {
        const { logActivity } = await import("./index.js");
        await logActivity(db, {
          companyId: state.companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "chapter.completed",
          entityType: "story_bible_chapter",
          entityId: inserted.id,
          details: {
            bookId: state.bookId,
            chapterNumber: state.currentChapter,
            iterations: iterationCount,
          },
        });
      } catch { /* non-fatal */ }

      // Budget check (after chapter completes)
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

      // Advance to next chapter
      state.currentChapter++;
      state.currentIteration = 1;
      state.chapters.push({
        chapterNumber: state.currentChapter,
        title: `Chapter ${state.currentChapter}`,
        status: "pending",
        iterationCount: 0,
      });
      writeCheckpoint(state);
    }

    // All chapters complete
    if (state.currentChapter > state.totalChapters) {
      state.status = "completed";
      state.phase = "idle";
      writeCheckpoint(state);
    }
  } catch (err) {
    state.status = "failed";
    state.failReason = err instanceof Error ? err.message : String(err);
    state.abortController = null;
    state.phase = "idle";
    writeCheckpoint(state);
    console.error(`[autopilot] Loop failed for book ${state.bookId}:`, err);
  }
}
