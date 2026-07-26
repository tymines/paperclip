// Book Studio — LOCK fail-closed sink guard (Spec v1 §7, review follow-up).
// persistChapterProse is the shared write sink: it must refuse, atomically and
// at write time, ① DB-locked chapters ② vault human_locked frontmatter
// ③ any write that would clobber a locked passage — and write-through must
// never flip human_locked back to false. The 0158 backfill imports vault
// human_locked upward into the DB.
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Virtual vault filesystem ──────────────────────────────────────────
// vaultFiles: path → content. Everything else behaves as "not found".
const vaultFiles = new Map<string, string>();
const CH1 = "F:\\Augi Vault\\09 - Book Studio\\Books\\test-novel\\chapters\\ch01.md";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const readFileSync = (p: unknown, enc?: unknown) => {
    const key = String(p);
    if (vaultFiles.has(key)) return vaultFiles.get(key)!;
    return actual.readFileSync(p as never, enc as never);
  };
  return {
    ...actual,
    default: {
      ...actual,
      readFileSync,
      readdirSync: (p: unknown) => {
        const prefix = String(p);
        const names = [...vaultFiles.keys()]
          .filter((k) => k.startsWith(prefix))
          .map((k) => k.slice(prefix.length).replace(/^\\|^\//, "").split(/[\\/]/)[0]);
        if (names.length === 0) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        return [...new Set(names)];
      },
      writeFileSync: vi.fn((p: unknown, data: unknown) => { vaultFiles.set(String(p), String(data)); }),
      mkdirSync: vi.fn(),
    },
    readFileSync,
    readdirSync: (p: unknown) => {
      const prefix = String(p);
      const names = [...vaultFiles.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length).replace(/^\\|^\//, "").split(/[\\/]/)[0]);
      if (names.length === 0) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return [...new Set(names)];
    },
    writeFileSync: vi.fn((p: unknown, data: unknown) => { vaultFiles.set(String(p), String(data)); }),
    mkdirSync: vi.fn(),
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execSync: vi.fn() };
});

import { books, manuscriptChapters, passageLocks } from "@paperclipai/db";
import { persistChapterProse, writeChapterToVault } from "../services/book-prose-writer.js";
import { backfillChapterLocksFromVault } from "../services/book-locks.js";

const PROSE = "The quick brown fox jumps over the lazy dog. More prose follows here.";
const LOCKED_FM = "---\nnumber: 1\ntitle: \"One\"\nhuman_locked: true\nupdated: x\n---\n\n";

interface MockState { chapters: any[]; passageLocks: any[] }

function mockDb(opts?: Partial<MockState>) {
  const state: MockState = {
    chapters: opts?.chapters ?? [
      { id: "ch-1", bookId: "book-1", chapterNumber: 1, title: "One", content: PROSE, locked: false },
    ],
    passageLocks: opts?.passageLocks ?? [],
  };
  const pick = (table: unknown) =>
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
          }
          return Promise.resolve([]);
        },
      }),
    }),
    __state: state,
  };
  return db;
}

beforeEach(() => {
  vaultFiles.clear();
  vi.clearAllMocks();
});

// ── Sink guard ─────────────────────────────────────────────────────────

describe("persistChapterProse — the shared sink enforces locks (Spec v1 §7 ①)", () => {
  it("refuses a DB-locked chapter with 409 LOCKED, writing nothing", async () => {
    const db = mockDb({ chapters: [{ id: "ch-1", bookId: "book-1", chapterNumber: 1, title: "One", content: PROSE, locked: true }] });
    await expect(
      persistChapterProse(db, { bookId: "book-1", bookSlug: "test-novel", chapterNumber: 1, prose: "New AI prose." }),
    ).rejects.toMatchObject({ status: 409, details: { code: "LOCKED", scope: "chapter" } });
    expect(db.__state.chapters[0].content).toBe(PROSE);
  });

  it("refuses a vault human_locked chapter even when the DB flag is false (fail-closed)", async () => {
    vaultFiles.set(CH1, LOCKED_FM + PROSE);
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
    vaultFiles.set(CH1, LOCKED_FM + PROSE);
    writeChapterToVault("test-novel", 1, "One", "Fresh prose.", false);
    expect(vaultFiles.get(CH1)).toContain("human_locked: true");
  });

  it("the human unlock route (preserveVaultLock: false) is the ONLY downgrade path", () => {
    vaultFiles.set(CH1, LOCKED_FM + PROSE);
    writeChapterToVault("test-novel", 1, "One", PROSE, false, { preserveVaultLock: false });
    expect(vaultFiles.get(CH1)).toContain("human_locked: false");
  });
});

// ── 0158 fail-closed backfill ──────────────────────────────────────────

describe("backfillChapterLocksFromVault — 0158 imports pre-existing human_locked", () => {
  it("syncs vault human_locked: true chapters UP into manuscript_chapters.locked", async () => {
    vaultFiles.set(CH1, LOCKED_FM + PROSE);
    const db = mockDb();
    const imported = await backfillChapterLocksFromVault(db, "book-1", "test-novel");
    expect(imported).toBeGreaterThanOrEqual(0); // mock update reports no rowCount
    expect(db.__state.chapters[0].locked).toBe(true);
  });

  it("never clears a DB lock from a vault human_locked: false (upward only)", async () => {
    vaultFiles.set(CH1, "---\nnumber: 1\ntitle: \"One\"\nhuman_locked: false\nupdated: x\n---\n\n" + PROSE);
    const db = mockDb({ chapters: [{ id: "ch-1", bookId: "book-1", chapterNumber: 1, title: "One", content: PROSE, locked: true }] });
    await backfillChapterLocksFromVault(db, "book-1", "test-novel");
    expect(db.__state.chapters[0].locked).toBe(true);
  });
});
