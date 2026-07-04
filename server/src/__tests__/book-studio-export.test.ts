import { describe, expect, it, vi, beforeAll, beforeEach, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import type { Router } from "express";

// ── Mocks ─────────────────────────────────────────────────────────────

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: vi.fn(),
  };
});
vi.mock("../services/provider-api-keys/index.js", () => ({ getRawKey: vi.fn() }));

// Global fetch mock — stubbed at vitest level so dynamically imported modules see it
vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  arrayBuffer: () => Promise.resolve(Buffer.alloc(4096).buffer),
  text: () => Promise.resolve(""),
}));

import { execSync } from "node:child_process";
import { getRawKey } from "../services/provider-api-keys/index.js";

/** Thenable chain for Drizzle queries. */
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
    "onConflictDoUpdate",
  ]) {
    chain[method] = () => chain;
  }
  return chain;
}

/** Mock DB that returns different results on successive .where() calls. */
function mockDb(bookOverride?: any, chaptersOverride?: any, insertOverride?: any) {
  let callCount = 0;
  const bookVal = bookOverride ?? [{ id: "book-1", title: "The Echo of Stone", slug: "echo-of-stone" }];
  const chaptersVal = chaptersOverride ?? [
    { chapterNumber: 1, title: "The Wrong Book", beats: [{ description: "Elena discovers the hidden mechanism." }] },
    { chapterNumber: 2, title: "Into the Depths", beats: [{ description: "Elena descends into the underground reservoir." }] },
  ];
  const insertVal = insertOverride ?? [{
    id: "export-1", bookId: "book-1", companyId: "c1", type: "export", format: "pdf",
    status: "completed", outputPath: "/tmp/test.pdf", metadata: { chapterCount: 2, pandocUsed: true },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }];
  return {
    select: () => ({
      from: () => ({
        where: () => {
          callCount++;
          if (callCount === 1) return q(bookVal);
          if (callCount === 2) return q(chaptersVal);
          return q([]);
        },
        then: (fn: any) => Promise.resolve([]).then(fn),
      }),
      then: (fn: any) => Promise.resolve([]).then(fn),
    }),
    insert: () => ({ values: () => ({ returning: () => q(insertVal), onConflictDoUpdate: () => q(insertVal) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => q(insertVal) }) }) }),
  };
}

// ── Test app builder ─────────────────────────────────────────────────

async function createTestApp(mockDbInstance?: any) {
  const mod = await import("../routes/book-studio-export.js");
  const router: Router = mod.bookStudioExportRoutes(mockDbInstance ?? mockDb());
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.actor = { type: "board", source: "local_implicit" };
    next();
  });
  app.use(router);
  // Error handler to catch and log errors from the route
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return { app };
}

// ── Tests ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST .../export", () => {
  it("returns 201 with the export record (pandoc success)", async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from(""));
    const { app } = await createTestApp();

    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-1/export")
      .send({ format: "pdf" });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("export");
    expect(res.body.export.format).toBe("pdf");
    expect(res.body.export.status).toBe("completed");
    expect(res.body.export.type).toBe("export");
  });

  it("returns 400 for invalid format", async () => {
    const { app } = await createTestApp();

    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-1/export")
      .send({ format: "docx" });

    expect(res.status).toBe(400);
  });

  it("returns 404 when book not found", async () => {
    const emptyDb = mockDb([]);
    const { app } = await createTestApp(emptyDb);

    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-nonexistent/export")
      .send({ format: "pdf" });

    expect(res.status).toBe(404);
  });

  it("falls back to .md file when pandoc fails", async () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error("pandoc failed"); });
    const customInsertVal = [{
      id: "export-2", bookId: "book-1", companyId: "c1", type: "export", format: "epub",
      status: "completed", outputPath: "/tmp/test.epub", metadata: { chapterCount: 2, pandocUsed: false },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }];
    const { app } = await createTestApp(mockDb(undefined, undefined, customInsertVal));

    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-1/export")
      .send({ format: "epub" });

    expect(res.status).toBe(201);
    expect(res.body.export.format).toBe("epub");
    expect(res.body.export.metadata.pandocUsed).toBe(false);
  });
});

describe("POST .../narrate", () => {
  it("returns 200 with cost estimate when no confirm sent", async () => {
    vi.mocked(getRawKey).mockResolvedValue("sk-ele...test");
    process.env.TTS_PROVIDER = "elevenlabs";
    const { app } = await createTestApp();

    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-1/narrate")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("estimate");
    expect(res.body.requiresConfirm).toBe(true);
    expect(res.body).toHaveProperty("estimate.chapters");
    expect(res.body).toHaveProperty("estimate.totalChars");
    expect(res.body).toHaveProperty("estimate.estimatedCostUsd");
    expect(res.body).toHaveProperty("estimate.estimatedDurationSec");
    expect(res.body.narration).toBeNull();
  });

  it("returns 201 with narration record when confirm=true", async () => {
    vi.mocked(getRawKey).mockResolvedValue("sk-ele...test");
    process.env.TTS_PROVIDER = "elevenlabs";
    // Mock execSync: first calls are for ffmpeg concat, last is ffprobe duration
    const mockExecSync = vi.mocked(execSync);
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("ffprobe")) return Buffer.from("123.45");
      return Buffer.from("");
    });
    const narrationInsertVal = [{
      id: "narration-1", bookId: "book-1", companyId: "c1", type: "narration", format: "mp3",
      status: "completed", outputPath: "/mock/path/combined.mp3", metadata: { chapterCount: 2, totalChars: 100, estimatedCostUsd: 0.003, totalDurationSec: 124, individualChapters: [{ number: 1, title: "Chapter 1" }, { number: 2, title: "Chapter 2" }] },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }];
    const { app } = await createTestApp(mockDb(undefined, undefined, narrationInsertVal));

    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-1/narrate")
      .send({ confirm: true });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("narration");
    expect(res.body.narration.type).toBe("narration");
    expect(res.body.narration.format).toBe("mp3");
  });

  it("returns 503 when TTS is not configured", async () => {
    vi.mocked(getRawKey).mockResolvedValue(null);
    process.env.TTS_PROVIDER = "";
    const { app } = await createTestApp();

    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-1/narrate")
      .send({ confirm: true });

    expect(res.status).toBe(503);
  });
});

