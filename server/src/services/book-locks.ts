// Book Studio — LOCK enforcement (Spec v1 §7).
// Rule: locked = protected. The AI skips or asks, never clobbers — even on a
// directed revision, and even with ?overwrite=1 (Tyler's ruling, spec §8 #4).
// ① checked before generating AND again before persisting (TOCTOU) · ② directed
// revision is not exempt · ③ only the human author locks/unlocks, every change
// activity-logged · ④ locks compose — a chapter lock covers its prose + beats +
// passage locks; a passage lock covers its span; bible locks cover entry fields.
import type { Request } from "express";
import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { manuscriptChapters, passageLocks } from "@paperclipai/db";
import { conflict, forbidden } from "../errors.js";
import { getActorInfo } from "../routes/authz.js";
import { chapterContentHash } from "./book-prose-writer.js";

export const LOCKED_CODE = "LOCKED";

/** 409 payload shape — the UI maps this to the Locked-Content decision card. */
export function lockedError(scope: "chapter" | "passage" | "bible-entry", message: string) {
  return conflict(message, { code: LOCKED_CODE, scope });
}

/** Gated-migration pattern for passage_locks (0159), same as annotations/0151. */
export function isMissingLocksTable(err: unknown): boolean {
  const anyErr = err as { code?: string; cause?: { code?: string }; message?: string };
  if (anyErr?.code === "42P01" || anyErr?.cause?.code === "42P01") return true;
  return /relation "passage_locks" does not exist/i.test(String(anyErr?.message ?? ""));
}

/**
 * ③ Only the human author locks/unlocks — never an AI actor. Call on every
 * lock-changing endpoint (route guard, with tests).
 */
export function assertHumanActor(req: Request) {
  const actor = getActorInfo(req);
  if (actor.actorType !== "user") {
    throw forbidden("Only the human author can change locks — AI actors cannot lock or unlock.");
  }
  return actor;
}

/** Load a chapter's lock flag (false when no row exists yet). */
export async function getChapterLocked(db: Db, bookId: string, chapterNumber: number): Promise<boolean> {
  const [row] = await db
    .select({ locked: manuscriptChapters.locked })
    .from(manuscriptChapters)
    .where(and(eq(manuscriptChapters.bookId, bookId), eq(manuscriptChapters.chapterNumber, chapterNumber)));
  return row?.locked ?? false;
}

/**
 * ① Enforcement, chapter granularity — call before generating AND before
 * persisting on every AI write path. Refusal = 409 LOCKED.
 */
export async function assertChapterWritable(db: Db, bookId: string, chapterNumber: number) {
  if (await getChapterLocked(db, bookId, chapterNumber)) {
    throw lockedError("chapter", `Chapter ${chapterNumber} is locked — the AI never writes locked content. Unlock it first (or ask the author).`);
  }
}

export interface PassageLockWithState {
  id: string;
  spanStart: number;
  spanEnd: number;
  note: string;
  /** Content changed since the lock was anchored — shown honestly, still honored. */
  stale: boolean;
}

/** Passage locks for a chapter, with stale detection. Tolerant of the gated table. */
export async function getPassageLocks(
  db: Db, bookId: string, chapterNumber: number, content?: string,
): Promise<{ available: boolean; locks: PassageLockWithState[] }> {
  try {
    const rows = await db
      .select()
      .from(passageLocks)
      .where(and(eq(passageLocks.bookId, bookId), eq(passageLocks.chapterNumber, chapterNumber)));
    const hash = content != null ? chapterContentHash(content) : null;
    return {
      available: true,
      locks: rows.map((r) => ({
        id: r.id,
        spanStart: r.spanStart,
        spanEnd: r.spanEnd,
        note: r.note ?? "",
        stale: hash != null ? r.contentHash !== hash : false,
      })),
    };
  } catch (err) {
    if (!isMissingLocksTable(err)) throw err;
    return { available: false, locks: [] };
  }
}

export function spansOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Does a proposed write range overlap any locked passage? Used by the
 * directed-revision paths (② they are not exempt).
 */
export async function findOverlappingLocks(
  db: Db, bookId: string, chapterNumber: number, spanStart: number, spanEnd: number, content?: string,
): Promise<PassageLockWithState[]> {
  const { locks } = await getPassageLocks(db, bookId, chapterNumber, content);
  return locks.filter((l) => spansOverlap(spanStart, spanEnd, l.spanStart, l.spanEnd));
}
