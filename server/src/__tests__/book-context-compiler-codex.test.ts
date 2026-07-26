// Context compiler × codex (Spec v1 §4.1④) — spoiler gating in the packet:
// only facts with known_as_of ≤ N reach the writer; withheld facts never
// appear in the prompt, but their audit metadata is returned for the
// Context view ("what the writer saw").
import { describe, expect, it, vi } from "vitest";

const FACTS = [
  { id: "f-1", bookId: "book-1", statement: "Kaelen is incapable of subterfuge", entityRefs: [], knownAsOf: 2, sourceChapter: 2, sourceScene: "", provenance: "authored", locked: false, createdAt: new Date(), updatedAt: new Date() },
  { id: "f-2", bookId: "book-1", statement: "Kaelen is the hidden heir", entityRefs: [], knownAsOf: 8, sourceChapter: null, sourceScene: "", provenance: "auto-extracted", locked: false, createdAt: new Date(), updatedAt: new Date() },
];

// Split in-memory exactly like the real SQL gating (mock DB can't do lte/gt).
vi.mock("../services/book-bible-codex.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/book-bible-codex.js")>();
  return {
    ...actual,
    factsForChapter: async (_db: unknown, _bookId: string, chapterNumber: number) => ({
      known: FACTS.filter((f) => f.knownAsOf <= chapterNumber),
      withheld: FACTS.filter((f) => f.knownAsOf > chapterNumber),
    }),
  };
});

import {
  books, storyBibleStyle, storyBibleCharacters, storyBibleWorldLocations, storyBibleOutline, manuscriptChapters,
} from "@paperclipai/db";
import { compileChapterContext } from "../services/book-context-compiler.js";

function mockDb() {
  const pick = (table: unknown): any[] =>
    table === books ? [{ id: "book-1", title: "The Test Novel", slug: "test-novel", metadata: {} }]
    : table === storyBibleStyle ? []
    : table === storyBibleCharacters ? []
    : table === storyBibleWorldLocations ? []
    : table === storyBibleOutline ? []
    : table === manuscriptChapters ? []
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
  };
  return db;
}

describe("compileChapterContext — spoiler-gated canon facts (§4.1④)", () => {
  it("chapter 5: only facts known by ch.5 enter the packet; the ch.8 reveal is withheld", async () => {
    const ctx = await compileChapterContext(mockDb(), "book-1", 5);
    expect(ctx.userPrompt).toContain("CANON FACTS");
    expect(ctx.userPrompt).toContain("incapable of subterfuge");
    expect(ctx.userPrompt).not.toContain("hidden heir");
    expect(ctx.usedFacts).toEqual(["Kaelen is incapable of subterfuge"]);
    expect(ctx.withheldFacts).toEqual([{ id: "f-2", knownAsOf: 8 }]);
  });

  it("chapter 9: the reveal has happened — both facts are in the packet", async () => {
    const ctx = await compileChapterContext(mockDb(), "book-1", 9);
    expect(ctx.userPrompt).toContain("hidden heir");
    expect(ctx.withheldFacts).toEqual([]);
  });
});
