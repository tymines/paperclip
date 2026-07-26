// Data migrations — awaited steps that run as part of `pnpm migrate`, after
// the SQL journal is applied and BEFORE the deploy is considered complete
// (so writes are never accepted against un-backfilled state).
//
// 0159 follow-through (Spec v1 §7): SQL cannot read the vault filesystem, so
// the import of pre-existing `human_locked: true` chapter frontmatter into
// manuscript_chapters.locked lives here. Idempotent and strictly UPWARD —
// a vault `human_locked: false` never clears a DB lock (only the human
// author unlocks, through the lock route).
import fs from "node:fs";
import path from "node:path";
import { eq, and } from "drizzle-orm";
import { books } from "../schema/books.js";
import { manuscriptChapters } from "../schema/manuscript_chapters.js";
import type { Db } from "../client.js";

const DEFAULT_VAULT_ROOT = "F:\\Augi Vault\\09 - Book Studio\\Books";

function vaultRoot(): string {
  return process.env.BOOK_STUDIO_VAULT_ROOT || DEFAULT_VAULT_ROOT;
}

function chapterHumanLocked(bookSlug: string, chapterNumber: number): boolean {
  try {
    const pad = String(chapterNumber).padStart(2, "0");
    const file = path.join(vaultRoot(), bookSlug, "chapters", `ch${pad}.md`);
    const head = fs.readFileSync(file, "utf8").slice(0, 1000);
    const m = head.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return false;
    return /^\s*human_locked:\s*true\s*$/m.test(m[1]);
  } catch {
    return false;
  }
}

/**
 * Import vault `human_locked: true` chapters into manuscript_chapters.locked.
 * Awaits completion; returns the number of rows flipped upward. Safe to run
 * repeatedly. When `scope` is given, only that one book is backfilled
 * (used by targeted tests).
 */
export async function runChapterLockBackfill(
  db: Db,
  scope?: { bookId: string; bookSlug: string },
): Promise<number> {
  const bookRows = scope
    ? [{ id: scope.bookId, slug: scope.bookSlug }]
    : await db.select({ id: books.id, slug: books.slug }).from(books);

  let imported = 0;
  for (const book of bookRows) {
    let files: string[];
    try {
      files = fs.readdirSync(path.join(vaultRoot(), book.slug, "chapters"));
    } catch {
      continue; // no vault chapters dir for this book
    }
    for (const file of files) {
      const m = /^ch(\d+)\.md$/.exec(file);
      if (!m) continue;
      const chapterNumber = Number(m[1]);
      if (!chapterHumanLocked(book.slug, chapterNumber)) continue;
      const res = await db
        .update(manuscriptChapters)
        .set({ locked: true })
        .where(and(
          eq(manuscriptChapters.bookId, book.id),
          eq(manuscriptChapters.chapterNumber, chapterNumber),
          eq(manuscriptChapters.locked, false),
        ));
      imported += (res as unknown as { rowCount?: number })?.rowCount ?? 0;
    }
  }
  return imported;
}
