// Book Studio — shared prose persistence (single source of truth).
// Every path that produces chapter prose (non-streaming write-prose, the SSE
// streaming endpoint, the assisted-mode next-chapter draft, and the autopilot
// prose loop) lands here, so the DB upsert + vault write-through + git commit
// behavior can never drift between paths.
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { eq, and, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { manuscriptChapters } from "@paperclipai/db";
// LOCK (Spec v1 §7): the sink enforces locks itself — every prose path lands
// here, so a single serializable transaction covers them all atomically.
// Function-level use only (book-locks imports chapterContentHash from this
// module — circular refs stay inside function bodies).
import { assertProsePersistAllowed, lockedError } from "./book-locks.js";

export const BOOK_VAULT_ROOT =
  process.env.BOOK_STUDIO_VAULT_ROOT || "F:\\Augi Vault\\09 - Book Studio\\Books";

/** Vault root resolved per call — honors BOOK_STUDIO_VAULT_ROOT changes (tests, multi-env). */
export function bookVaultRoot(): string {
  return process.env.BOOK_STUDIO_VAULT_ROOT || BOOK_VAULT_ROOT;
}

/** Stable hash of chapter content — annotation anchors pin to this. */
export function chapterContentHash(content: string): string {
  return createHash("sha256").update(content ?? "", "utf8").digest("hex").slice(0, 16);
}

/**
 * Read a chapter's vault frontmatter. Tolerant: a missing/unparseable file
 * means "no vault lock". Only the frontmatter head is read.
 */
export function readVaultChapterFrontmatter(bookSlug: string, chapterNumber: number): { humanLocked: boolean } {
  try {
    const pad = String(chapterNumber).padStart(2, "0");
    const file = path.join(bookVaultRoot(), bookSlug, "chapters", `ch${pad}.md`);
    const head = fs.readFileSync(file, "utf8").slice(0, 1000);
    const m = head.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return { humanLocked: false };
    return { humanLocked: /^\s*human_locked:\s*true\s*$/m.test(m[1]) };
  } catch {
    return { humanLocked: false };
  }
}

export function writeChapterToVault(
  slug: string, chapterNumber: number, title: string, prose: string, locked = false,
  opts?: { preserveVaultLock?: boolean },
) {
  try {
    const dir = path.join(bookVaultRoot(), slug, "chapters");
    fs.mkdirSync(dir, { recursive: true });
    const pad = String(chapterNumber).padStart(2, "0");
    // LOCK: write-through NEVER downgrades a vault human_locked back to false —
    // once the author human-locks a chapter file, only she unlocks it. Her
    // explicit unlock route opts out via preserveVaultLock: false.
    const effectiveLocked = opts?.preserveVaultLock === false
      ? locked
      : locked || readVaultChapterFrontmatter(slug, chapterNumber).humanLocked;
    const fm = `---\nnumber: ${chapterNumber}\ntitle: ${JSON.stringify(title)}\nhuman_locked: ${effectiveLocked}\nupdated: ${new Date().toISOString()}\n---\n\n`;
    fs.writeFileSync(path.join(dir, `ch${pad}.md`), fm + prose, "utf8");
    const vaultDir = path.join(bookVaultRoot(), slug);
    try {
      execSync("git add .", { cwd: vaultDir, stdio: "ignore", timeout: 5000 });
      execSync(`git commit -m "draft: ch${pad}"`, { cwd: vaultDir, stdio: "ignore", timeout: 5000 });
    } catch { /* best-effort: skip if not a git repo */ }
  } catch { /* vault write is best-effort; DB is authoritative */ }
}

/**
 * Normalize the chapter's leading heading (acceptance finding #7: drafts came
 * back with `### Chapter 1`, plain `Chapter 2:`, `## Chapter 3`, `# Chapter 9`…
 * making exports ragged). If the prose opens with any recognizable chapter
 * heading, rewrite it to a consistent `## Chapter N: Title` (or `## Chapter N`
 * when the model gave no title text). Prose that opens straight into narrative
 * is left untouched.
 */
export function normalizeChapterHeading(prose: string, chapterNumber: number): string {
  const lines = prose.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.trim().length > 0);
  if (idx === -1) return prose;
  const first = lines[idx].trim();
  // Matches: "# Chapter 9", "Chapter 2:", "## Chapter 3 — Title", "Chapter 4 - Title" …
  const m = first.match(/^#{0,6}\s*chapter\s+(\d+)\s*[:—–\-.]?\s*(.*)$/i);
  if (!m) return prose;
  const titleText = m[2].replace(/^#+\s*/, "").replace(/[*_]+/g, "").trim();
  lines[idx] = titleText ? `## Chapter ${chapterNumber}: ${titleText}` : `## Chapter ${chapterNumber}`;
  return lines.join("\n");
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
 *
 * LOCK (Spec v1 §7 ①): this shared sink is the enforcement point, and it is
 * ATOMIC — not check-then-write. The lock read, the passage-lock preservation
 * check, and the mutation all run inside ONE serializable transaction whose
 * UPDATE carries `WHERE locked = false`: a lock set by anyone, at any moment
 * before commit, either fails the predicate (0 rows → 409) or aborts the
 * transaction (serialization failure → 409). No TOCTOU window exists.
 * Pass `lockGuard: false` only for trusted human-actor paths that already ran
 * their own actor check.
 */
export async function persistChapterProse(
  db: Db,
  args: { bookId: string; bookSlug: string; chapterNumber: number; prose: string },
  opts?: { lockGuard?: boolean; skipChapterLock?: boolean },
): Promise<PersistProseResult> {
  const { bookId, bookSlug, chapterNumber } = args;
  // Consistent `## Chapter N: Title` headings across every write path (#7).
  const prose = normalizeChapterHeading(args.prose, chapterNumber);
  const skipChapterLock = opts?.skipChapterLock === true;

  const writeTx = async (tx: Db, guarded: boolean): Promise<PersistProseResult & { wasLocked: boolean }> => {
    const [existing] = await tx
      .select()
      .from(manuscriptChapters)
      .where(and(eq(manuscriptChapters.bookId, bookId), eq(manuscriptChapters.chapterNumber, chapterNumber)));

    // ① Guard: chapter lock (DB + vault human_locked) + passage-lock
    // preservation — evaluated INSIDE the transaction when guarded.
    if (guarded) {
      await assertProsePersistAllowed(tx, {
        bookId,
        bookSlug,
        chapterNumber,
        prose,
        existingContent: existing?.content ?? "",
        existingLocked: existing?.locked ?? false,
        skipChapterLock,
      });
    }

    const firstLine = prose.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
    const derivedTitle = firstLine.replace(/^#+\s*/, "").slice(0, 120).trim();
    const title = existing?.title?.trim() || derivedTitle || `Chapter ${chapterNumber}`;

    if (existing) {
      // ② Conditional write (guarded paths only): lands only if the row is
      // STILL unlocked (or the human's one-time-unlock is in play). 0 rows =
      // a lock won the race.
      const conditional = guarded && !skipChapterLock;
      const updated = conditional
        ? await tx
            .update(manuscriptChapters)
            .set({ content: prose, title, updatedAt: new Date() })
            .where(and(eq(manuscriptChapters.id, existing.id), eq(manuscriptChapters.locked, false)))
            .returning({ id: manuscriptChapters.id })
        : await tx
            .update(manuscriptChapters)
            .set({ content: prose, title, updatedAt: new Date() })
            .where(eq(manuscriptChapters.id, existing.id))
            .returning({ id: manuscriptChapters.id });
      if (updated.length === 0) {
        throw lockedError("chapter", `Chapter ${chapterNumber} was locked while writing — nothing was saved.`);
      }
      return { chapterId: existing.id, chapterNumber, title, created: false, wasLocked: existing.locked };
    }

    const chapterId = randomUUID();
    await tx.insert(manuscriptChapters).values({ id: chapterId, bookId, chapterNumber, title, content: prose });
    return { chapterId, chapterNumber, title, created: true, wasLocked: false };
  };

  let result: PersistProseResult & { wasLocked: boolean };
  if (opts?.lockGuard === false) {
    result = await writeTx(db, false);
  } else {
    try {
      result = await db.transaction(async (tx) => {
        // Serializable: a concurrent passage-lock INSERT aborts us rather
        // than letting a locked span be clobbered mid-flight.
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);
        return writeTx(tx as unknown as Db, true);
      });
    } catch (err) {
      const e = err as { code?: string; status?: number };
      if (e?.code === "40001") {
        throw lockedError("chapter", `Chapter ${chapterNumber}'s locks changed while writing — the write was refused. Re-run if the lock is gone.`);
      }
      throw err;
    }
  }

  writeChapterToVault(bookSlug, chapterNumber, result.title, prose, result.wasLocked);

  return { chapterId: result.chapterId, chapterNumber, title: result.title, created: result.created };
}
