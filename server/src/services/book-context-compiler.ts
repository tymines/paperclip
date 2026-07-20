// Book Studio — context compiler (Dispatch Build Spec §5).
// Assembles a per-chapter prompt from the APPROVED bible, in the exact order the
// spec mandates, so each chapter is drafted from a fresh packet of context rather
// than the model improvising from a vague memory. Reads existing tables only
// (story_bible_*, manuscript_chapters, books) — no new schema.
import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  books,
  storyBibleStyle,
  storyBibleCharacters,
  storyBibleWorldLocations,
  storyBibleOutline,
  manuscriptChapters,
} from "@paperclipai/db";
import { serializeStructured } from "./serialize-structured.js";

const TAIL_WORDS = 700; // ~last 500–800 words of the previous chapter, verbatim

function beatText(beats: unknown): string {
  if (!beats) return "";
  if (typeof beats === "string") return beats;
  try {
    // beats is jsonb — could be an array of {beat}/{text} or an object
    if (Array.isArray(beats)) {
      return beats.map((b) => (typeof b === "string" ? b : (b as any)?.beat ?? (b as any)?.text ?? JSON.stringify(b))).join("\n");
    }
    const o = beats as Record<string, unknown>;
    return String(o.text ?? o.beat ?? o.summary ?? JSON.stringify(o));
  } catch {
    return "";
  }
}

function lastWords(text: string, n: number): string {
  const words = (text || "").trim().split(/\s+/);
  return words.length <= n ? text.trim() : words.slice(-n).join(" ");
}

export interface CompiledContext {
  systemPrompt: string;
  userPrompt: string;
  usedCharacters: string[];
  usedLocations: string[];
  hasStyle: boolean;
  hasBeat: boolean;
}

/**
 * Compile the context packet for drafting `chapterNumber` of `bookId`.
 * Order (spec §5): style card → this beat + next beat → voice cards for the
 * characters appearing in this beat → place cards for its locations → world
 * rules tagged relevant (fallback all) → story-so-far → previous-chapter tail →
 * Baily's guidance note (top priority).
 */
