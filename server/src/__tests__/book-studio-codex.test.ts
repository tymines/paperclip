// Story Bible codex (Spec v1 §4.1) — entity CRUD, typed relationships,
// atomic spoiler-gated facts, §7 lock enforcement, 0160-gated honesty.
import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import type { Router } from "express";

vi.mock("../services/index.js", () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));

// Mock the SQL-level gating (mock DB can't evaluate lte/gt) — split in-memory
// exactly like the real query does, over a per-test fact list.
const gatingFacts: any[] = [];
vi.mock("../services/book-bible-codex.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/book-bible-codex.js")>();
  return {
    ...actual,
    factsForChapter: async (_db: unknown, _bookId: string, chapterNumber: number) => ({
      known: gatingFacts.filter((f) => f.knownAsOf <= chapterNumber),
      withheld: gatingFacts.filter((f) => f.knownAsOf > chapterNumber),
    }),
  };
});

import {
  bibleLore, bibleThreads, bibleGlossary, bibleRelationships, bibleFacts, storyBibleCharacters, books,
} from "@paperclipai/db";

const REL_ERR = () => Object.assign(new Error('relation "bible_facts" does not exist'), { code: "42P01" });

const FACT_CH2 = { id: "f-1", bookId: "book-1", statement: "Kaelen is incapable of subterfuge", entityRefs: [], knownAsOf: 2, sourceChapter: 2, sourceScene: "", provenance: "authored", locked: false, revision: 1, createdAt: new Date(), updatedAt: new Date() };
const FACT_CH8 = { id: "f-2", bookId: "book-1", statement: "Kaelen is the heir", entityRefs: [], knownAsOf: 8, sourceChapter: null, sourceScene: "", provenance: "auto-extracted", locked: true, revision: 1, createdAt: new Date(), updatedAt: new Date() };

interface MockState {
  entities: Record<string, any[]>;
  relationships: any[];
  facts: any[];
  characters: any[];
  books: any[];
  failOnCodex: boolean;
  failUpdates: boolean;
}

function mockDb(opts?: Partial<MockState>) {
  const state: MockState = {
    entities: opts?.entities ?? { lore: [], threads: [], glossary: [] },
    relationships: opts?.relationships ?? [],
    facts: opts?.facts ?? [FACT_CH2, FACT_CH8],
    characters: opts?.characters ?? [],
    books: opts?.books ?? [{ id: "book-1", companyId: "co-1", title: "Book" }],
    failOnCodex: opts?.failOnCodex ?? false,
    failUpdates: opts?.failUpdates ?? false,
  };
  const tableState = (table: unknown): any[] => {
    if (table === bibleLore) return state.entities.lore;
    if (table === bibleThreads) return state.entities.threads;
    if (table === bibleGlossary) return state.entities.glossary;
    if (table === bibleRelationships) return state.relationships;
    if (table === bibleFacts) return state.facts;
    if (table === storyBibleCharacters) return state.characters;
    if (table === books) return state.books;
    return [];
  };
  const maybeFail = (table: unknown) => {
    if (state.failOnCodex && [bibleLore, bibleThreads, bibleGlossary, bibleRelationships, bibleFacts].includes(table as never)) throw REL_ERR();
  };
  const db: any = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          maybeFail(table);
          const rows = tableState(table);
          const p: any = Promise.resolve(rows);
          p.orderBy = () => Promise.resolve(rows);
          p.limit = () => Promise.resolve(rows.slice(0, 1));
          return p;
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: any) => {
        maybeFail(table);
        const row = { createdAt: new Date(), updatedAt: new Date(), locked: false, revision: 1, ...v };
        tableState(table).push(row);
        const p: any = Promise.resolve([row]);
        p.returning = () => Promise.resolve([row]);
        return p;
      },
    }),
    update: (table: unknown) => ({
      set: (v: any) => ({
        where: () => {
          maybeFail(table);
          if (state.failUpdates) {
            const p: any = Promise.resolve([]);
            p.returning = () => Promise.resolve([]);
            return p;
          }
          const rows = tableState(table);
          for (const r of rows) {
            const { revision: _revisionExpression, ...plainChanges } = v;
            Object.assign(r, plainChanges, { revision: (r.revision ?? 1) + 1 });
          }
          const p: any = Promise.resolve(rows);
          p.returning = () => Promise.resolve(rows.slice(0, 1));
          return p;
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: () => {
        maybeFail(table);
        if (table === bibleRelationships) state.relationships.splice(0);
        return Promise.resolve([]);
      },
    }),
    __state: state,
  };
  return db;
}

async function createTestApp(db: any, actor: any = { type: "board", source: "local_implicit" }) {
  const mod = await import("../routes/book-studio-codex.js");
  const router: Router = mod.bookStudioCodexRoutes(db);
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.actor = actor; next(); });
  app.use(router);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status || 500).json({ error: err.message, ...(err.details as object ?? {}) });
  });
  return app;
}

