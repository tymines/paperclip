// Book Studio — LOCK fail-closed sink guard (Spec v1 §7, atomic review pass).
// persistChapterProse is the shared write sink: it must refuse, atomically and
// at write time, ① DB-locked chapters ② vault human_locked frontmatter
// ③ any write that would clobber a locked passage — and write-through must
// never flip human_locked back to false. Portable: real temp vault via
// BOOK_STUDIO_VAULT_ROOT, no hardcoded paths, no fs mocks.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execSync: vi.fn() };
});

import { books, manuscriptChapters, passageLocks } from "@paperclipai/db";
import { persistChapterProse, writeChapterToVault } from "../services/book-prose-writer.js";
import { backfillChapterLocksFromVault } from "../services/book-locks.js";

const PROSE = "The quick brown fox jumps over the lazy dog. More prose follows here.";
const LOCKED_FM = (n: number) => `---\nnumber: ${n}\ntitle: "One"\nhuman_locked: true\nupdated: x\n---\n\n`;

let vaultRoot: string;

function vaultChapter(slug: string, chapterNumber: number, content: string) {
  const dir = path.join(vaultRoot, slug, "chapters");
  fs.mkdirSync(dir, { recursive: true });
  const pad = String(chapterNumber).padStart(2, "0");
  fs.writeFileSync(path.join(dir, `ch${pad}.md`), content, "utf8");
}

function readVaultChapter(slug: string, chapterNumber: number): string {
  const pad = String(chapterNumber).padStart(2, "0");
  return fs.readFileSync(path.join(vaultRoot, slug, "chapters", `ch${pad}.md`), "utf8");
}

interface MockState { chapters: any[]; passageLocks: any[] }

function mockDb(opts?: Partial<MockState>) {
  const state: MockState = {
    chapters: opts?.chapters ?? [
      { id: "ch-1", bookId: "book-1", chapterNumber: 1, title: "One", content: PROSE, locked: false },
    ],
    passageLocks: opts?.passageLocks ?? [],
  };
  const pick = (table: unknown): any[] =>
    table === books ? [{ id: "book-1", slug: "test-novel" }]
    : table === manuscriptChapters ? state.chapters
    : table === passageLocks ? state.passageLocks
    : [];
  const db: any = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const p: any = Promise.resolve(pick(table));
          p.limit = () => Promise.resolve(pick(table).slice(0, 1));
          p.orderBy = () => Promise.resolve(pick(table));
          return p;
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: any) => {
        const row = { id: `row-1`, createdAt: new Date(), ...v };
        if (table === manuscriptChapters) state.chapters.push(row);
        const p: any = Promise.resolve([row]);
        p.returning = () => Promise.resolve([row]);
        return p;
      },
    }),
    update: (table: unknown) => ({
      set: (v: any) => ({
        where: () => {
          if (table === manuscriptChapters) {
            state.chapters = state.chapters.map((c) => ({ ...c, ...v }));
            const p: any = Promise.resolve(state.chapters);
            p.returning = () => Promise.resolve(state.chapters.length ? [{ id: state.chapters[0].id }] : []);
            return p;
          }
          const p: any = Promise.resolve([]);
          p.returning = () => Promise.resolve([]);
          return p;
        },
      }),
    }),
    execute: async () => ({}),
    transaction: async (fn: (tx: any) => Promise<any>) => fn(db),
    __state: state,
  };
  return db;
}

beforeEach(async () => {
  vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "book-vault-"));
  process.env.BOOK_STUDIO_VAULT_ROOT = vaultRoot;
  vi.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(vaultRoot, { recursive: true, force: true });
  delete process.env.BOOK_STUDIO_VAULT_ROOT;
});

// ── Sink guard (atomic: guard + mutation in one serializable tx) ───────

