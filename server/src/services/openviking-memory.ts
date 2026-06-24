/**
 * War Room ⇄ OpenViking long-term memory bridge.
 *
 * The War Room direct-Hermes chat (jarvis-brain.ts) talks to the litellm /
 * AugiVector proxy directly, which means it never flowed through the Hermes
 * gateway's OpenViking memory provider — so nothing Tyler and Hermes discussed
 * in the War Room reached long-term memory, and a cleared session was gone for
 * good as far as recall was concerned.
 *
 * This module wires the War Room chat into OpenViking using ONLY OpenViking's
 * normal public ingest/query REST API (the same lifecycle the hermes-agent
 * `plugins/memory/openviking` provider uses):
 *
 *   - ingestChatTurn()        POST /api/v1/sessions/{id}/messages  (live, per turn)
 *   - commitAndResetSession() POST /api/v1/sessions/{id}/commit    (on "Clear chat")
 *   - recallLongTerm()        POST /api/v1/search/find             (recall on demand)
 *
 * It does NOT modify OpenViking internals, reassign slots, or touch QMD /
 * memory-core config. Every call is best-effort and fully isolated from the
 * user-facing reply path: a down or slow OpenViking never breaks chat.
 *
 * Memory-stack layering this enables:
 *   short-term working context = current session (bounded by "Clear chat",
 *     see fetchRecentTurns) — clean, resets on clear.
 *   long-term memory           = OpenViking, everything, queryable across
 *     sessions even after a clear.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { logger } from "../middleware/logger.js";

const ENDPOINT = (
  process.env.OPENVIKING_ENDPOINT ?? "http://127.0.0.1:1933"
).replace(/\/+$/, "");
const API_KEY = process.env.OPENVIKING_API_KEY ?? "";
const ACCOUNT = process.env.OPENVIKING_ACCOUNT ?? "default";
const USER = process.env.OPENVIKING_USER ?? "default";
// Default agent = "hermes" so War Room chat lands in the SAME memory space as
// the live Hermes gateway — "everything Tyler and Hermes discuss" unifies.
const AGENT = process.env.OPENVIKING_AGENT ?? "hermes";

const DEFAULT_TIMEOUT_MS = 8000;
const COMMIT_TIMEOUT_MS = 30000;
const RECALL_TIMEOUT_MS = 5000;
/** Checkpoint-commit a long unbroken session so it still flows to long-term. */
const CHECKPOINT_EVERY_TURNS = 12;
const MAX_MSG_CHARS = 4000;

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "X-OpenViking-Account": ACCOUNT,
    "X-OpenViking-User": USER,
    "X-OpenViking-Agent": AGENT,
  };
  if (API_KEY) h["X-API-Key"] = API_KEY;
  return h;
}

