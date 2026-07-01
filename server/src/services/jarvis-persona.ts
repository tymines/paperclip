import { promises as fs, watch as fsWatch, type FSWatcher } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { logger } from "../middleware/logger.js";

/**
 * Loads the Jarvis / Augi persona from disk with a 60s in-memory cache and
 * an fs.watch invalidation so Tyler can tune the prompt by saving the file
 * without restarting the server.
 *
 * Default path: ~/.openclaw/agents/codex/workspace/jarvis-augi-persona.md
 * Override:     JARVIS_PERSONA_PATH env var (tests + non-default installs).
 *
 * The persona text comes through verbatim. Two formatting transforms are
 * applied downstream by the brain:
 *
 *   - `voice_mode: true`  — markdown stripped, prose tightened.
 *   - `voice_mode: false` — markdown preserved.
 *
 * Version is a content-hash slice — automatic, no need for Tyler to bump
 * a number by hand. Stored on every jarvis_conversations row so the
 * effect of persona changes on reply quality can be audited later.
 */
const DEFAULT_PERSONA_PATH = path.join(
  os.homedir(),
  ".openclaw",
  "agents",
  "codex",
  "workspace",
  "jarvis-augi-persona.md",
);

const PERSONA_CACHE_TTL_MS = 60_000;

const FALLBACK_PERSONA = `You are Augi — Tyler Switzer's primary AI operations partner.
Calm, confident, direct. Lead with work, not revenue. Brevity > completeness.
Length budget: standard reply 2-3 sentences, briefing 4-6 sentences, end with one next-action suggestion.`;

interface PersonaCacheEntry {
  text: string;
  version: string;
  loadedAt: number;
  source: "file" | "fallback";
}

let cache: PersonaCacheEntry | null = null;
let watcher: FSWatcher | null = null;
let watcherPath: string | null = null;

function personaPath(): string {
  return process.env.JARVIS_PERSONA_PATH ?? DEFAULT_PERSONA_PATH;
}

function hashContents(text: string): string {
  return crypto.createHash("sha1").update(text).digest("hex").slice(0, 10);
}

function ensureWatcher(target: string): void {
  if (watcherPath === target && watcher) return;
  if (watcher) {
    try {
      watcher.close();
    } catch {}
  }
  try {
    watcher = fsWatch(target, { persistent: false }, (eventType) => {
      // ENOENT (file removed/replaced atomically) and 'change' both
      // mean: drop the cache so the next read re-fetches.
      logger.info({ eventType, target }, "jarvis-persona: file event, invalidating cache");
      cache = null;
    });
    watcher.on("error", (err) => {
      logger.warn({ err, target }, "jarvis-persona: watcher error");
    });
    watcherPath = target;
  } catch (err) {
    // File may not exist yet (Tyler hasn't created it) — fail silently;
    // the fallback persona will be used until he saves the file.
    logger.warn({ err, target }, "jarvis-persona: watcher init failed");
  }
}

export interface LoadedPersona {
  text: string;
  version: string;
  source: "file" | "fallback";
}

export async function loadPersona(): Promise<LoadedPersona> {
  const now = Date.now();
  if (cache && now - cache.loadedAt < PERSONA_CACHE_TTL_MS) {
    return { text: cache.text, version: cache.version, source: cache.source };
  }
  const target = personaPath();
  try {
    const text = await fs.readFile(target, "utf8");
    const version = hashContents(text);
    cache = { text, version, loadedAt: now, source: "file" };
    ensureWatcher(target);
    return { text, version, source: "file" };
  } catch (err) {
    // First call — log once that we're on the fallback. Subsequent calls
    // are silent until the file lands.
    const wasOnFile = cache?.source === "file";
    if (wasOnFile || !cache) {
      logger.warn({ err, target }, "jarvis-persona: load failed, using fallback");
    }
    const text = FALLBACK_PERSONA;
    const version = hashContents(text);
    cache = { text, version, loadedAt: now, source: "fallback" };
    // Keep trying to watch — Tyler may add the file later.
    ensureWatcher(target);
    return { text, version, source: "fallback" };
  }
}

