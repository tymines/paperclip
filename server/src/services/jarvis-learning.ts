import { and, desc, eq, gt, gte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  jarvisConversations,
  jarvisLearnedPreferences,
} from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { getRawKey } from "./provider-api-keys/index.js";

/**
 * Conversation memory + preference learning for the Jarvis brain.
 *
 * Two responsibilities:
 *
 *  1. Load context — the brain calls fetchRecentTurns() to pull the last N
 *     conversation rows (current actor + company) so the system prompt
 *     carries continuity across turns. fetchLearnedPreferences() pulls the
 *     top-confidence preferences and renders them into a system-prompt
 *     block.
 *
 *  2. Update memory — observeForPreferences() is fired-and-forgotten after
 *     each reply ships. It asks the configured LLM "did the user signal a
 *     new preference?" and upserts a row when the answer is yes. The user
 *     never waits for this.
 */

export interface RecentTurn {
  id: string;
  userTranscript: string;
  agentReply: string;
  createdAt: Date;
  source: string | null;
}

export interface LearnedPreferenceRow {
  key: string;
  value: string;
  confidence: number;
}

const HISTORY_TURNS = 5;
/** Older turns are kept as a single one-line summary instead of in full. */
const TRUNCATED_SUMMARY_CHARS = 140;

/**
 * Pull the most recent jarvis_conversations rows for this (company, actor)
 * in chronological order (oldest first). Returns up to HISTORY_TURNS rows.
 *
 * SESSION BOUNDARY: the working window is bounded by the most recent
 * "Clear chat". When Tyler clears, the route stamps cleared_at on the
 * then-visible rows; we treat MAX(cleared_at) for this (company, actor) as
 * the start of the current session and only load turns created AFTER it.
 * This makes "Clear chat" a genuine fresh session for the brain's working
 * context (clean + lower cost), while the rows themselves stay STORED (never
 * deleted) and everything also lives in long-term memory (OpenViking), which
 * is queried separately when Tyler references the past. If the chat was never
 * cleared, MAX(cleared_at) is NULL and all recent turns load as before.
 */
export async function fetchRecentTurns(
  db: Db,
  companyId: string,
  userActorId: string,
  limit: number = HISTORY_TURNS,
): Promise<RecentTurn[]> {
  try {
    // Find the current session boundary: the moment of the last "Clear chat".
    const boundaryRows = await db
      .select({
        lastCleared: sql<Date | null>`max(${jarvisConversations.clearedAt})`,
      })
      .from(jarvisConversations)
      .where(
        and(
          eq(jarvisConversations.companyId, companyId),
          eq(jarvisConversations.userActorId, userActorId),
        ),
      );
    // Raw max() over a timestamptz can come back as a string from the driver;
    // coerce to a Date so the gt() comparison binds as timestamptz (binding a
    // string would error: "operator does not exist: timestamptz > text").
    const rawLastCleared = boundaryRows[0]?.lastCleared ?? null;
    const lastCleared: Date | null = rawLastCleared
      ? rawLastCleared instanceof Date
        ? rawLastCleared
        : new Date(rawLastCleared as unknown as string)
      : null;

    const conditions = [
      eq(jarvisConversations.companyId, companyId),
      eq(jarvisConversations.userActorId, userActorId),
    ];
    // Only load turns from the current session (created after the last clear).
    if (lastCleared && !Number.isNaN(lastCleared.getTime())) {
      conditions.push(gt(jarvisConversations.createdAt, lastCleared));
    }

    const rows = await db
      .select({
        id: jarvisConversations.id,
        userTranscript: jarvisConversations.userTranscript,
        agentReply: jarvisConversations.agentReply,
        createdAt: jarvisConversations.createdAt,
        source: jarvisConversations.source,
      })
      .from(jarvisConversations)
      .where(and(...conditions))
      .orderBy(desc(jarvisConversations.createdAt))
      .limit(limit);
    return rows.reverse();
  } catch (err) {
    logger.warn({ err }, "jarvis-learning: fetchRecentTurns failed");
    return [];
  }
}

/**
 * Render recent turns as a CONVERSATION HISTORY block. The most recent
 * HISTORY_TURNS turns are shown in full; anything older is collapsed to a
 * truncated summary line so the system prompt stays bounded.
 */
export function formatConversationHistoryBlock(turns: RecentTurn[]): string {
  if (turns.length === 0) return "";
  const lines: string[] = [
    "CONVERSATION HISTORY (most recent turns between Tyler and you — use for continuity, do not repeat verbatim):",
  ];
  for (const t of turns) {
    const stamp = t.createdAt.toISOString();
    lines.push(`- [${stamp}] Tyler: ${truncate(t.userTranscript, 400)}`);
    lines.push(`  You: ${truncate(t.agentReply, 400)}`);
  }
  return lines.join("\n");
}

function truncate(text: string, max: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1).trimEnd() + "…";
}

