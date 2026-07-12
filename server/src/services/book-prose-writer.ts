// Book Studio — shared prose persistence (single source of truth).
// Every path that produces chapter prose (non-streaming write-prose, the SSE
// streaming endpoint, the assisted-mode next-chapter draft, and the autopilot
// prose loop) lands here, so the DB upsert + vault write-through + git commit
// behavior can never drift between paths.
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { manuscriptChapters } from "@paperclipai/db";

const BOOK_VAULT_ROOT =
  process.env.BOOK_STUDIO_VAULT_ROOT || "F:\\Augi Vault\\09 - Book Studio\\Books";

/** Stable hash of chapter content — annotation anchors pin to this. */
export function chapterContentHash(content: string): string {
  return createHash("sha256").update(content ?? "", "utf8").digest("hex").slice(0, 16);
}

export function writeChapterToVault(slug: string, chapterNumber: number, title: string, prose: string) {
  try {
    const dir = path.join(BOOK_VAULT_ROOT, slug, "chapters");
    fs.mkdirSync(dir, { recursive: true });
    const pad = String(chapterNumber).padStart(2, "0");
    const fm = `---\nnumber: ${chapterNumber}\ntitle: ${JSON.stringify(title)}\nhuman_locked: false\nupdated: ${new Date().toISOString()}\n---\n\n`;
    fs.writeFileSync(path.join(dir, `ch${pad}.md`), fm + prose, "utf8");
    const vaultDir = path.join(BOOK_VAULT_ROOT, slug);
    try {
      execSync("git add .", { cwd: vaultDir, stdio: "ignore", timeout: 5000 });
      execSync(`git commit -m "draft: ch${pad}"`, { cwd: vaultDir, stdio: "ignore", timeout: 5000 });
    } catch { /* best-effort: skip if not a git repo */ }
  } catch { /* vault write is best-effort; DB is authoritative */ }
}

export interface PersistProseResult {
  chapterId: string;
  chapterNumber: number;
  title: string;
  created: boolean;
}

/**
 * Upsert chapter prose into manuscript_chapters and write through to the vault.
 * Derives a title from the first prose line unless the existing row already has
 * one. Does NOT decide overwrite policy — callers enforce that before drafting.
 */
export async function persistChapterProse(
  db: Db,
  args: { bookId: string; bookSlug: string; chapterNumber: number; prose: string },
): Promise<PersistProseResult> {
  const { bookId, bookSlug, chapterNumber, prose } = args;

  const [existing] = await db
    .select()
    .from(manuscriptChapters)
    .where(and(eq(manuscriptChapters.bookId, bookId), eq(manuscriptChapters.chapterNumber, chapterNumber)));

  const firstLine = prose.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  const derivedTitle = firstLine.replace(/^#+\s*/, "").slice(0, 120).trim();
  const title = existing?.title?.trim() || derivedTitle || `Chapter ${chapterNumber}`;

  let chapterId: string;
  let created = false;
  if (existing) {
    await db
      .update(manuscriptChapters)
      .set({ content: prose, title, updatedAt: new Date() })
      .where(eq(manuscriptChapters.id, existing.id));
    chapterId = existing.id;
  } else {
    chapterId = randomUUID();
    await db.insert(manuscriptChapters).values({
      id: chapterId,
      bookId,
      chapterNumber,
      title,
      content: prose,
    });
    created = true;
  }

  writeChapterToVault(bookSlug, chapterNumber, title, prose);

  return { chapterId, chapterNumber, title, created };
}
