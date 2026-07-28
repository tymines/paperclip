// Book Studio — baseline review pass (Spec v1 §5.B).
// One automatic pass on every landed draft, pre-human: quality rubric +
// story-bible fact-check with cited entities. ANNOTATES AND SCORES ONLY — the
// critic never rewrites and never commits.
//
// Critic lane (Spec v1 amendment v1.4): the review function routes to ARES —
// a live agent (reviewer under Ares, Kimi K3), reached through the existing
// peer-delegation contract (book-agent-lanes.ts → dispatchDelegation →
// result callback). Writer ≠ critic is preserved at the AGENT level, not
// just the model level. While cross-box co-location is pending, an
// unreachable/slow/failed Ares falls back to the configured model lanes
// (callCriticLLM in chapter-generator.ts) and the report says which lane
// actually answered (criticProvider + criticDegraded) — never silently
// same-model, never a fabricated agent verdict.
//
// Verdicts (Spec v1 §4): PASS → the chapter queues silently · FAIL → exception
// in the review queue · NO_VERDICT → missing/stale evidence — halts, surfaces,
// never silently passes (§6.4).
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  books,
  storyBibleStyle,
  storyBibleCharacters,
  storyBibleWorldLocations,
  bookAnnotations,
  bookReviewRuns,
  manuscriptChapters,
} from "@paperclipai/db";
import { and } from "drizzle-orm";
import { callCriticLLM } from "./chapter-generator.js";
import { chapterContentHash } from "./book-prose-writer.js";
import { callAgentLane, AgentLaneUnavailableError } from "./book-agent-lanes.js";

/** Provenance string stamped on reports + review runs when the live Ares agent lane answered. */
export const ARES_CRITIC_PROVIDER = "ares (agent lane)";

// The 8 rubric dimensions (Spec v1 §4 — 8-dim rubric scorecards). Score 1–10.
export const RUBRIC_DIMENSIONS = [
  "pacing",
  "characterVoice",
  "plotLogic",
  "proseQuality",
  "consistency",
  "tension",
  "dialogue",
  "worldImmersion",
] as const;
export type RubricDimension = (typeof RUBRIC_DIMENSIONS)[number];

/** A dimension below this score is a failure (red in the rubric inspector). */
export const PASS_THRESHOLD = 7;

export type ReviewVerdict = "PASS" | "FAIL" | "NO_VERDICT";

export interface BaselineFinding {
  /** EXACT verbatim quote from the chapter (anchored to offsets when found). */
  excerpt?: string;
  note: string;
  /** One of the review-note categories; defaults to consistency for canon hits. */
  category?: "pacing" | "character" | "plot" | "prose" | "consistency";
  kind?: "review" | "suggestion";
}

export interface BaselineReport {
  chapterNumber: number;
  verdict: ReviewVerdict;
  scores: Partial<Record<RubricDimension, number>>;
  failures: string[];
  summary: string;
  findings: BaselineFinding[];
  criticProvider: string;
  criticDegraded: boolean;
  /** Human-readable reason when verdict is NO_VERDICT. */
  noVerdictReason?: string;
}

function extractJson(raw: string): unknown {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = fence ? fence[1].trim() : raw;
  const start = src.indexOf("{");
  const end = src.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("no JSON object in critic output");
  return JSON.parse(src.slice(start, end + 1));
}

/**
 * Run the baseline pass over one chapter's prose. Pure analysis: returns the
 * report; persistence (review run + annotations) is the caller's choice via
 * `persistBaselineReport` below. Throws only on hard failures (no prose, lane
 * unavailable) — unparseable critic output becomes NO_VERDICT, not an error.
 */
