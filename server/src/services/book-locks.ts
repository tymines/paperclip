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
import { chapterContentHash, readVaultChapterFrontmatter, BOOK_VAULT_ROOT } from "./book-prose-writer.js";
import fs from "node:fs";
import path from "node:path";

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

/** Read the vault chapter file's `human_locked` frontmatter (fail-closed input). */
export function readVaultHumanLocked(bookSlug: string, chapterNumber: number): boolean {
  return readVaultChapterFrontmatter(bookSlug, chapterNumber).humanLocked;
}

// Lazily memoized per book: the vault→DB human_locked backfill runs at most
// once per book per process (see backfillChapterLocksFromVault).
const backfilledBooks = new Set<string>();

/**
 * Fail-closed backfill (migration 0158 follow-through): SQL cannot read the
 * vault, so the import of pre-existing `human_locked: true` frontmatter into
 * `manuscript_chapters.locked` happens here, at runtime — once per book,
 * before any enforcement decision. Sync is strictly UPWARD (false→true);
 * a vault `human_locked: false` never clears a DB lock (only the human
 * author unlocks, through the lock route).
 */
export async function backfillChapterLocksFromVault(db: Db, bookId: string, bookSlug: string): Promise<number> {
  let dir: string[];
  try {
    dir = fs.readdirSync(path.join(BOOK_VAULT_ROOT, bookSlug, "chapters"));
  } catch {
    return 0; // no vault chapters dir — nothing to import
  }
  let imported = 0;
  for (const file of dir) {
    const m = /^ch(\d+)\.md$/.exec(file);
    if (!m) continue;
    const chapterNumber = Number(m[1]);
    if (!readVaultHumanLocked(bookSlug, chapterNumber)) continue;
    const res = await db
      .update(manuscriptChapters)
      .set({ locked: true })
      .where(and(
        eq(manuscriptChapters.bookId, bookId),
        eq(manuscriptChapters.chapterNumber, chapterNumber),
        eq(manuscriptChapters.locked, false),
      ));
    imported += (res as { rowCount?: number } | undefined)?.rowCount ?? 0;
  }
  return imported;
}

async function ensureLocksBackfilled(db: Db, bookId: string, bookSlug: string) {
  if (backfilledBooks.has(bookId)) return;
  backfilledBooks.add(bookId); // mark first — a failed backfill must not hot-loop
  try {
    const imported = await backfillChapterLocksFromVault(db, bookId, bookSlug);
    if (imported > 0) console.warn(`[book-locks] fail-closed backfill: imported ${imported} human_locked chapter(s) for book ${bookId}`);
  } catch (err) {
    console.warn(`[book-locks] lock backfill failed for book ${bookId} (enforcement still reads vault live):`, err);
  }
}

/**
 * The fail-closed chapter-lock truth: DB `locked` OR vault `human_locked`
 * frontmatter. With a bookSlug, also triggers the one-time 0158 backfill and
 * syncs a vault lock UP into the DB row so the two never drift again.
 */
export async function resolveChapterLocked(
  db: Db, bookId: string, chapterNumber: number, bookSlug?: string,
): Promise<boolean> {
  if (bookSlug) {
    await ensureLocksBackfilled(db, bookId, bookSlug);
    if (readVaultHumanLocked(bookSlug, chapterNumber)) {
      // Sync upward — enforcement reads DB elsewhere too.
      await db
        .update(manuscriptChapters)
        .set({ locked: true })
        .where(and(
          eq(manuscriptChapters.bookId, bookId),
          eq(manuscriptChapters.chapterNumber, chapterNumber),
          eq(manuscriptChapters.locked, false),
        ));
      return true;
    }
  }
  return getChapterLocked(db, bookId, chapterNumber);
}

/**
 * ① Enforcement, chapter granularity — call before generating AND before
 * persisting on every AI write path. Refusal = 409 LOCKED. Pass bookSlug so
 * vault `human_locked` is honored too (fail-closed).
 */
export async function assertChapterWritable(db: Db, bookId: string, chapterNumber: number, bookSlug?: string) {
  if (await resolveChapterLocked(db, bookId, chapterNumber, bookSlug)) {
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

/**
 * ① The shared-sink guard (Spec v1 §7, review follow-up): persistChapterProse
 * calls this LIVE, immediately before writing, so every prose path — draft,
 * SSE stream, overwrite/redraft, assisted, autopilot, revision accept — is
 * covered atomically with no per-call-site drift.
 *
 * Verifies, in order:
 *  1. Chapter lock: DB `locked` OR vault `human_locked` (fail-closed), with
 *     upward DB sync. → 409 LOCKED (chapter)
 *  2. Passage locks: for every live lock on the chapter, the locked span's
 *     exact current text must survive verbatim in the new prose. A full
 *     replacement that would clobber a locked passage → 409 LOCKED (passage).
 *     Span-preserving writes (a diff proposal that edits elsewhere) pass.
 */
export async function assertProsePersistAllowed(
  db: Db,
  args: {
    bookId: string;
    bookSlug: string;
    chapterNumber: number;
    prose: string;
    existingContent: string;
    existingLocked: boolean;
    /** Human-approved one-time-unlock ONLY — passage locks still enforced. */
    skipChapterLock?: boolean;
  },
): Promise<void> {
  const { bookId, bookSlug, chapterNumber, prose, existingContent, existingLocked, skipChapterLock } = args;

  // 1. Chapter lock — DB flag OR vault frontmatter (fail-closed; syncs up).
  if (!skipChapterLock && (existingLocked || (await resolveChapterLocked(db, bookId, chapterNumber, bookSlug)))) {
    throw lockedError("chapter", `Chapter ${chapterNumber} is locked — the AI never writes locked content. Unlock it first (or ask the author).`);
  }

  // 2. Passage locks — a locked span's exact text must be preserved verbatim.
  const { locks } = await getPassageLocks(db, bookId, chapterNumber, existingContent);
  if (locks.length === 0) return;
  const violated: PassageLockWithState[] = [];
  for (const lock of locks) {
    const lockedText = existingContent.slice(lock.spanStart, lock.spanEnd);
    // Empty/invalid spans (content changed out from under the anchor) are
    // treated conservatively: a stale lock with no resolvable text still
    // blocks full replacements — locks are honored even when stale.
    if (lockedText.length === 0) {
      if (existingContent !== prose) violated.push(lock);
      continue;
    }
    if (!prose.includes(lockedText)) violated.push(lock);
  }
  if (violated.length > 0) {
    throw lockedError(
      "passage",
      `Chapter ${chapterNumber} has ${violated.length} locked passage${violated.length > 1 ? "s" : ""} this write would overwrite — locked spans must survive verbatim. Unlock them first (or ask the author).`,
    );
  }
}