describe("ElevenLabs TTS Provider", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it("isConfigured returns true when key is present", async () => {
    vi.mocked(getRawKey).mockResolvedValue("sk-ele...test");
    const mod = await vi.importActual<typeof import("../services/tts/elevenlabs.js")>("../services/tts/elevenlabs.js");
    const result = await mod.elevenlabsProvider.isConfigured();
    expect(result).toBe(true);
  });

  it("isConfigured returns false when no key", async () => {
    vi.mocked(getRawKey).mockResolvedValue(null);
    const mod = await vi.importActual<typeof import("../services/tts/elevenlabs.js")>("../services/tts/elevenlabs.js");
    const result = await mod.elevenlabsProvider.isConfigured();
    expect(result).toBe(false);
  });

  it("getTTSProvider returns elevenlabs when TTS_PROVIDER is set", async () => {
    process.env.TTS_PROVIDER = "elevenlabs";
    vi.mocked(getRawKey).mockResolvedValue("sk-ele...test");
    const mod = await vi.importActual<typeof import("../services/tts/index.js")>("../services/tts/index.js");
    const provider = mod.getTTSProvider();
    expect(provider.id).toBe("elevenlabs");
  });

  it("getTTSProvider returns stub when TTS_PROVIDER not set", async () => {
    delete process.env.TTS_PROVIDER;
    const mod = await vi.importActual<typeof import("../services/tts/index.js")>("../services/tts/index.js");
    const provider = mod.getTTSProvider();
    expect(provider.id).toBe("stub");
  });
});

describe("GET .../exports", () => {
  it("returns 200 with empty list when no exports exist", async () => {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.actor = { type: "board", source: "local_implicit" };
      next();
    });
    const mod = await import("../routes/book-studio-export.js");
    const simpleDb = {
      select: () => ({
        from: () => ({
          where: () => q([]),
          then: (fn: any) => Promise.resolve([]).then(fn),
        }),
        then: (fn: any) => Promise.resolve([]).then(fn),
      }),
      insert: () => ({ values: () => ({ returning: () => q([]), onConflictDoUpdate: () => q([]) }) }),
      update: () => ({ set: () => ({ where: () => ({ returning: () => q([]) }) }) }),
    };
    const router = mod.bookStudioExportRoutes(simpleDb as any);
    app.use(router);
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.status || 500).json({ error: err.message });
    });

    const res = await request(app)
      .get("/companies/c1/book-studio/books/book-1/exports");

    expect(res.status).toBe(200);
    expect(res.body.exports).toEqual([]);
  });

  it("returns 200 with export records", async () => {
    const records = [
      {
        id: "exp-1", bookId: "book-1", companyId: "c1", type: "export", format: "pdf",
        status: "completed", outputPath: "/tmp/test.pdf", metadata: { chapterCount: 2, pandocUsed: true },
        createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z",
      },
    ];
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.actor = { type: "board", source: "local_implicit" };
      next();
    });
    const mod = await import("../routes/book-studio-export.js");
    const simpleDb = {
      select: () => ({
        from: () => ({
          where: () => q(records),
          then: (fn: any) => Promise.resolve([]).then(fn),
        }),
        then: (fn: any) => Promise.resolve([]).then(fn),
      }),
      insert: () => ({ values: () => ({ returning: () => q([]), onConflictDoUpdate: () => q([]) }) }),
      update: () => ({ set: () => ({ where: () => ({ returning: () => q([]) }) }) }),
    };
    const router = mod.bookStudioExportRoutes(simpleDb as any);
    app.use(router);
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.status || 500).json({ error: err.message });
    });

    const res = await request(app)
      .get("/companies/c1/book-studio/books/book-1/exports");

    expect(res.status).toBe(200);
    expect(res.body.exports).toHaveLength(1);
    expect(res.body.exports[0].id).toBe("exp-1");
  });
});

describe("Company access enforcement", () => {
  it("returns 401 when no actor is set", async () => {
    const mod = await import("../routes/book-studio-export.js");
    const simpleDb = {
      select: () => ({
        from: () => ({
          where: () => q([]),
          then: (fn: any) => Promise.resolve([]).then(fn),
        }),
        then: (fn: any) => Promise.resolve([]).then(fn),
      }),
      insert: () => ({ values: () => ({ returning: () => q([]), onConflictDoUpdate: () => q([]) }) }),
      update: () => ({ set: () => ({ where: () => ({ returning: () => q([]) }) }) }),
    };
    const router = mod.bookStudioExportRoutes(simpleDb as any);
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.actor = { type: "none" as const };
      next();
    });
    app.use(router);
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.status || 500).json({ error: err.message });
    });

    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-1/export")
      .send({ format: "pdf" });

    expect(res.status).toBe(401);
  });
});