async function ovPost(
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${ENDPOINT}${path}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) {
      logger.warn(
        { path, status: resp.status },
        "openviking: non-2xx response",
      );
      return null;
    }
    return (await resp.json()) as any;
  } catch (err) {
    logger.warn({ err, path }, "openviking: request failed");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Per-(company, actor) OpenViking session registry. In-process + best-effort:
// on a server restart we simply open a fresh session on the next turn, which
// is fine — already-posted messages stay in OpenViking, and "Clear chat" only
// ever commits a session it can see. Single-user War Room means turns are
// effectively serial; a small pending-create guard avoids a double-create race.
// ---------------------------------------------------------------------------

interface SessionState {
  sessionId: string;
  turns: number;
}

const sessions = new Map<string, SessionState>();
const pendingCreate = new Map<string, Promise<string | null>>();

function key(companyId: string, userActorId: string): string {
  return `${companyId}::${userActorId}`;
}

async function ensureSession(k: string): Promise<string | null> {
  const existing = sessions.get(k);
  if (existing) return existing.sessionId;

  let pending = pendingCreate.get(k);
  if (!pending) {
    pending = (async () => {
      const res = await ovPost("/api/v1/sessions", {}, DEFAULT_TIMEOUT_MS);
      const sid: string | null = res?.result?.session_id ?? null;
      if (sid) sessions.set(k, { sessionId: sid, turns: 0 });
      return sid;
    })().finally(() => {
      pendingCreate.delete(k);
    });
    pendingCreate.set(k, pending);
  }
  return pending;
}

/**
 * File one chat turn into OpenViking long-term memory as session messages.
 * Fire-and-forget — callers `void` this; it never throws into the reply path.
 */
export async function ingestChatTurn(input: {
  companyId: string;
  userActorId: string;
  userText: string;
  assistantText: string;
}): Promise<void> {
  try {
    const userText = (input.userText ?? "").trim();
    const assistantText = (input.assistantText ?? "").trim();
    if (!userText && !assistantText) return;

    const k = key(input.companyId, input.userActorId);
    const sid = await ensureSession(k);
    if (!sid) return;

    if (userText)
      await ovPost(`/api/v1/sessions/${sid}/messages`, {
        role: "user",
        content: userText.slice(0, MAX_MSG_CHARS),
      });
    if (assistantText)
      await ovPost(`/api/v1/sessions/${sid}/messages`, {
        role: "assistant",
        content: assistantText.slice(0, MAX_MSG_CHARS),
      });

    const st = sessions.get(k);
    if (st) {
      st.turns += 1;
      if (st.turns % CHECKPOINT_EVERY_TURNS === 0) {
        // Periodic checkpoint so a session Tyler never clears still extracts
        // into long-term memory. The session stays open and keeps accruing.
        await ovPost(`/api/v1/sessions/${sid}/commit`, {}, COMMIT_TIMEOUT_MS);
        logger.info(
          { sessionId: sid, turns: st.turns },
          "openviking: checkpoint commit",
        );
      }
    }
  } catch (err) {
    logger.warn({ err }, "openviking: ingestChatTurn failed");
  }
}

/**
 * "Clear chat" boundary: commit the active OpenViking session (triggers
 * automatic memory extraction into long-term store) and drop it so the next
 * turn opens a genuinely fresh session. Everything stays STORED in OpenViking;
 * only the working session is reset. Best-effort.
 */
export async function commitAndResetSession(input: {
  companyId: string;
  userActorId: string;
}): Promise<{ committed: boolean; sessionId: string | null }> {
  const k = key(input.companyId, input.userActorId);
  const st = sessions.get(k);
  if (!st) return { committed: false, sessionId: null };

  // Drop first so a racing turn opens a new session rather than reusing this
  // one after we've committed it.
  sessions.delete(k);

  // Fire-and-forget the commit: extraction can take longer than a user should
  // ever wait on a "Clear chat" click, so we dispatch it in the background and
  // return immediately. The session messages were already posted live during
  // ingest, so nothing is lost if this process exits before extraction ends.
  void ovPost(
    `/api/v1/sessions/${st.sessionId}/commit`,
    {},
    COMMIT_TIMEOUT_MS,
  )
    .then((res) => {
      logger.info(
        { sessionId: st.sessionId, turns: st.turns, committed: res != null },
        "openviking: background session commit settled",
      );
    })
    .catch((err) => {
      logger.warn(
        { err, sessionId: st.sessionId },
        "openviking: background session commit failed",
      );
    });

  logger.info(
    { sessionId: st.sessionId, turns: st.turns },
    "openviking: session commit dispatched on clear",
  );
  return { committed: true, sessionId: st.sessionId };
}

export interface RecalledMemory {
  uri: string;
  score: number;
  abstract: string;
}

/**
 * Query OpenViking long-term memory. Used when the user references the past so
 * Hermes can pull older context back even after the working window was cleared.
 */
export async function recallLongTerm(
  query: string,
  limit = 6,
): Promise<RecalledMemory[]> {
  const q = (query ?? "").trim();
  if (!q) return [];

  const res = await ovPost(
    "/api/v1/search/find",
    { query: q.slice(0, 2000), top_k: limit },
    RECALL_TIMEOUT_MS,
  );
  const result = res?.result ?? {};
  const out: RecalledMemory[] = [];
  for (const bucket of ["memories", "resources"] as const) {
    const items = Array.isArray(result?.[bucket]) ? result[bucket] : [];
    for (const item of items) {
      const abstract: string = item?.abstract ?? "";
      if (!abstract) continue;
      out.push({
        uri: typeof item?.uri === "string" ? item.uri : "",
        score: typeof item?.score === "number" ? item.score : 0,
        abstract,
      });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/** Render recalled memories as a system-prompt block. */
export function formatRecallBlock(mems: RecalledMemory[]): string {
  if (!mems.length) return "";
  const lines = [
    "LONG-TERM MEMORY RECALL (retrieved from OpenViking — earlier conversations and sessions, including ones from before the chat was cleared. Use these to answer questions about the past; weave them in naturally and do not invent details beyond them):",
  ];
  for (const m of mems) {
    lines.push(`- [${m.score.toFixed(2)}] ${m.abstract}`);
  }
  return lines.join("\n");
}

/**
 * Cheap heuristic: does this turn reference past conversation? Gates the
 * long-term recall query so we only pay for it when it's relevant.
 */
export function referencesPast(transcript: string): boolean {
  if (!transcript) return false;
  return /\b(last week|last month|last session|earlier|previously|before i cleared|before we cleared|before the clear|before clearing|recall|remind me what|remember when|do you remember|what did we (discuss|talk|work|do|decide|cover|go over)|what have we (discussed|worked)|we (discussed|talked about|decided|worked on|covered)|you (said|mentioned|told me)|past conversation|our (history|conversations)|a while ago|the other day|yesterday|back then)\b/i.test(
    transcript,
  );
}


// ---------------------------------------------------------------------------
// Cleared-session RESOURCE archive + verbatim resource recall.
//
// Session extraction (commitAndResetSession above) distills a session into
// memories, which makes long-term recall gist-only. To make verbatim recall
// possible we ALSO write each cleared session's full transcript to disk and
// ingest it into OpenViking as a RESOURCE (/api/v1/resources). Resources keep
// the exact content, and grep over them (/api/v1/search/grep) returns literal
// lines deterministically — even when semantic embeddings are unavailable.
// This is additive and uses only OpenViking's normal public API.
// ---------------------------------------------------------------------------

const ARCHIVE_DIR =
  process.env.WARROOM_ARCHIVE_DIR ??
  path.join(os.homedir(), ".paperclip", "warroom-sessions");
// OpenViking namespace the transcripts are filed under. grep over the
// `warroom` root then spans every archived session for cross-session recall.
const RESOURCE_ROOT = "warroom";
const RESOURCE_NAMESPACE = `${RESOURCE_ROOT}/sessions`;

/**
 * Write a cleared session's full transcript to disk and ingest it into
 * OpenViking as a resource. Fire-and-forget: callers `void` this so the
 * "Clear chat" click never blocks. The on-disk copy is the source of record,
 * so nothing is lost even if the OpenViking ingest is slow or down.
 */
export async function archiveSessionAsResource(input: {
  companyId: string;
  userActorId: string;
  turns: { userTranscript: string; agentReply: string }[];
  clearedAt?: Date;
}): Promise<{ filePath: string | null; uri: string | null }> {
  try {
    const turns = (input.turns ?? []).filter(
      (t) => (t.userTranscript ?? "").trim() || (t.agentReply ?? "").trim(),
    );
    if (!turns.length) return { filePath: null, uri: null };

    const clearedAt = input.clearedAt ?? new Date();
    const stamp = clearedAt.toISOString().replace(/[:.]/g, "-");
    const safeActor = input.userActorId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const fileName = `session-${safeActor}-${stamp}.md`;

    const lines: string[] = [
      `# War Room session (cleared ${clearedAt.toISOString()})`,
      "",
      `Company: ${input.companyId}`,
      `Actor: ${input.userActorId}`,
      `Turns: ${turns.length}`,
      "",
      "---",
      "",
    ];
    for (const t of turns) {
      const u = (t.userTranscript ?? "").trim();
      const a = (t.agentReply ?? "").trim();
      if (u) lines.push(`Tyler: ${u}`, "");
      if (a) lines.push(`Hermes: ${a}`, "");
    }
    const body = lines.join("\n");

    await fs.mkdir(ARCHIVE_DIR, { recursive: true });
    const filePath = path.join(ARCHIVE_DIR, fileName);
    await fs.writeFile(filePath, body, "utf8");

    const to = `${RESOURCE_NAMESPACE}/${input.companyId}`;
    // wait:false -> returns immediately; indexing proceeds async. Best-effort.
    const res = await ovPost(
      "/api/v1/resources",
      {
        path: filePath,
        to,
        reason: "war-room cleared-session archive",
        instruction:
          "Verbatim War Room conversation transcript for a cleared session. Preserve exact content (names, codewords, numbers, decisions) for long-term recall.",
        wait: false,
      },
      COMMIT_TIMEOUT_MS,
    );
    const uri: string =
      (res?.result?.root_uri as string | undefined) ?? to;
    logger.info(
      { filePath, to, turns: turns.length, ingested: res != null },
      "openviking: cleared-session archived as resource",
    );
    return { filePath, uri };
  } catch (err) {
    logger.warn({ err }, "openviking: archiveSessionAsResource failed");
    return { filePath: null, uri: null };
  }
}

export interface ResourceMatch {
  uri: string;
  content: string;
}

const RECALL_STOP_WORDS = new Set([
  "the","a","an","and","or","of","to","in","on","for","with","it","is","are",
  "was","were","be","do","does","did","what","when","where","who","why","how",
  "we","i","you","me","my","our","us","that","this","these","those","about",
  "before","after","again","earlier","previously","previous","last","session",
  "sessions","clear","cleared","clearing","discuss","discussed","talk","talked",
  "talking","said","say","mention","mentioned","remember","recall","tell","told",
  "go","went","over","cover","covered","decide","decided","work","worked","just",
  "back","then","ago","while","time","chat","conversation","conversations",
]);

/** Pull distinctive keyword(s) from the user's question to grep resources for. */
export function salientTerms(query: string): string[] {
  const words = (query.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? []).filter(
    (w) => w.length >= 3 && !RECALL_STOP_WORDS.has(w),
  );
  const uniq = Array.from(new Set(words));
  // Longer tokens are more distinctive (codewords, proper nouns, topics).
  uniq.sort((a, b) => b.length - a.length);
  return uniq.slice(0, 6);
}

/**
 * Verbatim recall from archived session RESOURCES via OpenViking grep. Used for
 * OLDER cross-session recall — the immediately-prior session is served by the
 * Postgres fast-path (fetchLastClearedSession). Deterministic and content-
 * preserving; works even when semantic embeddings are unavailable.
 */
export async function recallSessionResources(
  query: string,
  limit = 8,
): Promise<ResourceMatch[]> {
  const terms = salientTerms(query).slice(0, 4);
  if (!terms.length) return [];
  // Run the per-term greps in PARALLEL so the worst-case latency is a single
  // timeout, never N sequential ones. grep can be slow when OpenViking is busy
  // indexing a freshly-ingested resource, so a sequential loop could otherwise
  // stack multiple timeouts onto the user-facing reply. Best-effort: a failed
  // or timed-out grep resolves to null and is simply skipped.
  const results = await Promise.all(
    terms.map((term) =>
      ovPost(
        "/api/v1/search/grep",
        { uri: RESOURCE_ROOT, pattern: term, case_insensitive: true },
        RECALL_TIMEOUT_MS,
      ).catch(() => null),
    ),
  );
  const seen = new Set<string>();
  const out: ResourceMatch[] = [];
  for (const res of results) {
    const matches = res?.result?.matches;
    if (!Array.isArray(matches)) continue;
    for (const m of matches) {
      const content: string = typeof m?.content === "string" ? m.content : "";
      const uri: string = typeof m?.uri === "string" ? m.uri : "";
      if (!content) continue;
      const k = `${uri}::${content}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ uri, content });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Render verbatim resource matches as a system-prompt block. */
export function formatResourceRecallBlock(matches: ResourceMatch[]): string {
  if (!matches.length) return "";
  const lines = [
    "VERBATIM MATCHES FROM ARCHIVED WAR ROOM SESSIONS (OpenViking resource search — exact lines from earlier, possibly older, cleared sessions. Treat as factual recall and quote specifics exactly; do not invent beyond them):",
  ];
  for (const m of matches) lines.push(`- ${m.content}`);
  return lines.join("\n");
}

/**
 * Tighter heuristic than referencesPast: does this turn reference the
 * IMMEDIATELY-PRIOR / just-cleared / last session specifically? Gates the
 * Postgres verbatim fast-path.
 */
export function referencesPriorSession(transcript: string): boolean {
  if (!transcript) return false;
  return /\b(before (i|we) cleared|before the clear|before clearing|just cleared|last session|previous session|prior session|earlier session|last (chat|conversation)|previous (chat|conversation)|what did we (discuss|talk about|cover|go over|work on|decide)|what were we (discuss|talk|working|doing)|what was (discussed|said))\b/i.test(
    transcript,
  );
}
