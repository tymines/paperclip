// Story Bible codex (Spec v1 §4.1) — the structured canon store.
// ① 12 entity types (8 new codex tables + existing characters/locations +
// style/outline as non-entity surfaces) · ② typed relationships · ③ atomic
// facts · ④ spoiler gating via known_as_of.
import { eq, and, asc, lte, gt } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  bibleLore,
  bibleFactions,
  bibleObjects,
  bibleSystems,
  bibleTimelineEvents,
  bibleThreads,
  bibleThemes,
  bibleGlossary,
  bibleRelationships,
  bibleFacts,
  type BibleFact,
} from "@paperclipai/db";

/** The 8 codex entity types → their tables. Characters/Locations keep their
 * existing tables + routes (Tyler's ruling); style/outline stay non-entity. */
export const CODEX_ENTITY_TABLES = {
  lore: bibleLore,
  factions: bibleFactions,
  objects: bibleObjects,
  systems: bibleSystems,
  timeline: bibleTimelineEvents,
  threads: bibleThreads,
  themes: bibleThemes,
  glossary: bibleGlossary,
} as const;

export type CodexEntityType = keyof typeof CODEX_ENTITY_TABLES;

/** Entity types usable as relationship endpoints / fact entityRefs. */
export const RELATIONSHIP_ENTITY_TYPES = [
  "character", "location", ...Object.keys(CODEX_ENTITY_TABLES),
] as const;

export function isCodexEntityType(v: string): v is CodexEntityType {
  return v in CODEX_ENTITY_TABLES;
}

/** Gated-migration pattern (0159), same as passage_locks/0158. */
export function isMissingCodexTable(err: unknown): boolean {
  const anyErr = err as { code?: string; cause?: { code?: string }; message?: string };
  if (anyErr?.code === "42P01" || anyErr?.cause?.code === "42P01") return true;
  return /relation "bible_(lore|factions|objects|systems|timeline_events|threads|themes|glossary|relationships|facts)" does not exist/i.test(
    String(anyErr?.message ?? ""),
  );
}

export const PENDING_0159 =
  "Story Bible codex tables pending migration 0159 — codex unavailable until it is applied.";

export interface ChapterFacts {
  /** Facts the writer/critic may see for chapter N (known_as_of ≤ N). */
  known: BibleFact[];
  /** Withheld from the model — author-only until their reveal chapter. */
  withheld: BibleFact[];
}

/**
 * ④ Spoiler gating — the ONLY way facts reach the writer's context packet,
 * the critic's fact-check, or the consistency engine. Tolerant of the gated
 * table: pre-0159 there are simply no facts.
 */
export async function factsForChapter(db: Db, bookId: string, chapterNumber: number): Promise<ChapterFacts> {
  try {
    const rows = await db
      .select()
      .from(bibleFacts)
      .where(and(eq(bibleFacts.bookId, bookId), lte(bibleFacts.knownAsOf, chapterNumber)))
      .orderBy(asc(bibleFacts.knownAsOf));
    const withheldRows = await db
      .select()
      .from(bibleFacts)
      .where(and(eq(bibleFacts.bookId, bookId), gt(bibleFacts.knownAsOf, chapterNumber)))
      .orderBy(asc(bibleFacts.knownAsOf));
    return { known: rows, withheld: withheldRows };
  } catch (err) {
    if (!isMissingCodexTable(err)) throw err;
    return { known: [], withheld: [] };
  }
}

/** All relationships for a book (Canon inspector meters; gate constraints). */
export async function relationshipsForBook(db: Db, bookId: string) {
  try {
    return await db
      .select()
      .from(bibleRelationships)
      .where(eq(bibleRelationships.bookId, bookId));
  } catch (err) {
    if (!isMissingCodexTable(err)) throw err;
    return [];
  }
}