/**
 * Pull learned preferences ordered by confidence (highest first). Caps at
 * 20 rows — well above what we'd ever surface — so the system prompt
 * stays bounded.
 */
export async function fetchLearnedPreferences(
  db: Db,
  companyId: string,
  userActorId: string,
): Promise<LearnedPreferenceRow[]> {
  try {
    const rows = await db
      .select({
        key: jarvisLearnedPreferences.key,
        value: jarvisLearnedPreferences.value,
        confidence: jarvisLearnedPreferences.confidence,
      })
      .from(jarvisLearnedPreferences)
      .where(
        and(
          eq(jarvisLearnedPreferences.companyId, companyId),
          eq(jarvisLearnedPreferences.userActorId, userActorId),
        ),
      )
      .orderBy(desc(jarvisLearnedPreferences.confidence))
      .limit(20);
    return rows.map((r) => ({
      key: r.key,
      value: r.value,
      confidence: Number(r.confidence),
    }));
  } catch (err) {
    logger.warn({ err }, "jarvis-learning: fetchLearnedPreferences failed");
    return [];
  }
}

export function formatLearnedPreferencesBlock(
  prefs: LearnedPreferenceRow[],
): string {
  if (prefs.length === 0) return "";
  const lines: string[] = [
    "LEARNED PREFERENCES (observed across past conversations — adapt to these unless Tyler overrides in the current turn):",
  ];
  for (const p of prefs) {
    lines.push(
      `- ${p.key} = ${p.value} (confidence ${p.confidence.toFixed(2)})`,
    );
  }
  return lines.join("\n");
}

/**
 * Upsert a single preference row. New rows take the supplied confidence;
 * existing rows have their confidence raised toward 1.0 by averaging,
 * value replaced with the most recent observation, and lastObservedAt
 * bumped to now.
 */
export async function upsertLearnedPreference(
  db: Db,
  input: {
    companyId: string;
    userActorId: string;
    key: string;
    value: string;
    confidence: number;
    sourceMessageId?: string | null;
  },
): Promise<void> {
  try {
    await db
      .insert(jarvisLearnedPreferences)
      .values({
        companyId: input.companyId,
        userActorId: input.userActorId,
        key: input.key,
        value: input.value,
        confidence: input.confidence,
        sourceMessageId: input.sourceMessageId ?? null,
      })
      .onConflictDoUpdate({
        target: [
          jarvisLearnedPreferences.companyId,
          jarvisLearnedPreferences.userActorId,
          jarvisLearnedPreferences.key,
        ],
        set: {
          value: input.value,
          confidence: sql`LEAST(1.0, (${jarvisLearnedPreferences.confidence} + ${input.confidence}) / 2.0 + 0.05)`,
          sourceMessageId: input.sourceMessageId ?? null,
          lastObservedAt: new Date(),
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    logger.warn({ err, key: input.key }, "jarvis-learning: upsert failed");
  }
}

/**
 * Fire-and-forget LLM observer. After a reply ships, ask the model whether
 * Tyler signaled a new preference. Returns the number of rows upserted (for
 * tests + logs); callers ignore the promise in prod.
 */
export async function observeForPreferences(
  db: Db,
  input: {
    companyId: string;
    userActorId: string;
    recentTurns: RecentTurn[];
    sourceMessageId?: string | null;
  },
): Promise<number> {
  if (input.recentTurns.length === 0) return 0;

  const apiKey = await getRawKey("anthropic").catch(() => null);
  if (!apiKey) return 0;

  const transcript = input.recentTurns
    .map((t) => `Tyler: ${t.userTranscript}\nAugi: ${t.agentReply}`)
    .join("\n\n");

  const observerPrompt = `You analyze short conversations between Tyler and his AI ops partner (Augi) to detect durable user preferences worth remembering.

Conversation:
${transcript}

Did Tyler signal any NEW preference in this exchange that should be remembered for future conversations? A preference is a stable, repeatable predilection (e.g. "wants short replies", "prefers mobile-style brevity", "always asks about agents before revenue"), NOT a one-off task or fact.

Respond with a single JSON object: { "preferences": [{ "key": "snake_case_slug", "value": "short value or phrase", "confidence": 0.0 to 1.0 }] }. Return an empty array if nothing new was signaled. No prose, just JSON.`;

  let parsed: { preferences?: Array<{ key?: string; value?: string; confidence?: number }> } = {};
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-opus-4-7",
          system:
            "You are a quiet observer. Return only well-formed JSON. Never speculate — if Tyler did not clearly signal a preference, return an empty array.",
          messages: [{ role: "user", content: observerPrompt }],
          max_tokens: 300,
          temperature: 0.1,
        }),
        signal: controller.signal,
      });
      if (!resp.ok) return 0;
      const json = (await resp.json()) as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const text = (json.content ?? [])
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("")
        .trim();
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start < 0 || end <= start) return 0;
      parsed = JSON.parse(text.slice(start, end + 1));
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    logger.warn({ err }, "jarvis-learning: observer call failed");
    return 0;
  }

  const prefs = Array.isArray(parsed.preferences) ? parsed.preferences : [];
  let upserts = 0;
  for (const pref of prefs) {
    if (!pref || typeof pref.key !== "string" || typeof pref.value !== "string") continue;
    const key = pref.key.trim();
    const value = pref.value.trim();
    if (!key || !value) continue;
    const confidence = clampConfidence(pref.confidence);
    if (confidence <= 0) continue;
    await upsertLearnedPreference(db, {
      companyId: input.companyId,
      userActorId: input.userActorId,
      key,
      value,
      confidence,
      sourceMessageId: input.sourceMessageId ?? null,
    });
    upserts += 1;
  }
  if (upserts > 0) {
    logger.info(
      { upserts, companyId: input.companyId, userActorId: input.userActorId },
      "jarvis-learning: observer upserted preferences",
    );
  }
  return upserts;
}

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}


