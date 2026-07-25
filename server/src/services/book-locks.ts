import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { manuscriptChapters, passageLocks, storyBibleOutline } from "@paperclipai/db";
import { HttpError } from "../errors.js";

export type LockScope = "chapter" | "passage";

export class LockedContentError extends HttpError {
  code = "LOCKED" as const;
  scope: LockScope;

  constructor(scope: LockScope, message: string) {
    super(409, message, { code: "LOCKED", scope, message });
    this.scope = scope;
  }
}

export function lockedPayload(err: LockedContentError) {
  return { code: err.code, scope: err.scope, message: err.message };
}

export function isLockedContentError(err: unknown): err is LockedContentError {
  return err instanceof LockedContentError || ((err as any)?.details?.code === "LOCKED");
}

export async function getManuscriptChapter(
  db: Db,
  bookId: string,
  chapterNumber: number,
) {
  return db
    .select()
    .from(manuscriptChapters)
    .where(and(eq(manuscriptChapters.bookId, bookId), eq(manuscriptChapters.chapterNumber, chapterNumber)))
    .then((rows) => rows[0] ?? null);
}

export async function assertChapterWriteUnlocked(
  db: Db,
  args: { bookId: string; chapterNumber: number; spanStart?: number | null; spanEnd?: number | null },
) {
  const manuscript = await getManuscriptChapter(db, args.bookId, args.chapterNumber);
  if (manuscript?.locked) {
    throw new LockedContentError(
      "chapter",
      `Chapter ${args.chapterNumber} is locked. Unlock it before changing prose or beats.`,
    );
  }

  const [outline] = await db
    .select({ locked: storyBibleOutline.locked })
    .from(storyBibleOutline)
    .where(and(eq(storyBibleOutline.bookId, args.bookId), eq(storyBibleOutline.chapterNumber, args.chapterNumber)));
  if (outline?.locked) {
    throw new LockedContentError(
      "chapter",
      `Chapter ${args.chapterNumber} is locked. Unlock it before changing prose or beats.`,
    );
  }

  const locks = await db
    .select()
    .from(passageLocks)
    .where(and(eq(passageLocks.bookId, args.bookId), eq(passageLocks.chapterNumber, args.chapterNumber)));
  if (locks.length === 0) return;

  if (typeof args.spanStart === "number" && typeof args.spanEnd === "number") {
    const overlaps = locks.some((lock) => args.spanStart! < lock.spanEnd && args.spanEnd! > lock.spanStart);
    if (!overlaps) return;
  }

  throw new LockedContentError(
    "passage",
    `Chapter ${args.chapterNumber} has a locked passage. Unlock it before changing overlapping prose.`,
  );
}
