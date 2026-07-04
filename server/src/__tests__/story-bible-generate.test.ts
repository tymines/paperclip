import { describe, expect, it, vi, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import type { Router } from "express";

// ── Mock Gemini ────────────────────────────────────────────────────────────

const mockFetch = vi.spyOn(globalThis, "fetch");

beforeAll(() => {
  process.env.GOOGLE_API_KEY = "test-key";
});

function mockGeminiResponse(json: Record<string, unknown>) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify(json) }],
          },
        },
      ],
    }),
  } as Response);
}

// ── Mock DB ────────────────────────────────────────────────────────────────

/**
 * A thenable chain for Drizzle queries.
 * `val` is what the query resolves to.
 */
function q<T>(val: T): any {
  const p = Promise.resolve(val);
  const chain: Record<string, any> = Object.assign(
    (resolve: any, _reject?: any) => p.then(resolve),
    {
      then: p.then.bind(p),
      catch: p.catch.bind(p),
      finally: p.finally.bind(p),
    },
  );
  for (const method of [
    "select", "from", "where", "orderBy", "limit",
    "values", "set", "returning", "insert", "update", "delete",
  ]) {
    chain[method] = () => chain;
  }
  return chain;
}

/** Create a mock Drizzle DB. The first .select().from().where() chain
 *  returns the book row so the handler's existence check passes.
 */
function mockDb() {
  const bookVal = [{ id: "book-1", title: "The Echo of Stone", slug: "echo-of-stone" }];
  let bookCheckPassed = false;

  const whereCb = () => {
    if (!bookCheckPassed) {
      bookCheckPassed = true;
      return q(bookVal);    // first .where() — the book lookup
    }
    return q([]);            // subsequent .where() — context queries
  };

  return {
    select: () => ({
      from: () => ({
        where: whereCb,
        then: (fn: any) => Promise.resolve([]).then(fn),
      }),
      then: (fn: any) => Promise.resolve([]).then(fn),
    }),
  };
}

// ── Build test app ─────────────────────────────────────────────────────────

async function createTestApp() {
  const mod = await import("../routes/story-bible-generate.js");
  const router: Router = mod.storyBibleGenerateRoutes(mockDb());
  const app = express();
  app.use(express.json());

  // Inject board-level actor so assertCompanyAccess passes
  app.use((req: any, _res: any, next: any) => {
    req.actor = { type: "board", source: "local_implicit" };
    next();
  });

  app.use(router);
  return { app };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /generate/character", () => {
  it("returns a draft character entry", async () => {
    const { app } = await createTestApp();
    mockGeminiResponse({
      name: "Elena Voss",
      role: "protagonist",
      description: "A sharp-witted archaeologist who distrusts easy answers.",
      voiceCard: {
        tone: "dry and intellectual",
        speechPattern: "speaks in measured paragraphs",
      },
    });

    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-1/generate/character")
      .send({ prompt: "Create a protagonist" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "draft",
      entityType: "character",
    });
    expect(res.body.draft.name).toBe("Elena Voss");
    expect(res.body.draft.role).toBe("protagonist");
  });
});

describe("POST /generate/location", () => {
  it("returns a draft location entry", async () => {
    const { app } = await createTestApp();
    mockGeminiResponse({
      name: "Sunken Athenaeum",
      description: "A ruined library half-submerged in a flooded caldera.",
      rules: { magic: "suppressed", access: "requires_breathing_apparatus" },
      sensoryNotes: { sight: "faded mosaics", sound: "dripping water echoes" },
    });

    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-1/generate/location")
      .send({ prompt: "A mysterious library" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "draft",
      entityType: "location",
    });
    expect(res.body.draft.name).toBe("Sunken Athenaeum");
    expect(res.body.draft.rules).toBeDefined();
  });
});

describe("POST /generate/world-rule", () => {
  it("returns a draft world-rule entry", async () => {
    const { app } = await createTestApp();
    mockGeminiResponse({
      name: "The Veil of Silence",
      description: "A cosmological barrier preventing divine communication.",
      rules: { prayer: "arrives garbled", divine_intervention: "only through natural phenomena" },
    });

    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-1/generate/world-rule")
      .send({ prompt: "A cosmology constraint" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "draft",
      entityType: "world-rule",
    });
    expect(res.body.draft.name).toBe("The Veil of Silence");
  });
});

describe("POST /generate/style", () => {
  it("returns a draft style entry", async () => {
    const { app } = await createTestApp();
    mockGeminiResponse({
      pov: "third person limited",
      tense: "past",
      comps: "Shades of Magic meets Library at Mount Char",
      sampleParagraph:
        "The book did not want to open. Elena felt its reluctance through her gloves.",
      bannedCliches: ["it was all a dream", "the real treasure was the friends"],
    });

    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-1/generate/style")
      .send({ prompt: "Gothic adventure style" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "draft",
      entityType: "style",
    });
    expect(res.body.draft.pov).toBe("third person limited");
    expect(res.body.draft.bannedCliches).toBeInstanceOf(Array);
  });
});

describe("POST /generate/outline-beats", () => {
  it("returns a draft outline entry", async () => {
    const { app } = await createTestApp();
    mockGeminiResponse({
      chapterNumber: 1,
      title: "The Wrong Book",
      beats: [
        { beat: "inciting discovery", description: "Elena triggers a hidden mechanism." },
        { beat: "escalation", description: "She falls into an underground reservoir." },
      ],
    });

    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-1/generate/outline-beats")
      .send({ prompt: "Opening chapter outline" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "draft",
      entityType: "outline-beats",
    });
    expect(res.body.draft.chapterNumber).toBe(1);
    expect(res.body.draft.beats).toBeInstanceOf(Array);
    expect(res.body.draft.beats.length).toBeGreaterThanOrEqual(2);
  });
});

describe("API key missing", () => {
  it("returns 503 when GOOGLE_API_KEY is unset", async () => {
    delete process.env.GOOGLE_API_KEY;
    const { app } = await createTestApp();

    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-1/generate/character")
      .send({});

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/Gemini API key not configured/i);
  });
});
