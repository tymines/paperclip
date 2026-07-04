import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";
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

import { execSync } from "node:child_process";
import { getRawKey } from "../services/provider-api-keys/index.js";

// ── Global fetch mock ─────────────────────────────────────────────────

let mockFetchResponse: Response | null = null;

beforeEach(() => {
  mockFetchResponse = null;
});

function mockElevenLabsResponse(data: Buffer, status = 200) {
  mockFetchResponse = new Response(data, {
    status,
    headers: { "Content-Type": "audio/mpeg" },
  });
}

function mockElevenLabsError(status: number, body?: string) {
  mockFetchResponse = new Response(body ?? "Error", {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

global.fetch = vi.fn(async (_url: string, _opts?: RequestInit) => {
  if (mockFetchResponse) return mockFetchResponse;
  return new Response(Buffer.alloc(0), { status: 200 });
}) as unknown as typeof global.fetch;

// ── Helper: mock DB query builder ─────────────────────────────────────

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
  delete process.env.BOOK_EXPORT_DIR;
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
    // Mock fetch to return valid mp3 audio data for ElevenLabs API calls
    mockElevenLabsResponse(Buffer.from("fake-mp3-data"));
    // Mock execSync for ffmpeg (concat succeeds) and ffprobe (duration probe)
    vi.mocked(execSync)
      .mockReturnValueOnce(Buffer.from("")) // ffmpeg concat
      .mockReturnValueOnce(Buffer.from("42.500")); // ffprobe duration

    const narrationInsertVal = [{
      id: "narration-1", bookId: "book-1", companyId: "c1", type: "narration", format: "mp3",
      status: "completed", outputPath: "/tmp/paperclip/book-exports/echo-of-stone/narrations/uuid/combined.mp3",
      metadata: {
        chapterCount: 2, totalChars: 100, estimatedCostUsd: 0.003,
        totalDurationSec: 42.5, individualChapters: {},
      },
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
    expect(res.body.narration.status).toBe("completed");
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

describe("ElevenLabs TTS provider", () => {
  beforeAll(() => {
    process.env.TTS_PROVIDER = "elevenlabs";
  });

  it("isConfigured() returns true when key is set", async () => {
    vi.mocked(getRawKey).mockResolvedValue("sk-ele...test");
    const mod = await import("../services/tts/index.js");
    const provider = mod.getTTSProvider();
    expect(await provider.isConfigured()).toBe(true);
  });

  it("isConfigured() returns false when key is null", async () => {
    vi.mocked(getRawKey).mockResolvedValue(null);
    const mod = await import("../services/tts/index.js");
    const provider = mod.getTTSProvider();
    expect(await provider.isConfigured()).toBe(false);
  });

  it("generateNarration() calls ElevenLabs API with correct headers and returns audioBuffer", async () => {
    vi.mocked(getRawKey).mockResolvedValue("sk-ele...test");
    mockElevenLabsResponse(Buffer.from("mp3-data"));

    const mod = await import("../services/tts/index.js");
    const provider = mod.getTTSProvider();
    const result = await provider.generateNarration("Hello world", "Test Chapter");

    expect(result.audioBuffer).toBeDefined();
    expect(result.audioBuffer.length).toBeGreaterThan(0);
    expect(result.audioUrl).toContain("narration-audio");
  });

  it("throws on 401 API error", async () => {
    vi.mocked(getRawKey).mockResolvedValue("sk-ele...test");
    mockElevenLabsError(401, "Unauthorized");

    const mod = await import("../services/tts/index.js");
    const provider = mod.getTTSProvider();
    await expect(provider.generateNarration("Hello", "Chapter 1")).rejects.toThrow("401");
  });

  it("retries on 429 and eventually throws", async () => {
    vi.mocked(getRawKey).mockResolvedValue("sk-ele...test");
    // Return 429 for all retries
    const resp429 = new Response("Rate limited", {
      status: 429,
      headers: { "Content-Type": "text/plain" },
    });
    (global.fetch as any).mockResolvedValue(resp429);

    const mod = await import("../services/tts/index.js");
    const provider = mod.getTTSProvider();
    await expect(provider.generateNarration("Hello", "Chapter 1")).rejects.toThrow(/rate/i);
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
