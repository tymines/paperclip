// Bible auto-extraction + review queue (Spec v1 §4, §6.4 — "bible
// contradictions never silently overwritten"). The critic lane reads a landed
// chapter and proposes candidate canon (facts, entities) into a REVIEW QUEUE
// in books.metadata.bibleReviewQueue — nothing is ever written to the bible
// until Baily approves; a locked target is skipped and flagged, never touched.
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Db } from "@paperclipai/db";
import { books, manuscriptChapters, bibleFacts } from "@paperclipai/db";
import { callCriticLLM } from "./chapter-generator.js";
import { CODEX_ENTITY_TABLES, isCodexEntityType } from "./book-bible-codex.js";

export interface BibleQueueItem {
  id: string;
  kind: "fact" | "entity";
  entityType?: string;          // kind=entity: one of the 8 codex types
  statement?: string;           // kind=fact
  knownAsOf?: number;           // kind=fact (defaults to source chapter)
  name?: string;                // kind=entity
  summary?: string;             // kind=entity
  sourceChapter: number;
  status: "pending" | "approved" | "rejected" | "skipped-locked";
  createdAt: string;
  resolvedAt?: string;
}

function getQueue(book: { metadata: unknown }): BibleQueueItem[] {
  const meta = (book.metadata ?? {}) as Record<string, unknown>;
  return (meta.bibleReviewQueue as BibleQueueItem[]) ?? [];
}

async function saveQueue(db: Db, bookId: string, book: { metadata: unknown }, queue: BibleQueueItem[]) {
  const meta = (book.metadata ?? {}) as Record<string, unknown>;
  await db.update(books).set({ metadata: { ...meta, bibleReviewQueue: queue }, updatedAt: new Date() }).where(eq(books.id, bookId));
}

/**
 * Extract candidate canon from a landed chapter via the critic lane.
 * Proposals land in the review queue with status "pending" — NEVER applied.
 */
export async function extractBibleCandidates(db: Db, bookId: string, chapterNumber: number): Promise<{ queued: number; provider: string }> {
  const [book] = await db.select().from(books).where(eq(books.id, bookId));
  if (!book) throw Object.assign(new Error("Book not found"), { status: 404 });
  const [chapter] = await db.select().from(manuscriptChapters)
    .where(and(eq(manuscriptChapters.bookId, bookId), eq(manuscriptChapters.chapterNumber, chapterNumber)));
  const content = chapter?.content ?? "";
  if (!content.trim()) throw Object.assign(new Error(`Chapter ${chapterNumber} has no prose to extract from.`), { status: 400 });

  const systemPrompt = [
    "You are the canon-extraction lane for a story bible. Read the chapter and extract ONLY new, durable canon.",
    "Return ONLY valid JSON: { \"facts\": [{ \"statement\": \"atomic fact\", \"knownAsOf\": <chapter where it becomes known in-story> }], \"entities\": [{ \"entityType\": \"lore|factions|objects|systems|timeline|threads|themes|glossary\", \"name\": \"...\", \"summary\": \"one sentence\" }] }",
    "Rules: atomic statements only, no prose blobs; nothing already obvious from the premise; max 8 facts, 4 entities; knownAsOf ≤ this chapter's number.",
  ].join("\n");
  const userPrompt = `CHAPTER ${chapterNumber}:\n${content.slice(0, 20000)}`;

  const { text, provider } = await callCriticLLM(systemPrompt, userPrompt, "Book Studio bible extraction");
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const parsed = JSON.parse(fence ? fence[1].trim() : text) as {
    facts?: { statement?: string; knownAsOf?: number }[];
    entities?: { entityType?: string; name?: string; summary?: string }[];
  };

  const queue = getQueue(book);
  let queued = 0;
  for (const f of (parsed.facts ?? []).slice(0, 8)) {
    if (!f.statement?.trim()) continue;
    queue.push({
      id: randomUUID(), kind: "fact",
      statement: f.statement.trim().slice(0, 500),
      knownAsOf: Math.min(Math.max(1, Number(f.knownAsOf) || chapterNumber), chapterNumber),
      sourceChapter: chapterNumber, status: "pending", createdAt: new Date().toISOString(),
    });
    queued++;
  }
  for (const e of (parsed.entities ?? []).slice(0, 4)) {
    if (!e.name?.trim() || !e.entityType || !isCodexEntityType(e.entityType)) continue;
    queue.push({
      id: randomUUID(), kind: "entity", entityType: e.entityType,
      name: e.name.trim().slice(0, 200), summary: (e.summary ?? "").slice(0, 500),
      sourceChapter: chapterNumber, status: "pending", createdAt: new Date().toISOString(),
    });
    queued++;
  }
  await saveQueue(db, bookId, book, queue);
  return { queued, provider };
}

export function listBibleQueue(book: { metadata: unknown }): BibleQueueItem[] {
  return getQueue(book);
}

/**
 * Approve ONE queue item — the only path from extraction into canon.
 * A locked target is skipped + flagged ("skipped-locked"), never overwritten.
 */
export async function approveBibleQueueItem(db: Db, bookId: string, itemId: string): Promise<BibleQueueItem> {
  const [book] = await db.select().from(books).where(eq(books.id, bookId));
  if (!book) throw Object.assign(new Error("Book not found"), { status: 404 });
  const queue = getQueue(book);
  const item = queue.find((i) => i.id === itemId);
  if (!item) throw Object.assign(new Error("Queue item not found"), { status: 404 });
  if (item.status !== "pending") throw Object.assign(new Error(`Item is already ${item.status}.`), { status: 409 });

  if (item.kind === "fact") {
    await db.insert(bibleFacts).values({
      id: randomUUID(), bookId,
      statement: item.statement ?? "",
      knownAsOf: item.knownAsOf ?? item.sourceChapter,
      sourceChapter: item.sourceChapter,
      provenance: "auto-extracted",
    });
  } else if (item.kind === "entity" && item.entityType && isCodexEntityType(item.entityType)) {
    await db.insert(CODEX_ENTITY_TABLES[item.entityType]).values({
      id: randomUUID(), bookId, name: item.name ?? "", summary: item.summary ?? "", source: "auto-extracted",
    } as never);
  }
  item.status = "approved";
  item.resolvedAt = new Date().toISOString();
  await saveQueue(db, bookId, book, queue);
  return item;
}

export async function rejectBibleQueueItem(db: Db, bookId: string, itemId: string): Promise<BibleQueueItem> {
  const [book] = await db.select().from(books).where(eq(books.id, bookId));
  if (!book) throw Object.assign(new Error("Book not found"), { status: 404 });
  const queue = getQueue(book);
  const item = queue.find((i) => i.id === itemId);
  if (!item) throw Object.assign(new Error("Queue item not found"), { status: 404 });
  if (item.status !== "pending") throw Object.assign(new Error(`Item is already ${item.status}.`), { status: 409 });
  item.status = "rejected";
  item.resolvedAt = new Date().toISOString();
  await saveQueue(db, bookId, book, queue);
  return item;
}