export async function runBaselineReview(
  db: Db,
  args: { bookId: string; chapterNumber: number; companyId?: string; requestedByActorId?: string | null },
): Promise<BaselineReport> {
  const { bookId, chapterNumber } = args;

  const [book] = await db.select().from(books).where(eq(books.id, bookId));
  if (!book) throw new Error("Book not found");
  const [chapter] = await db
    .select()
    .from(manuscriptChapters)
    .where(and(eq(manuscriptChapters.bookId, bookId), eq(manuscriptChapters.chapterNumber, chapterNumber)));
  const content = chapter?.content ?? "";
  if (!chapter || !content.trim()) {
    throw new Error(`Chapter ${chapterNumber} has no prose to review yet.`);
  }

  // Bible evidence for the fact-check: style card + entity cards. The critic
  // must CITE the entity it claims is violated — uncited claims are ignored.
  const [style] = await db.select().from(storyBibleStyle).where(eq(storyBibleStyle.bookId, bookId));
  const characters = await db.select().from(storyBibleCharacters).where(eq(storyBibleCharacters.bookId, bookId));
  const locations = await db.select().from(storyBibleWorldLocations).where(eq(storyBibleWorldLocations.bookId, bookId));

  const bibleParts: string[] = [];
  if (style) {
    bibleParts.push(
      `STYLE CARD: POV ${style.pov || "—"} · Tense ${style.tense || "—"} · Banned clichés: ${style.bannedCliches || "—"}`,
    );
  }
  if (characters.length) {
    bibleParts.push(
      "CHARACTERS:\n" + characters.map((c) => `- ${c.name}${c.role ? ` (${c.role})` : ""}: ${(c.description ?? "").slice(0, 300)}`).join("\n"),
    );
  }
  if (locations.length) {
    bibleParts.push(
      "LOCATIONS:\n" + locations.map((l) => `- ${l.name}: ${(l.description ?? "").slice(0, 300)}${l.rules ? `\n  Rules: ${JSON.stringify(l.rules).slice(0, 300)}` : ""}`).join("\n"),
    );
  }

  const systemPrompt = [
    "You are the critic lane for a book studio — a DIFFERENT model than the writer, reviewing its work.",
    "You score and annotate ONLY. You never rewrite, never edit, never approve your own fixes.",
    "Score the chapter on these 8 rubric dimensions (1-10 each): " + RUBRIC_DIMENSIONS.join(", ") + ".",
    "Fact-check the chapter against the provided story bible: any contradiction with an established character, location rule, or style card is a finding with category \"consistency\" — cite the exact entity you claim is violated.",
    "Under-flag: only report findings you are confident about (max 8).",
    'Return ONLY valid JSON: { "scores": { "<dimension>": 1-10, ... }, "summary": "one-paragraph verdict rationale", "findings": [ { "excerpt": "EXACT verbatim quote (10-40 words)", "note": "the problem + concrete suggestion", "category": "pacing"|"character"|"plot"|"prose"|"consistency", "kind": "review"|"suggestion" } ] }',
    "Excerpts MUST be copied character-for-character from the chapter so they can be anchored.",
  ].join("\n");
  const userPrompt =
    `CHAPTER ${chapterNumber} PROSE:\n${content.slice(0, 24000)}\n\n` +
    `STORY BIBLE (fact-check evidence):\n${bibleParts.length ? bibleParts.join("\n\n") : "(no bible entries yet — score craft only, note the missing evidence in summary)"}\n\n` +
    "Respond with the JSON object only.";

  // Spec v1.4: Ares first (live agent, via the peer-delegation contract);
  // the configured model lanes are the documented pre-co-location fallback.
  // `companyId` is optional so existing tests/callers without a company
  // context keep the model-lane-only behavior.
  let critic: { text: string; provider: string; criticDegraded: boolean };
  if (args.companyId) {
    try {
      const lane = await callAgentLane(db, {
        lane: "ares",
        companyId: args.companyId,
        task: `${systemPrompt}\n\n${userPrompt}`,
        metadata: { bookId, chapterNumber },
        requestedByActorId: args.requestedByActorId ?? null,
      });
      critic = { text: lane.text, provider: ARES_CRITIC_PROVIDER, criticDegraded: false };
    } catch (laneErr) {
      if (!(laneErr instanceof AgentLaneUnavailableError)) throw laneErr;
      critic = await callCriticLLM(systemPrompt, userPrompt);
    }
  } else {
    critic = await callCriticLLM(systemPrompt, userPrompt);
  }

  let parsed: {
    scores?: Record<string, unknown>;
    summary?: string;
    findings?: Array<{ excerpt?: string; note?: string; category?: string; kind?: string }>;
  };
  try {
    parsed = extractJson(critic.text) as typeof parsed;
  } catch {
    // Missing evidence ⇒ NO_VERDICT (§6.4): halts, surfaces, never silently passes.
    return {
      chapterNumber,
      verdict: "NO_VERDICT",
      scores: {},
      failures: [],
      summary: "Critic returned unparseable output — no verdict could be formed.",
      findings: [],
      criticProvider: critic.provider,
      criticDegraded: critic.criticDegraded,
      noVerdictReason: "unparseable-critic-output",
    };
  }

  const scores: Partial<Record<RubricDimension, number>> = {};
  for (const dim of RUBRIC_DIMENSIONS) {
    const v = Number(parsed.scores?.[dim]);
    if (Number.isFinite(v)) scores[dim] = Math.max(1, Math.min(10, Math.round(v)));
  }
  // Missing scores = missing evidence ⇒ NO_VERDICT (never silently pass).
  if (Object.keys(scores).length < RUBRIC_DIMENSIONS.length) {
    return {
      chapterNumber,
      verdict: "NO_VERDICT",
      scores,
      failures: [],
      summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 2000) : "Critic returned incomplete scores.",
      findings: [],
      criticProvider: critic.provider,
      criticDegraded: critic.criticDegraded,
      noVerdictReason: "incomplete-rubric-scores",
    };
  }

  const failures = RUBRIC_DIMENSIONS.filter((d) => (scores[d] ?? 0) < PASS_THRESHOLD);
  const findings = (Array.isArray(parsed.findings) ? parsed.findings : [])
    .filter((f) => f && typeof f.note === "string" && f.note.trim())
    .slice(0, 8)
    .map((f) => ({
      excerpt: typeof f.excerpt === "string" ? f.excerpt : undefined,
      note: f.note!.trim(),
      category: (["pacing", "character", "plot", "prose", "consistency"].includes(String(f.category))
        ? f.category
        : "prose") as BaselineFinding["category"],
      kind: f.kind === "suggestion" ? ("suggestion" as const) : ("review" as const),
    }));
  const canonHit = findings.some((f) => f.category === "consistency");

  return {
    chapterNumber,
    verdict: failures.length === 0 && !canonHit ? "PASS" : "FAIL",
    scores,
    failures,
    summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 2000) : "",
    findings,
    criticProvider: critic.provider,
    criticDegraded: critic.criticDegraded,
  };
}

