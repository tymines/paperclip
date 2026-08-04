/**
 * Brainstorm Chat prompt builder for Book Studio's live Calliope lane.
 *
 * Runtime execution belongs exclusively to Calliope. This module only builds
 * the story-bible brief that Paperclip sends through the agent-lane contract.
 */

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

// Exported so the route can hand the live Calliope agent a complete bible brief.
export function buildSystemPrompt(context: BibleContext): string {
  const parts: string[] = [
    `You are a creative brainstorming partner for a book titled "${context.bookTitle}".`,
    "You help the author develop characters, world-building, writing style, and plot structure.",
    "You have access to the full story bible for this book and should use it to inform your responses.",
    "Be thoughtful, constructive, and creative. Ask clarifying questions when needed.",
    "Keep responses focused on the book and its development.\n",
  ];

  if (context.characters.length > 0) {
    parts.push("--- CHARACTERS ---");
    for (const c of context.characters) {
      parts.push(`- ${c.name} (${c.role}): ${c.description}`);
    }
    parts.push("");
  }

  if (context.locations.length > 0) {
    parts.push("--- WORLD LOCATIONS ---");
    for (const l of context.locations) {
      parts.push(`- ${l.name}: ${l.description}`);
    }
    parts.push("");
  }

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
