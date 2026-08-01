/**
 * Brainstorm Chat — shared prompt/context types for Book Studio's
 * brainstorm/co-writer window.
 *
 * PR #30 (Tyler's law): this window IS Calliope, the live agent, reached
 * through the peer-delegation contract (book-agent-lanes.ts). The raw
 * Gemini 2.5 Pro call path was REMOVED — a raw-model answer is never passed
 * off as (or silently substituted for) the named agent. What remains here
 * is the exact bible brief builder the Calliope lane receives, plus the
 * shared context/history types.
 */

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

// The Calliope agent lane (book-agent-lanes.ts) receives this exact bible
// brief as the head of its delegation task.
export function buildSystemPrompt(context: BibleContext): string {
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