const BASE = "/companies/co-1/book-studio/books/book-1";

beforeEach(() => vi.clearAllMocks());

// ── Entity CRUD ────────────────────────────────────────────────────────

describe("codex entity CRUD", () => {
  it("creates + lists a lore entry", async () => {
    const db = mockDb();
    const app = await createTestApp(db);
    const create = await request(app).post(`${BASE}/codex/lore`).send({ name: "The Sundering", summary: "The world broke." });
    expect(create.status).toBe(201);
    expect(create.body.entity.name).toBe("The Sundering");
    const list = await request(app).get(`${BASE}/codex/lore`);
    expect(list.body.entities).toHaveLength(1);
  });

  it("rejects an unknown entity type", async () => {
    const app = await createTestApp(mockDb());
    const res = await request(app).get(`${BASE}/codex/dragons`);
    expect(res.status).toBe(400);
  });

  it("requires a name", async () => {
    const app = await createTestApp(mockDb());
    const res = await request(app).post(`${BASE}/codex/lore`).send({ summary: "no name" });
    expect(res.status).toBe(400);
  });

  it("threads carry payoff state", async () => {
    const db = mockDb();
    const app = await createTestApp(db);
    const res = await request(app).post(`${BASE}/codex/threads`).send({ name: "The ch.5 promise", payoffState: "open" });
    expect(res.status).toBe(201);
    expect(res.body.entity.payoffState).toBe("open");
  });

  it("returns 404 for a foreign book before reading codex rows", async () => {
    const app = await createTestApp(mockDb({ books: [] }));
    expect((await request(app).get(`${BASE}/codex/lore`)).status).toBe(404);
  });

  it("denies a cross-company agent before reading the book", async () => {
    const app = await createTestApp(mockDb(), { type: "agent", agentId: "agent-1", companyId: "co-2" });
    expect((await request(app).get(`${BASE}/codex/lore`)).status).toBe(403);
  });

  it("returns 409 for a stale edit and rejects provenance/order changes", async () => {
    const row = { id: "l-1", bookId: "book-1", name: "Lore", summary: "", details: {}, locked: false, source: "imported", revision: 1, updatedAt: new Date() };
    const app = await createTestApp(mockDb({ entities: { lore: [row], threads: [], glossary: [] }, failUpdates: true }));
    expect((await request(app).patch(`${BASE}/codex/lore/l-1`).send({ summary: "stale", expectedRevision: row.revision })).status).toBe(409);
    expect((await request(app).patch(`${BASE}/codex/lore/l-1`).send({ source: "authored", expectedRevision: row.revision })).status).toBe(400);
    expect((await request(app).patch(`${BASE}/codex/timeline/l-1`).send({ orderIndex: 99, expectedRevision: row.revision })).status).toBe(400);
  });
});

// ── §7 locks on codex entries ──────────────────────────────────────────

describe("codex lock enforcement (Spec v1 §7)", () => {
  const LOCKED_LORE = { id: "l-1", bookId: "book-1", name: "Locked Lore", summary: "", details: {}, locked: true, source: "authored", revision: 1, createdAt: new Date(), updatedAt: new Date() };

  it("an AI actor cannot edit a locked entry (409 LOCKED)", async () => {
    const db = mockDb({ entities: { lore: [{ ...LOCKED_LORE }], threads: [], glossary: [] } });
    const app = await createTestApp(db, { type: "agent", agentId: "agent-1", companyId: "co-1" });
    const res = await request(app).patch(`${BASE}/codex/lore/l-1`).send({ summary: "AI rewrite", expectedRevision: LOCKED_LORE.revision });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("LOCKED");
  });

  it("an AI actor cannot delete a locked entry (409 LOCKED)", async () => {
    const db = mockDb({ entities: { lore: [{ ...LOCKED_LORE }], threads: [], glossary: [] } });
    const app = await createTestApp(db, { type: "agent", agentId: "agent-1", companyId: "co-1" });
    const res = await request(app).delete(`${BASE}/codex/lore/l-1`);
    expect(res.status).toBe(409);
  });

  it("only the human author toggles locked (AI → 403)", async () => {
    const db = mockDb({ entities: { lore: [{ ...LOCKED_LORE, locked: false }], threads: [], glossary: [] } });
    const app = await createTestApp(db, { type: "agent", agentId: "agent-1", companyId: "co-1" });
    const res = await request(app).patch(`${BASE}/codex/lore/l-1`).send({ locked: true, expectedRevision: LOCKED_LORE.revision });
    expect(res.status).toBe(403);
  });

  it("the human author edits a locked entry freely", async () => {
    const db = mockDb({ entities: { lore: [{ ...LOCKED_LORE }], threads: [], glossary: [] } });
    const app = await createTestApp(db);
    const res = await request(app).patch(`${BASE}/codex/lore/l-1`).send({ summary: "Human edit", expectedRevision: LOCKED_LORE.revision });
    expect(res.status).toBe(200);
  });
});

