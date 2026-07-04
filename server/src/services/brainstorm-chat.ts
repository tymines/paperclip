/**
 * Brainstorm Chat — Gemini 2.5 Pro reasoning layer for Book Studio.
 *
 * Uses the same OpenAI-compatible endpoint as design-chat.ts but with a
 * richer system prompt that injects the full story bible context so the
 * model can reason about characters, world, style, and outline together.
 *
 * NO streaming — simple request/response.
 */

export const BRAINSTORM_MODEL = "gemini-2.5-pro";

// Gemini's OpenAI-compatible Chat Completions endpoint.
const GEMINI_OPENAI_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

export class BrainstormModelUnconfiguredError extends Error {
  constructor() {
    super(
      "Brainstorm chat model (Gemini 2.5 Pro) not configured — set GEMINI_API_KEY or GOOGLE_API_KEY.",
    );
    this.name = "BrainstormModelUnconfiguredError";
  }
}

export function geminiApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.GEMINI_API_KEY || env.GOOGLE_API_KEY || null;
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface BibleContext {
  bookTitle: string;
  characters: Array<{ name: string; role: string; description: string }>;
  locations: Array<{ name: string; description: string }>;
  styles: Array<{ pov: string; tense: string; comps: string; sampleParagraph: string }>;
  outlines: Array<{ chapterNumber: number; title: string; beats: Record<string, unknown>[] }>;
}

export interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
}

// ── System Prompt Builder ────────────────────────────────────────────────────

function buildSystemPrompt(context: BibleContext): string {
  const parts: string[] = [
    `You are a creative brainstorming partner for a book titled "${context.bookTitle}".`,
    "You help the author develop characters, world-building, writing style, and plot structure.",
    "You have access to the full story bible for this book and should use it to inform your responses.",
    "Be thoughtful, constructive, and creative. Ask clarifying questions when needed.",
    "Keep responses focused on the book and its development.\n",
  ];

  // Characters
  if (context.characters.length > 0) {
    parts.push("--- CHARACTERS ---");
    for (const c of context.characters) {
      parts.push(`- ${c.name} (${c.role}): ${c.description}`);
    }
    parts.push("");
  }

  // Locations
  if (context.locations.length > 0) {
    parts.push("--- WORLD LOCATIONS ---");
    for (const l of context.locations) {
      parts.push(`- ${l.name}: ${l.description}`);
    }
    parts.push("");
  }

  // Style
  if (context.styles.length > 0) {
    parts.push("--- STYLE ---");
    for (const s of context.styles) {
      const details = [`POV: ${s.pov}`, `Tense: ${s.tense}`, `Comparables: ${s.comps}`].join(", ");
      parts.push(`- ${details}`);
      if (s.sampleParagraph) {
        parts.push(`  Sample: "${s.sampleParagraph.slice(0, 300)}"`);
      }
    }
    parts.push("");
  }

  // Outlines
  if (context.outlines.length > 0) {
    parts.push("--- OUTLINE ---");
    for (const o of context.outlines) {
      const beatCount = Array.isArray(o.beats) ? o.beats.length : 0;
      parts.push(`- Chapter ${o.chapterNumber}: "${o.title}" (${beatCount} beats)`);
    }
    parts.push("");
  }

  return parts.join("\n");
}

// ── Main Service ─────────────────────────────────────────────────────────────

/**
 * Call Gemini 2.5 Pro for a brainstorm chat response.
 * Returns the assistant reply text, or throws on error.
 */
export async function callBrainstormChat(
  context: BibleContext,
  history: HistoryEntry[],
  userMessage: string,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  const resolvedEnv = env ?? process.env;
  const key = geminiApiKey(resolvedEnv);
  if (!key) throw new BrainstormModelUnconfiguredError();

  const systemPrompt = buildSystemPrompt(context);

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: userMessage },
  ];

  // 45-second timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45_000);

  try {
    const resp = await fetch(GEMINI_OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: BRAINSTORM_MODEL,
        stream: false,
        temperature: 0.8,
        messages,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      throw new Error(`Gemini request failed (${resp.status}): ${detail.slice(0, 300)}`);
    }

    const json = await resp.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const reply = json?.choices?.[0]?.message?.content;
    if (!reply) throw new Error("Empty reply from Gemini");

    return reply;
  } finally {
    clearTimeout(timeoutId);
  }
}