describe("persistChapterProse — the shared sink enforces locks atomically (§7 ①)", () => {
  it("refuses a DB-locked chapter with 409 LOCKED, writing nothing", async () => {
    const db = mockDb({ chapters: [{ id: "ch-1", bookId: "book-1", chapterNumber: 1, title: "One", content: PROSE, locked: true }] });
    await expect(
      persistChapterProse(db, { bookId: "book-1", bookSlug: "test-novel", chapterNumber: 1, prose: "New AI prose." }),
    ).rejects.toMatchObject({ status: 409, details: { code: "LOCKED", scope: "chapter" } });
    expect(db.__state.chapters[0].content).toBe(PROSE);
  });

  it("refuses a vault human_locked chapter even when the DB flag is false (fail-closed)", async () => {
    vaultChapter("test-novel", 1, LOCKED_FM(1) + PROSE);
    const db = mockDb();
    await expect(
      persistChapterProse(db, { bookId: "book-1", bookSlug: "test-novel", chapterNumber: 1, prose: "AI overwrite attempt." }),
    ).rejects.toMatchObject({ status: 409, details: { code: "LOCKED", scope: "chapter" } });
    expect(db.__state.chapters[0].content).toBe(PROSE);
  });

  it("refuses a full replacement that drops a locked passage's exact text", async () => {
    const db = mockDb({
      passageLocks: [{ id: "pl-1", bookId: "book-1", chapterNumber: 1, spanStart: 0, spanEnd: 19, contentHash: "", note: "keep" }],
    });
    await expect(
      persistChapterProse(db, { bookId: "book-1", bookSlug: "test-novel", chapterNumber: 1, prose: "Completely different chapter text." }),
    ).rejects.toMatchObject({ status: 409, details: { code: "LOCKED", scope: "passage" } });
  });

  it("allows a write that preserves every locked passage verbatim", async () => {
    const lockedSpan = PROSE.slice(0, 19); // "The quick brown fox"
    const db = mockDb({
      passageLocks: [{ id: "pl-1", bookId: "book-1", chapterNumber: 1, spanStart: 0, spanEnd: 19, contentHash: "", note: "" }],
    });
    const newProse = `${lockedSpan} leaps onward. Entirely new continuation.`;
    const res = await persistChapterProse(db, { bookId: "book-1", bookSlug: "test-novel", chapterNumber: 1, prose: newProse });
    expect(res.chapterNumber).toBe(1);
    expect(db.__state.chapters[0].content).toBe(newProse);
  });

  it("a serialization-failure (lock changed mid-write) maps to 409 LOCKED", async () => {
    const db = mockDb();
    db.transaction = async () => { throw Object.assign(new Error("could not serialize access"), { code: "40001" }); };
    await expect(
      persistChapterProse(db, { bookId: "book-1", bookSlug: "test-novel", chapterNumber: 1, prose: "x" }),
    ).rejects.toMatchObject({ status: 409, details: { code: "LOCKED" } });
  });

  it("lockGuard: false opts out (trusted human paths that already actor-checked)", async () => {
    const db = mockDb({ chapters: [{ id: "ch-1", bookId: "book-1", chapterNumber: 1, title: "One", content: PROSE, locked: true }] });
    const res = await persistChapterProse(
      db,
      { bookId: "book-1", bookSlug: "test-novel", chapterNumber: 1, prose: "Human-approved write." },
      { lockGuard: false },
    );
    expect(res.title).toBeTruthy();
  });
});

// ── Write-through never downgrades human_locked ────────────────────────

describe("writeChapterToVault — human_locked is never flipped back to false", () => {
  it("preserves an existing human_locked: true on a routine write-through", () => {
    vaultChapter("test-novel", 1, LOCKED_FM(1) + PROSE);
    writeChapterToVault("test-novel", 1, "One", "Fresh prose.", false);
    expect(readVaultChapter("test-novel", 1)).toContain("human_locked: true");
  });

  it("the human unlock route (preserveVaultLock: false) is the ONLY downgrade path", () => {
    vaultChapter("test-novel", 1, LOCKED_FM(1) + PROSE);
    writeChapterToVault("test-novel", 1, "One", PROSE, false, { preserveVaultLock: false });
    expect(readVaultChapter("test-novel", 1)).toContain("human_locked: false");
  });
});

// ── 0158 fail-closed backfill ──────────────────────────────────────────

describe("backfillChapterLocksFromVault — 0158 imports pre-existing human_locked", () => {
  it("syncs vault human_locked: true chapters UP into manuscript_chapters.locked", async () => {
    vaultChapter("test-novel", 1, LOCKED_FM(1) + PROSE);
    const db = mockDb();
    await backfillChapterLocksFromVault(db, "book-1", "test-novel");
    expect(db.__state.chapters[0].locked).toBe(true);
  });

  it("never clears a DB lock from a vault human_locked: false (upward only)", async () => {
    vaultChapter("test-novel", 1, "---\nnumber: 1\ntitle: \"One\"\nhuman_locked: false\nupdated: x\n---\n\n" + PROSE);
    const db = mockDb({ chapters: [{ id: "ch-1", bookId: "book-1", chapterNumber: 1, title: "One", content: PROSE, locked: true }] });
    await backfillChapterLocksFromVault(db, "book-1", "test-novel");
    expect(db.__state.chapters[0].locked).toBe(true);
  });
});