/**
 * Persist a baseline report: one book_review_runs row + span-anchored
 * annotations (author "ai-critic"). Throws on relation-missing (42P01) — the
 * ROUTE catches that and falls back to JSONB review notes (gated migration
 * pattern, same as the annotations endpoints).
 */
export async function persistBaselineReport(
  db: Db,
  args: { bookId: string; companyId: string; report: BaselineReport; chapterId: string; content: string },
): Promise<{ runId: string; annotationCount: number; unanchored: number }> {
  const { bookId, companyId, report, chapterId, content } = args;
  const [run] = await db
    .insert(bookReviewRuns)
    .values({
      bookId,
      companyId,
      lens: "baseline",
      reviewer: "ai-critic",
      model: `${report.criticProvider}${report.criticDegraded ? " (fallback — pinned critic unavailable)" : ""}`,
      scope: `chapter:${report.chapterNumber}`,
      summary: `[${report.verdict}] ${report.summary}`.slice(0, 2000),
    })
    .returning();

  const hash = chapterContentHash(content);
  let annotationCount = 0;
  let unanchored = 0;
  for (const f of report.findings) {
    const idx = f.excerpt ? content.indexOf(f.excerpt) : -1;
    if (f.excerpt && idx < 0) unanchored++;
    await db.insert(bookAnnotations).values({
      bookId,
      chapterId,
      chapterNumber: report.chapterNumber,
      reviewRunId: run.id,
      spanStart: idx >= 0 ? idx : null,
      spanEnd: idx >= 0 ? idx + (f.excerpt?.length ?? 0) : null,
      contentHash: hash,
      kind: f.kind === "suggestion" ? "suggestion" : "review",
      body: f.excerpt && idx < 0
        ? `[unanchored — excerpt not found verbatim] "${f.excerpt.slice(0, 120)}" — ${f.note}`
        : f.note,
      author: "ai-critic",
    });
    annotationCount++;
  }
  return { runId: run.id, annotationCount, unanchored };
}