// ---------------------------------------------------------------------------
// FAST-PATH verbatim recall of the immediately-prior (just-cleared) session.
// ---------------------------------------------------------------------------

export interface ClearedSessionTurn {
  id: string;
  userTranscript: string;
  agentReply: string;
  createdAt: Date;
}

/**
 * Read the EXACT turns of the most recently cleared War Room session straight
 * from Postgres — instant, verbatim, deterministic.
 *
 * Why this exists: OpenViking session-extraction distills + async-indexes, so
 * recall through it is gist-only. For "what did we discuss before I cleared?"
 * Tyler wants the literal content (codewords, names, numbers, decisions), not a
 * plausible paraphrase. A "Clear chat" stamps the SAME cleared_at on every
 * then-visible row, so the most recent cleared session is precisely the rows
 * whose cleared_at == MAX(cleared_at) for this (company, actor). We select those
 * directly. Older cross-session recall still goes through OpenViking resource
 * search (see openviking-memory.ts) — this fast-path is only the just-cleared
 * session, which is the one that needs to be verbatim and is cheap to fetch.
 */
export async function fetchLastClearedSession(
  db: Db,
  companyId: string,
  userActorId: string,
  limit: number = 40,
): Promise<ClearedSessionTurn[]> {
  try {
    const boundaryRows = await db
      .select({
        lastCleared: sql<Date | null>`max(${jarvisConversations.clearedAt})`,
      })
      .from(jarvisConversations)
      .where(
        and(
          eq(jarvisConversations.companyId, companyId),
          eq(jarvisConversations.userActorId, userActorId),
        ),
      );
    const rawLastCleared = boundaryRows[0]?.lastCleared ?? null;
    const lastCleared: Date | null = rawLastCleared
      ? rawLastCleared instanceof Date
        ? rawLastCleared
        : new Date(rawLastCleared as unknown as string)
      : null;
    // Never cleared -> no "prior session" to recall.
    if (!lastCleared || Number.isNaN(lastCleared.getTime())) return [];

    // cleared_at >= MAX(cleared_at) selects exactly the last-cleared batch
    // (nothing is greater than the max). Using gte rather than eq is robust to
    // any timestamptz precision rounding on the boundary round-trip.
    const rows = await db
      .select({
        id: jarvisConversations.id,
        userTranscript: jarvisConversations.userTranscript,
        agentReply: jarvisConversations.agentReply,
        createdAt: jarvisConversations.createdAt,
      })
      .from(jarvisConversations)
      .where(
        and(
          eq(jarvisConversations.companyId, companyId),
          eq(jarvisConversations.userActorId, userActorId),
          gte(jarvisConversations.clearedAt, lastCleared),
        ),
      )
      .orderBy(desc(jarvisConversations.createdAt))
      .limit(limit);
    return rows.reverse();
  } catch (err) {
    logger.warn({ err }, "jarvis-learning: fetchLastClearedSession failed");
    return [];
  }
}

/**
 * Render the just-cleared session as an authoritative VERBATIM system-prompt
 * block. Distinct from the long-term recall block (which is lossy gist): this
 * is the exact transcript, so the brain is told to answer word-for-word from it.
 */
export function formatClearedSessionBlock(turns: ClearedSessionTurn[]): string {
  if (!turns.length) return "";
  const lines = [
    "EXACT TRANSCRIPT OF THE IMMEDIATELY-PRIOR WAR ROOM SESSION (the one Tyler just cleared) — VERBATIM, read straight from the system of record. It is authoritative and complete for that session. When Tyler asks what was discussed before the clear / in the last or previous session, answer from THESE EXACT turns and preserve specific details (names, codewords, numbers, decisions) word-for-word. Do not paraphrase away specifics and do not invent anything beyond these turns:",
    "",
  ];
  for (const t of turns) {
    const u = (t.userTranscript ?? "").trim();
    const a = (t.agentReply ?? "").trim();
    if (u) lines.push(`Tyler: ${u}`);
    if (a) lines.push(`Hermes: ${a}`);
  }
  return lines.join("\n");
}
