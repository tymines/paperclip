import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import type { Router } from "express";

// Mock chapter-generator completely
vi.mock("../services/chapter-generator.js", () => ({
  generateChapterDraft: vi.fn(),
  reviseChapterContent: vi.fn(),
  callLLM: vi.fn(),
}));

// Thenable chain helper for Drizzle queries
function q<T>(val: T): any {
  const p = Promise.resolve(val);
  const then = p.then.bind(p);
  const chain: any = Object.assign(
    (resolve?: any, _reject?: any) => (resolve ? then(resolve) : p),
    {
      then,
      catch: p.catch.bind(p),
      finally: p.finally.bind(p),
    },
  );
  for (const method of [
    "select", "from", "where", "orderBy", "limit", "values", "set",
    "returning", "insert", "update", "delete", "$dynamic",
  ]) {
    chain[method] = () => chain;
  }
  return chain;
}

describe("book-studio-autopilot", () => {
  let app: any;
  let generateChapterDraft: ReturnType<typeof vi.fn>;
  let reviseChapterContent: ReturnType<typeof vi.fn>;
  let callLLM: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetAllMocks();

    generateChapterDraft = vi.mocked(
      (await vi.importMock("../services/chapter-generator.js")).generateChapterDraft,
    );
    reviseChapterContent = vi.mocked(
      (await vi.importMock("../services/chapter-generator.js")).reviseChapterContent,
    );
    callLLM = vi.mocked(
      (await vi.importMock("../services/chapter-generator.js")).callLLM,
    );

    // Default mocks
    generateChapterDraft.mockResolvedValue({
      title: "Chapter 1",
      beats: [{ description: "A narrative beat" }],
    });
    callLLM.mockResolvedValue(
      JSON.stringify({ hasIssues: false, issues: [], praise: "Good pacing", score: 8 }),
    );

    const { initAutopilotOrchestrator } = await import(
      "../services/autopilot-orchestrator.js"
    );
    initAutopilotOrchestrator();

    const { bookStudioAutopilotRoutes } = await import(
      "../routes/book-studio-autopilot.js"
    );

    // Mock DB with thenable chain that supports all Drizzle methods
    const mockDb = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => q([{ id: "book-1", title: "My Book" }])),
          orderBy: vi.fn(() => q([])),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(() => q([{ id: "chapter-1" }])),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => q([{ id: "chapter-1" }])),
          })),
        })),
      })),
    } as any;

    const router: Router = bookStudioAutopilotRoutes(mockDb);
    app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.actor = { type: "board", source: "local_implicit" };
      next();
    });
    app.use(router);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("start creates a running autopilot loop", async () => {
    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-1/autopilot/start")
      .send({ budgetCents: 500 })
      .expect(201);
    expect(res.body.autopilot).toBeDefined();
    expect(res.body.autopilot.status).toBe("running");
    expect(res.body.autopilot.bookId).toBe("book-1");
    expect(res.body.autopilot.abortController).toBeUndefined();
  });

  it("status returns current state", async () => {
    await request(app)
      .post("/companies/c1/book-studio/books/book-1/autopilot/start")
      .send({})
      .expect(201);

    const res = await request(app)
      .get("/companies/c1/book-studio/books/book-1/autopilot/status")
      .expect(200);
    expect(res.body.autopilot.status).toBe("running");
  });

  it("pause transitions to paused", async () => {
    await request(app)
      .post("/companies/c1/book-studio/books/book-1/autopilot/start")
      .send({})
      .expect(201);

    // Give the background loop time to settle
    await new Promise((r) => setTimeout(r, 50));

    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-1/autopilot/pause")
      .expect(200);
    expect(res.body.autopilot.status).toBe("paused");
    expect(res.body.autopilot.pausedAt).toBeTruthy();
  });

  it("resume transitions from paused to running", async () => {
    await request(app)
      .post("/companies/c1/book-studio/books/book-1/autopilot/start")
      .send({})
      .expect(201);

    // Give background loop time to settle
    await new Promise((r) => setTimeout(r, 50));

    await request(app)
      .post("/companies/c1/book-studio/books/book-1/autopilot/pause")
      .expect(200);

    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-1/autopilot/resume")
      .expect(200);
    expect(res.body.autopilot.status).toBe("running");
    expect(res.body.autopilot.pausedAt).toBeNull();
  });

  it("steer sets guidance", async () => {
    await request(app)
      .post("/companies/c1/book-studio/books/book-1/autopilot/start")
      .send({})
      .expect(201);

    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-1/autopilot/steer")
      .send({ guidance: "Make dialogue more natural" })
      .expect(200);
    expect(res.body.autopilot.guidance).toBe("Make dialogue more natural");
  });

  it("steer rejects missing guidance with 400", async () => {
    await request(app)
      .post("/companies/c1/book-studio/books/book-1/autopilot/start")
      .send({})
      .expect(201);

    await request(app)
      .post("/companies/c1/book-studio/books/book-1/autopilot/steer")
      .send({})
      .expect(400);
  });

  it("conflicts on duplicate start", async () => {
    await request(app)
      .post("/companies/c1/book-studio/books/book-1/autopilot/start")
      .send({})
      .expect(201);

    // Give background loop time to settle
    await new Promise((r) => setTimeout(r, 50));

    // Pause first so we can test running conflict
    await request(app)
      .post("/companies/c1/book-studio/books/book-1/autopilot/pause")
      .send({})
      .expect(200);

    // Second start for same book when paused - should be allowed (creates fresh)
    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-1/autopilot/start")
      .send({})
      .expect(201);
    expect(res.body.autopilot.status).toBe("running");
  });

  it("returns 404 for non-existent book", async () => {
    await request(app)
      .get("/companies/c1/book-studio/books/nonexistent/autopilot/status")
      .expect(404);
  });

  it("pause on non-running returns conflict", async () => {
    await request(app)
      .post("/companies/c1/book-studio/books/never-started/autopilot/pause")
      .expect(404);
  });

  it("resume on non-paused returns conflict", async () => {
    await request(app)
      .post("/companies/c1/book-studio/books/book-1/autopilot/start")
      .send({})
      .expect(201);

    // Give background loop time to settle
    await new Promise((r) => setTimeout(r, 50));

    await request(app)
      .post("/companies/c1/book-studio/books/book-1/autopilot/resume")
      .expect(409);
  });
});