// ── Relationships (②) ──────────────────────────────────────────────────

describe("codex relationships", () => {
  it("creates a typed, metered relationship with arc rules", async () => {
    const db = mockDb({
      characters: [{ id: "c-1", bookId: "book-1", name: "Kaelen" }],
      entities: { lore: [{ id: "l-9", bookId: "book-1", name: "The Oath" }], threads: [], glossary: [] },
    });
    const app = await createTestApp(db);
    const res = await request(app).post(`${BASE}/codex-relationships`).send({
      fromEntityType: "character", fromEntityId: "c-1",
      toEntityType: "lore", toEntityId: "l-9",
      type: "secret allegiance", arcStage: "strained", meter: -40,
      rules: ["never reveals membership before ch.9"],
      source: "co-created",
    });
    expect(res.status).toBe(201);
    expect(res.body.relationship.meter).toBe(-40);
    expect(res.body.relationship.rules).toHaveLength(1);
    expect(res.body.relationship.source).toBe("co-created");
  });

  it("rejects dangling or cross-book relationship endpoints", async () => {
    const db = mockDb({ characters: [{ id: "c-1", bookId: "book-1", name: "Kaelen" }] });
    const app = await createTestApp(db);
    const res = await request(app).post(`${BASE}/codex-relationships`).send({
      fromEntityType: "character", fromEntityId: "c-1",
      toEntityType: "character", toEntityId: "invented", meter: 0,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("existing entities in this book");
    expect(db.__state.relationships).toHaveLength(0);
  });

  it("rejects a relationship from an entity to itself", async () => {
    const db = mockDb({ characters: [{ id: "c-1", bookId: "book-1", name: "Kaelen" }] });
    const app = await createTestApp(db);
    const res = await request(app).post(`${BASE}/codex-relationships`).send({
      fromEntityType: "character", fromEntityId: "c-1",
      toEntityType: "character", toEntityId: "c-1", meter: 0,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("different entities");
    expect(db.__state.relationships).toHaveLength(0);
  });

  it("rejects a meter outside −100…+100", async () => {
    const app = await createTestApp(mockDb());
    const res = await request(app).post(`${BASE}/codex-relationships`).send({
      fromEntityType: "character", fromEntityId: "c-1",
      toEntityType: "character", toEntityId: "c-2", meter: 150,
    });
    expect(res.status).toBe(400);
  });

  it("rejects non-string type and arcStage plus an unsupported source on create", async () => {
    const app = await createTestApp(mockDb());
    const payload = {
      fromEntityType: "character", fromEntityId: "c-1",
      toEntityType: "character", toEntityId: "c-2", meter: 0,
    };
    expect((await request(app).post(`${BASE}/codex-relationships`).send({ ...payload, type: 7 })).status).toBe(400);
    expect((await request(app).post(`${BASE}/codex-relationships`).send({ ...payload, arcStage: { name: "early" } })).status).toBe(400);
    expect((await request(app).post(`${BASE}/codex-relationships`).send({ ...payload, source: "generated" })).status).toBe(400);
  });

  it("rejects non-string type and arcStage on update without changing the relationship", async () => {
    const relationship = {
      id: "r-1", bookId: "book-1", fromEntityType: "character", fromEntityId: "c-1",
      toEntityType: "character", toEntityId: "c-2", type: "allies", arcStage: "early",
      meter: 20, rules: [], source: "authored", locked: false, revision: 1, updatedAt: new Date(),
    };
    const db = mockDb({ relationships: [relationship] });
    const app = await createTestApp(db);
    const expectedRevision = relationship.revision;
    expect((await request(app).patch(`${BASE}/codex-relationships/r-1`).send({ type: 7, expectedRevision })).status).toBe(400);
    expect((await request(app).patch(`${BASE}/codex-relationships/r-1`).send({ arcStage: ["late"], expectedRevision })).status).toBe(400);
    expect(db.__state.relationships[0]).toMatchObject({ type: "allies", arcStage: "early" });
  });

  it("rejects an edit that would make a relationship self-referential", async () => {
    const relationship = {
      id: "r-1", bookId: "book-1", fromEntityType: "character", fromEntityId: "c-1",
      toEntityType: "character", toEntityId: "c-2", type: "allies", arcStage: "early",
      meter: 20, rules: [], source: "authored", locked: false, revision: 1, updatedAt: new Date(),
    };
    const db = mockDb({
      characters: [
        { id: "c-1", bookId: "book-1", name: "Kaelen" },
        { id: "c-2", bookId: "book-1", name: "Mira" },
      ],
      relationships: [relationship],
    });
    const app = await createTestApp(db);
    const res = await request(app).patch(`${BASE}/codex-relationships/r-1`).send({
      toEntityId: "c-1",
      expectedRevision: relationship.revision,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("different entities");
    expect(db.__state.relationships[0]).toMatchObject({ fromEntityId: "c-1", toEntityId: "c-2" });
  });
});

// ── Facts + spoiler gating (③④) ────────────────────────────────────────

describe("codex facts — atomic + spoiler-gated", () => {
  it("requires statement and knownAsOf (gating is mandatory)", async () => {
    const app = await createTestApp(mockDb());
    expect((await request(app).post(`${BASE}/codex-facts`).send({ knownAsOf: 3 })).status).toBe(400);
    expect((await request(app).post(`${BASE}/codex-facts`).send({ statement: "x" })).status).toBe(400);
  });

  it("GET ?chapter=N splits known vs withheld, and withheld statements stay author-only", async () => {
    gatingFacts.splice(0, gatingFacts.length, FACT_CH2, FACT_CH8);
    const app = await createTestApp(mockDb());
    const res = await request(app).get(`${BASE}/codex-facts?chapter=5`);
    expect(res.status).toBe(200);
    expect(res.body.known.map((f: any) => f.id)).toEqual(["f-1"]);
    expect(res.body.withheld.map((f: any) => f.id)).toEqual(["f-2"]);
    // Withheld = metadata only; the reveal's statement is NOT in the payload.
    expect(JSON.stringify(res.body.withheld)).not.toContain("heir");
  });

  it("denies an agent full-record fact PATCH before any update", async () => {
    const db = mockDb({ facts: [{ ...FACT_CH8 }] });
    const app = await createTestApp(db, { type: "agent", agentId: "agent-1", companyId: "co-1" });
    const res = await request(app).patch(`${BASE}/codex-facts/f-2`).send({ statement: "retcon", expectedRevision: FACT_CH8.revision });
    expect(res.status).toBe(403);
    expect(db.__state.facts[0].statement).toBe(FACT_CH8.statement);
  });

  it("allows a board human to update a full-record fact", async () => {
    const db = mockDb({ facts: [{ ...FACT_CH8 }] });
    const app = await createTestApp(db);
    const res = await request(app).patch(`${BASE}/codex-facts/f-2`).send({ statement: "Kaelen is the hidden heir", expectedRevision: FACT_CH8.revision });
    expect(res.status).toBe(200);
    expect(res.body.fact.statement).toBe("Kaelen is the hidden heir");
    expect(db.__state.facts[0].statement).toBe("Kaelen is the hidden heir");
  });

  it("allows only a board human to read a withheld fact's full record", async () => {
    const board = await createTestApp(mockDb({ facts: [{ ...FACT_CH8 }] }));
    const full = await request(board).get(`${BASE}/codex-facts/f-2`);
    expect(full.status).toBe(200);
    expect(full.body.fact.statement).toContain("heir");
    const agent = await createTestApp(mockDb({ facts: [{ ...FACT_CH8 }] }), { type: "agent", agentId: "agent-1", companyId: "co-1" });
    expect((await request(agent).get(`${BASE}/codex-facts/f-2`)).status).toBe(403);
  });

  it("rejects invalid fact fields and immutable provenance updates", async () => {
    const app = await createTestApp(mockDb({ facts: [{ ...FACT_CH2 }] }));
    const expectedRevision = FACT_CH2.revision;
    expect((await request(app).patch(`${BASE}/codex-facts/f-1`).send({ statement: " ", expectedRevision })).status).toBe(400);
    expect((await request(app).patch(`${BASE}/codex-facts/f-1`).send({ knownAsOf: 0, expectedRevision })).status).toBe(400);
    expect((await request(app).patch(`${BASE}/codex-facts/f-1`).send({ entityRefs: [{ entityType: "dragon", entityId: "x" }], expectedRevision })).status).toBe(400);
    expect((await request(app).patch(`${BASE}/codex-facts/f-1`).send({ provenance: "authored", expectedRevision })).status).toBe(400);
  });
});

// ── 0160-gated honesty ─────────────────────────────────────────────────

describe("pending migration 0160 — honest degradation", () => {
  it("GET returns available:false, never a 500", async () => {
    const app = await createTestApp(mockDb({ failOnCodex: true }));
    const res = await request(app).get(`${BASE}/codex/lore`);
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.pendingMigration).toBe("0160");
  });

  it("POST returns 503 with the pending-migration message", async () => {
    const app = await createTestApp(mockDb({ failOnCodex: true }));
    const res = await request(app).post(`${BASE}/codex/lore`).send({ name: "x" });
    expect(res.status).toBe(503);
    expect(res.body.error).toContain("0160");
  });
});