/**
 * Strips markdown for TTS playback so the model's output doesn't read
 * literal "asterisk asterisk bold asterisk asterisk" through ElevenLabs.
 * Applied to the *persona* (system prompt) when voice_mode=true. The
 * brain also strips the same chars from the reply before piping it to
 * the speak() layer in case the model ignored the instruction.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")          // code fences
    .replace(/`([^`]+)`/g, "$1")              // inline code
    .replace(/\*\*([^*]+)\*\*/g, "$1")       // bold
    .replace(/__([^_]+)__/g, "$1")           // bold (alt)
    .replace(/\*([^*]+)\*/g, "$1")           // italic
    .replace(/_([^_]+)_/g, "$1")             // italic (alt)
    .replace(/^[ \t]*[-*+] +/gm, "")         // bullet markers
    .replace(/^[ \t]*\d+\.[ \t]+/gm, "")     // numbered list markers
    .replace(/^#{1,6}\s+/gm, "")              // headers
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // markdown links → text
    .replace(/^>\s?/gm, "")                   // blockquotes
    .replace(/\n{3,}/g, "\n\n")               // collapse triple+ newlines
    .trim();
}

/**
 * Formats the persona for a specific call. Adds a small mode-tail so the
 * model knows whether to use prose or markdown.
 */
export function formatPersonaForCall(
  persona: LoadedPersona,
  opts: { voiceMode: boolean; responseType: ResponseType }
): string {
  const base = opts.voiceMode ? stripMarkdown(persona.text) : persona.text;
  const lengthLine = lengthLineFor(opts.responseType, opts.voiceMode);
  const modeLine = opts.voiceMode
    ? "OUTPUT MODE: voice / TTS. Plain prose only. No markdown, no bullets, no asterisks, no code fences. Use contractions. Short clauses with natural comma pauses."
    : "OUTPUT MODE: text chat. Markdown is fine; use bullets only when listing more than three items.";
  return `${base}\n\n${modeLine}\n${lengthLine}`;
}

export type ResponseType = "quick" | "standard" | "briefing" | "detailed";

function lengthLineFor(responseType: ResponseType, voiceMode: boolean): string {
  switch (responseType) {
    case "quick":
      return `LENGTH BUDGET (HARD): one sentence + an optional one-sentence follow-up offer.${voiceMode ? " Spoken aloud — keep it crisp." : ""}`;
    case "briefing":
      return "LENGTH BUDGET (HARD): four to six sentences total. Lead with what shipped overnight, who's blocked, fleet status, then project progress. Do NOT enumerate every section — weave the four to six most important things into prose. End with ONE recommended next action.";
    case "detailed":
      return "LENGTH BUDGET (HARD): up to roughly 150 words. End with ONE recommended next action.";
    case "standard":
    default:
      return "LENGTH BUDGET (HARD): two to three sentences. End with ONE next-action question or suggestion. Never a wall of options.";
  }
}

/**
 * Enforce the length budget at the API layer. If the model goes over the
 * cap, truncate at the nearest sentence boundary and log the over-run
 * so the persona can be tuned. Better to cut mid-thought than ship a
 * wall of text.
 */
export interface LengthEnforcementResult {
  text: string;
  truncated: boolean;
  originalLength: number;
  budgetSentences: number;
}

export function enforceLengthBudget(
  reply: string,
  responseType: ResponseType,
): LengthEnforcementResult {
  const budget = budgetFor(responseType);
  const sentences = splitSentences(reply);
  const originalLength = reply.length;
  if (sentences.length <= budget) {
    return { text: reply, truncated: false, originalLength, budgetSentences: budget };
  }
  const trimmed = sentences.slice(0, budget).join(" ").trim();
  logger.info(
    {
      responseType,
      budget,
      original: sentences.length,
      kept: budget,
      droppedChars: reply.length - trimmed.length,
    },
    "jarvis-persona: reply exceeded length budget, truncated",
  );
  return { text: trimmed, truncated: true, originalLength, budgetSentences: budget };
}

function budgetFor(responseType: ResponseType): number {
  switch (responseType) {
    case "quick":
      return 2;
    case "briefing":
      return 6;
    case "detailed":
      return 12;
    case "standard":
    default:
      return 4; // soft pad: the persona says 2-3, allow up to 4 before truncating
  }
}

/**
 * Splits on sentence-ending punctuation but keeps the punctuation attached
 * to the preceding sentence. Handles abbreviations crudely — good enough
 * for spoken-prose replies, which is the target.
 */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  const re = /[^.!?]+[.!?]+(?:\s+|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[0].trim());
  }
  // Any tail without terminal punctuation — keep it as a sentence too
  const consumed = out.join(" ").length;
  const tail = text.slice(consumed).trim();
  if (tail) out.push(tail);
  return out;
}