export async function compileChapterContext(
  db: Db,
  bookId: string,
  chapterNumber: number,
  guidance?: string,
): Promise<CompiledContext> {
  const [book] = await db.select().from(books).where(eq(books.id, bookId));
  const [style] = await db.select().from(storyBibleStyle).where(eq(storyBibleStyle.bookId, bookId));
  const characters = await db.select().from(storyBibleCharacters).where(eq(storyBibleCharacters.bookId, bookId));
  const locations = await db.select().from(storyBibleWorldLocations).where(eq(storyBibleWorldLocations.bookId, bookId));
  const [thisBeat] = await db
    .select()
    .from(storyBibleOutline)
    .where(and(eq(storyBibleOutline.bookId, bookId), eq(storyBibleOutline.chapterNumber, chapterNumber)));
  const [nextBeat] = await db
    .select()
    .from(storyBibleOutline)
    .where(and(eq(storyBibleOutline.bookId, bookId), eq(storyBibleOutline.chapterNumber, chapterNumber + 1)));
  const [prevChapter] = await db
    .select()
    .from(manuscriptChapters)
    .where(and(eq(manuscriptChapters.bookId, bookId), eq(manuscriptChapters.chapterNumber, chapterNumber - 1)));

  const thisBeatText = beatText(thisBeat?.beats);
  const nextBeatText = beatText(nextBeat?.beats);
  const scope = `${thisBeatText}\n${nextBeatText}`.toLowerCase();

  // Voice cards: only characters appearing in this beat (name match); fallback = all.
  const appearing = characters.filter((c) => c.name && scope.includes(c.name.toLowerCase()));
  const useChars = appearing.length > 0 ? appearing : characters;
  // Place cards: only the beat's locations; fallback = all.
  const appearingLocs = locations.filter((l) => l.name && scope.includes(l.name.toLowerCase()));
  const useLocs = appearingLocs.length > 0 ? appearingLocs : locations;

  const meta = (book?.metadata ?? {}) as Record<string, unknown>;
  const premise = String(meta.premise ?? "");
  const storySoFar = String(meta.storySoFar ?? meta.story_so_far ?? "");

  const parts: string[] = [];

  // 1) Style card (always)
  if (style) {
    const lines = [
      style.pov ? `POV: ${style.pov}` : "",
      style.tense ? `Tense: ${style.tense}` : "",
      style.comps ? `Comps: ${style.comps}` : "",
      style.sampleParagraph ? `Approved sample paragraph (match this voice):\n${style.sampleParagraph}` : "",
      style.bannedCliches ? `Banned clichés / phrases (never use): ${style.bannedCliches}` : "",
    ].filter(Boolean);
    if (lines.length) parts.push(`## STYLE CARD\n${lines.join("\n")}`);
  }

  // 2) This chapter's beat + the next beat
  if (thisBeatText) {
    parts.push(`## THIS CHAPTER'S BEAT (chapter ${chapterNumber}${thisBeat?.title ? ` — ${thisBeat.title}` : ""})\n${thisBeatText}`);
  }
  if (nextBeatText) {
    parts.push(`## NEXT BEAT (for forward momentum — do NOT write it yet)\n${nextBeatText}`);
  }

  // 3) Voice cards for the characters in this beat
  if (useChars.length) {
    const cards = useChars.map((c) => {
      const vc = c.voiceCard ? `\nVoice:\n${serializeStructured(c.voiceCard)}` : "";
      return `- ${c.name}${c.role ? ` (${c.role})` : ""}: ${c.description ?? ""}${vc}`;
    });
    parts.push(`## CHARACTERS IN THIS SCENE (honor voice cards exactly)\n${cards.join("\n")}`);
  }

  // 4) Place cards for the beat's locations
  if (useLocs.length) {
    const cards = useLocs.map((l) => {
      const sensory = l.sensoryNotes ? `\nSensory/mood:\n${serializeStructured(l.sensoryNotes)}` : "";
      return `- ${l.name}: ${l.description ?? ""}${sensory}`;
    });
    parts.push(`## PLACES IN THIS SCENE\n${cards.join("\n")}`);
  }

  // 5) World rules (hard constraints — never contradict)
  const rules = useLocs.map((l) => l.rules).filter(Boolean);
  if (rules.length) {
    const ruleTexts = rules.map((r) => serializeStructured(r));
    parts.push(`## WORLD RULES (hard constraints — never contradict)\n${ruleTexts.join("\n\n")}`);
  }

  // 6) Story so far (rolling summary)
  if (storySoFar) parts.push(`## STORY SO FAR\n${storySoFar}`);
  else if (premise) parts.push(`## PREMISE\n${premise}`);

  // 7) Tail of the previous chapter, verbatim
  if (prevChapter?.content) {
    parts.push(`## END OF THE PREVIOUS CHAPTER (continue seamlessly from here)\n…${lastWords(prevChapter.content, TAIL_WORDS)}`);
  }

  // 8) Baily's guidance note — top priority
  if (guidance && guidance.trim()) {
    parts.push(`## BAILY'S GUIDANCE FOR THIS CHAPTER (highest priority — follow this above all)\n${guidance.trim()}`);
  }

  const systemPrompt =
    "You are the writer lane for a book studio. Draft ONE chapter of publishable prose — not an outline, not beats, not notes. " +
    "Write the actual scene: paragraphs, dialogue, description. Obey the STYLE CARD's POV/tense and the character voice cards exactly. " +
    "Never contradict a WORLD RULE. Continue seamlessly from the previous chapter's ending if provided. Do not summarize the beat — dramatize it. " +
    "Return only the chapter prose (you may open with a chapter title line). Aim for a complete, satisfying chapter.";

  const userPrompt =
    `Book: ${book?.title ?? "Untitled"}\nWrite chapter ${chapterNumber} as full prose using ONLY the approved context below.\n\n` +
    (parts.length ? parts.join("\n\n") : "(No bible context is available yet — draft from the premise and keep it consistent.)");

  // Final invariant: the assembled prompt must never contain raw "[object Object]"
  if (userPrompt.includes("[object Object]")) {
    throw new Error(
      "Invariant violation: userPrompt contains raw '[object Object]' — a JSONB field " +
        "was not properly serialized. All JSONB fields must flow through serializeStructured.",
    );
  }

  return {
    systemPrompt,
    userPrompt,
    usedCharacters: useChars.map((c) => c.name),
    usedLocations: useLocs.map((l) => l.name),
    hasStyle: Boolean(style),
    hasBeat: Boolean(thisBeatText),
  };
}
