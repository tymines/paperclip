import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { Db } from "@paperclipai/db";

// Mock the brainstorm chat service (keep the real buildSystemPrompt — the
// route uses it to brief the Calliope lane).
// Mock the live-agent lane, keeping the real error class so the route's
// unavailable branch is exercised without dispatching real agent work.
vi.mock("../services/book-agent-lanes.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../services/book-agent-lanes.js")>();
  return { ...mod, callAgentLane: vi.fn() };
});
vi.mock("../services/book-chat-recovery.js", () => ({
  reconcileBookChatTurns: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/index.js", () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));

import { bookStudioRoutes } from "../routes/book-studio.js";
import { callAgentLane, AgentLaneUnavailableError } from "../services/book-agent-lanes.js";
import { logActivity } from "../services/index.js";

/**
 * Build a mock DB that returns a query builder from .select().
 * Each chained method returns a new query object so that .limit()
 * (the terminal call) can return a Promise with the desired data.
 */
function mockQuery<T>(resolveData: T) {
  // Promise that resolves to the data — makes the query thenable for `await`
  const promise = Promise.resolve(resolveData);
  const q = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  // .where() and .orderBy() return q for chaining; .limit() is the terminal
  q.where.mockReturnValue(q);
  q.orderBy.mockReturnValue(q);
  q.limit.mockResolvedValue(resolveData);
  return q;
}

function createApp() {
  const app = express();
  app.use(express.json());

  // Set up a mock actor so assertCompanyAccess passes
  app.use((req: any, _res: any, next: any) => {
    req.actor = { type: "board", userId: "test-user", source: "local_implicit" };
    next();
  });

  const mockDb = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    execute: vi.fn().mockResolvedValue([]),
    transaction: vi.fn(),
    values: vi.fn(),
    returning: vi.fn(),
    onConflictDoUpdate: vi.fn(),
  } as unknown as Db;

  mockDb.transaction.mockImplementation(async (callback: (tx: Db) => unknown) => callback(mockDb));

  // Wire .select() to return a fresh query builder by default
  mockDb.select.mockReturnValue(mockQuery([]));

  // Wire .insert().values().returning() chain
  mockDb.insert.mockReturnValue(mockDb);
  mockDb.values.mockReturnValue(mockDb);
  mockDb.onConflictDoUpdate.mockReturnValue(mockDb);
  mockDb.update.mockImplementation(() => ({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "msg-1" }]),
      }),
    }),
  }));

  app.use("/api", bookStudioRoutes(mockDb));

  // Error handler to surface errors in tests
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("TEST ERROR:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Internal error" });
  });

  return { app, db: mockDb, mockQuery };
}

describe("Book Studio Brainstorm Chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(logActivity).mockResolvedValue(undefined);
    // Default: the live Calliope lane returns an honest unavailable response
    // unless a test opts the agent lane back in.
    vi.mocked(callAgentLane).mockRejectedValue(
      new AgentLaneUnavailableError("calliope", "peer unreachable (timeout)"),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("POST /chat", () => {
    it("returns 200 with reply shape when valid message is sent", async () => {
      const { app, db, mockQuery } = createApp();

      const book = {
        id: "book-1",
        companyId: "company-1",
        slug: "my-book",
        title: "My Book",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Order of select().from().where().limit() calls:
      // 1. book lookup (limit:1 -> [book])
      // 2. characters (no limit -> [])
      // 3. locations (no limit -> [])
      // 4. styles (no limit -> [])
      // 5. outlines (no limit -> [])
      // 6. history (limit:50 -> [])

      db.select
        .mockReturnValueOnce(mockQuery([book]))   // book
        .mockReturnValueOnce(mockQuery([]))         // characters
        .mockReturnValueOnce(mockQuery([]))         // locations
        .mockReturnValueOnce(mockQuery([]))         // styles
        .mockReturnValueOnce(mockQuery([]))         // outlines
        .mockReturnValueOnce(mockQuery([]));        // history

      // Mock insert chain: user msg insert -> assistant msg insert
      db.returning
        .mockResolvedValueOnce([{ id: "msg-1", bookId: "book-1", role: "user", content: "hello", createdAt: new Date() }])
        .mockResolvedValueOnce([{ id: "msg-2", bookId: "book-1", role: "assistant", content: "Hi there!", createdAt: new Date() }]);

      vi.mocked(callAgentLane).mockResolvedValue({
        text: "Hi there!",
        delegationId: "del-1",
        lane: "calliope",
      });

      const res = await request(app)
        .post("/api/companies/company-1/book-studio/books/book-1/chat")
        .send({ message: "hello" })
        .expect(200);

      expect(res.body).toHaveProperty("reply", "Hi there!");
      expect(res.body).toHaveProperty("messageId", "msg-2");
      expect(res.body).toHaveProperty("userMessageId", "msg-1");
      expect(res.body).toHaveProperty("via", "calliope");
      expect(callAgentLane).toHaveBeenCalledTimes(1);
    });

    it("returns 400 when message is empty", async () => {
      const { app } = createApp();

      const res = await request(app)
        .post("/api/companies/company-1/book-studio/books/book-1/chat")
        .send({ message: "" })
        .expect(400);

      expect(res.body).toHaveProperty("error");
    });

    it("returns 503 and persists only the user turn when Calliope is unavailable", async () => {
      const { app, db, mockQuery } = createApp();

      const book = {
        id: "book-1",
        companyId: "company-1",
        slug: "my-book",
        title: "My Book",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      db.select
        .mockReturnValueOnce(mockQuery([book]))   // book
        .mockReturnValueOnce(mockQuery([]))         // characters
        .mockReturnValueOnce(mockQuery([]))         // locations
        .mockReturnValueOnce(mockQuery([]))         // styles
        .mockReturnValueOnce(mockQuery([]))         // outlines
        .mockReturnValueOnce(mockQuery([]));        // history

      // Mock returning for user message insert only (assistant never inserted)
      db.returning
        .mockResolvedValueOnce([{ id: "msg-1", bookId: "book-1", role: "user", content: "hello", createdAt: new Date() }]);

      const res = await request(app)
        .post("/api/companies/company-1/book-studio/books/book-1/chat")
        .send({ message: "hello" })
        .expect(503);

      expect(res.body.error).toContain("Calliope is unavailable");
      expect(res.body).toHaveProperty("messageId", "msg-1");
      expect(res.body).toHaveProperty("via", "none");
      expect(res.body).toHaveProperty("agentLane", "unavailable");
      expect(callAgentLane).toHaveBeenCalledTimes(1);
      expect(db.insert).toHaveBeenCalledTimes(1);
    });

    it("returns 404 for a book outside the authorized company — no delegation, no fallback call, no persistence (P1)", async () => {
      const { app, db, mockQuery } = createApp();

      // The book exists but belongs to company-2; the URL is authorized for
      // company-1. The route must treat the pair as not-found BEFORE reading
      // the bible/history, persisting anything, or invoking any lane.
      const foreignBook = {
        id: "book-1",
        companyId: "company-2",
        slug: "my-book",
        title: "My Book",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      db.select.mockReturnValueOnce(mockQuery([foreignBook])); // book lookup

      const res = await request(app)
        .post("/api/companies/company-1/book-studio/books/book-1/chat")
        .send({ message: "hello" })
        .expect(404);

      expect(res.body).toHaveProperty("error");
      expect(callAgentLane).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });

    it("answers via the live Calliope agent lane when she is reachable (Spec v1.4)", async () => {
      const { app, db, mockQuery } = createApp();

      const book = {
        id: "book-1",
        companyId: "company-1",
        slug: "my-book",
        title: "My Book",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      db.select
        .mockReturnValueOnce(mockQuery([book]))   // book
        .mockReturnValueOnce(mockQuery([]))         // characters
        .mockReturnValueOnce(mockQuery([]))         // locations
        .mockReturnValueOnce(mockQuery([]))         // styles
        .mockReturnValueOnce(mockQuery([]))         // outlines
        .mockReturnValueOnce(mockQuery([]));        // history

      db.returning
        .mockResolvedValueOnce([{ id: "msg-1", bookId: "book-1", role: "user", content: "hello", createdAt: new Date() }])
        .mockResolvedValueOnce([{ id: "msg-2", bookId: "book-1", role: "assistant", content: "Ooh — what if the map is lying?", createdAt: new Date() }]);

      vi.mocked(callAgentLane).mockResolvedValue({
        text: "Ooh — what if the map is lying?",
        delegationId: "del-42",
        lane: "calliope",
      });

      const res = await request(app)
        .post("/api/companies/company-1/book-studio/books/book-1/chat")
        .send({ message: "hello" })
        .expect(200);

      expect(res.body).toHaveProperty("reply", "Ooh — what if the map is lying?");
      expect(res.body).toHaveProperty("via", "calliope");
      expect(res.body).toHaveProperty("delegationId", "del-42");
      // The live agent answered through the company-scoped lane.
      // The delegation contract received the company-scoped brief.
      const laneCall = vi.mocked(callAgentLane).mock.calls[0][1];
      expect(laneCall.lane).toBe("calliope");
      expect(laneCall.companyId).toBe("company-1");
      expect(laneCall.metadata).toMatchObject({ bookId: "book-1" });
      expect(laneCall.task).toContain("USER: hello");
    });

    it("never calls another model when Calliope is unreachable", async () => {
      const { app, db, mockQuery } = createApp();

      const book = {
        id: "book-1",
        companyId: "company-1",
        slug: "my-book",
        title: "My Book",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      db.select
        .mockReturnValueOnce(mockQuery([book]))   // book
        .mockReturnValueOnce(mockQuery([]))         // characters
        .mockReturnValueOnce(mockQuery([]))         // locations
        .mockReturnValueOnce(mockQuery([]))         // styles
        .mockReturnValueOnce(mockQuery([]))         // outlines
        .mockReturnValueOnce(mockQuery([]));        // history

      db.returning
        .mockResolvedValueOnce([{ id: "msg-1", bookId: "book-1", role: "user", content: "hello", createdAt: new Date() }]);

      const res = await request(app)
        .post("/api/companies/company-1/book-studio/books/book-1/chat")
        .send({ message: "hello" })
        .expect(503);

      expect(res.body.error).toContain("Calliope is unavailable");
      expect(res.body).toHaveProperty("via", "none");
      expect(res.body).toHaveProperty("agentLane", "unavailable");
      expect(res.body.agentLaneError).toContain("calliope");
      expect(callAgentLane).toHaveBeenCalledTimes(1);
      expect(db.insert).toHaveBeenCalledTimes(1);
    });

    it("returns an honest 502 for an indeterminate lane outcome with no fabricated reply", async () => {
      const { app, db, mockQuery } = createApp();

      const book = {
        id: "book-1",
        companyId: "company-1",
        slug: "my-book",
        title: "My Book",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      db.select
        .mockReturnValueOnce(mockQuery([book]))   // book
        .mockReturnValueOnce(mockQuery([]))         // characters
        .mockReturnValueOnce(mockQuery([]))         // locations
        .mockReturnValueOnce(mockQuery([]))         // styles
        .mockReturnValueOnce(mockQuery([]))         // outlines
        .mockReturnValueOnce(mockQuery([]));        // history

      // User message persists; the assistant reply must NOT.
      db.returning
        .mockResolvedValueOnce([{ id: "msg-1", bookId: "book-1", role: "user", content: "hello", createdAt: new Date() }]);

      vi.mocked(callAgentLane).mockRejectedValue(
        new AgentLaneUnavailableError("calliope", "lane outcome indeterminate — durable state unproven", { fallbackSafe: false }),
      );

      const res = await request(app)
        .post("/api/companies/company-1/book-studio/books/book-1/chat")
        .send({ message: "hello" })
        .expect(502);

      expect(res.body).toHaveProperty("via", "none");
      expect(res.body).toHaveProperty("agentLane", "indeterminate");
      expect(res.body).toHaveProperty("messageId", "msg-1");
      expect(res.body.agentLaneError).toContain("indeterminate");
      // Only the user message was persisted; no assistant reply was fabricated.
      // Only the user message was persisted — no fabricated assistant reply.
      expect(db.insert).toHaveBeenCalledTimes(1);
    });
  });

  describe("POST /suggest-next", () => {
    const book = {
      id: "book-1",
      companyId: "company-1",
      slug: "my-book",
      title: "My Book",
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    function arrangeBookContext(db: any, mockQueryFor: typeof mockQuery) {
      db.select
        .mockReturnValueOnce(mockQueryFor([book]))
        .mockReturnValueOnce(mockQueryFor([]))
        .mockReturnValueOnce(mockQueryFor([]))
        .mockReturnValueOnce(mockQueryFor([]))
        .mockReturnValueOnce(mockQueryFor([]))
        .mockReturnValueOnce(mockQueryFor([]));
    }

    it("returns the existing structured suggestion shape from Calliope", async () => {
      const { app, db, mockQuery: mockQueryFor } = createApp();
      arrangeBookContext(db, mockQueryFor);
      vi.mocked(callAgentLane).mockResolvedValue({
        text: JSON.stringify({
          action: "add_location",
          entityType: "world-location",
          reason: "The setting needs a strong opposing force.",
          suggestedData: { name: "The Glass Marsh", description: "A reflective wetland." },
        }),
        delegationId: "del-suggest",
        lane: "calliope",
      });

      const res = await request(app)
        .post("/api/companies/company-1/book-studio/books/book-1/suggest-next")
        .send({})
        .expect(200);

      expect(res.body).toEqual({
        action: "add_location",
        entityType: "world-location",
        reason: "The setting needs a strong opposing force.",
        suggestedData: { name: "The Glass Marsh", description: "A reflective wetland." },
      });
      expect(vi.mocked(callAgentLane).mock.calls[0][1]).toMatchObject({
        lane: "calliope",
        companyId: "company-1",
        metadata: { bookId: "book-1", operation: "suggest-next" },
        requestedByActorId: "test-user",
      });
    });

    it("returns 503 with no suggestion when Calliope is unavailable", async () => {
      const { app, db, mockQuery: mockQueryFor } = createApp();
      arrangeBookContext(db, mockQueryFor);

      const res = await request(app)
        .post("/api/companies/company-1/book-studio/books/book-1/suggest-next")
        .send({})
        .expect(503);

      expect(res.body).toMatchObject({
        error: "Calliope is unavailable. No suggestion was generated.",
        via: "none",
        agentLane: "unavailable",
      });
      expect(res.body).not.toHaveProperty("suggestedData");
    });

    it("rejects a cross-company book before dispatching Calliope", async () => {
      const { app, db, mockQuery: mockQueryFor } = createApp();
      db.select.mockReturnValueOnce(mockQueryFor([{ ...book, companyId: "company-2" }]));

      await request(app)
        .post("/api/companies/company-1/book-studio/books/book-1/suggest-next")
        .send({})
        .expect(404);

      expect(callAgentLane).not.toHaveBeenCalled();
    });
  });

  describe("GET /chat", () => {
    it("returns paired turns in chronological order", async () => {
      const { app, db, mockQuery } = createApp();

      const messages = [
        { id: "msg-4", turnId: "turn-2", bookId: "book-1", role: "assistant" as const, content: "second reply", status: "completed", via: "calliope", createdAt: new Date("2025-01-04") },
        { id: "msg-3", turnId: "turn-2", bookId: "book-1", role: "user" as const, content: "follow-up", status: "completed", via: "calliope", createdAt: new Date("2025-01-03") },
        { id: "msg-2", turnId: "turn-1", bookId: "book-1", role: "assistant" as const, content: "first reply", status: "completed", via: "calliope", createdAt: new Date("2025-01-02") },
        { id: "msg-1", turnId: "turn-1", bookId: "book-1", role: "user" as const, content: "hello", status: "completed", via: "calliope", createdAt: new Date("2025-01-01") },
      ];

      db.select
        .mockReturnValueOnce(mockQuery([{ id: "book-1", companyId: "company-1" }]))
        .mockReturnValueOnce(mockQuery(messages));

      const res = await request(app)
        .get("/api/companies/company-1/book-studio/books/book-1/chat")
        .expect(200);

      expect(res.body).toHaveProperty("messages");
      expect(Array.isArray(res.body.messages)).toBe(true);
      expect(res.body.messages).toHaveLength(2);
      expect(res.body.messages.map((turn: { turnId: string }) => turn.turnId)).toEqual(["turn-1", "turn-2"]);
    });
  });

  describe("POST /review-runs", () => {
    const book = { id: "book-1", companyId: "company-1", title: "My Book" };
    const chapter = {
      id: "chapter-1",
      bookId: "book-1",
      chapterNumber: 1,
      content: "A chapter passage that Hades can review.",
    };

    function arrangeReviewContext(db: any, mockQueryFor: typeof mockQuery) {
      db.select
        .mockReturnValueOnce(mockQueryFor([book]))
        .mockReturnValueOnce(mockQueryFor([]))
        .mockReturnValueOnce(mockQueryFor([chapter]));
    }

    it("fails closed with no stored run when Hades is unavailable", async () => {
      const { app, db, mockQuery: mockQueryFor } = createApp();
      arrangeReviewContext(db, mockQueryFor);
      vi.mocked(callAgentLane).mockRejectedValue(
        new AgentLaneUnavailableError("hades", "peer unreachable (peer_unconfigured)"),
      );

      const res = await request(app)
        .post("/api/companies/company-1/book-studio/books/book-1/review-runs")
        .send({ chapterNumber: 1, lens: "prose" })
        .expect(503);

      expect(res.body).toMatchObject({
        available: false,
        via: "none",
        reviewer: "Hades",
        model: "Kimi K3",
        agentLane: "unavailable",
      });
      expect(db.insert).not.toHaveBeenCalled();
    });

    it("routes a stored review only through Hades with Kimi K3 provenance", async () => {
      const { app, db, mockQuery: mockQueryFor } = createApp();
      arrangeReviewContext(db, mockQueryFor);
      vi.mocked(callAgentLane).mockResolvedValue({
        text: JSON.stringify({
          summary: "Focused review.",
          findings: [{ excerpt: "chapter passage", note: "Tighten this phrase.", kind: "suggestion" }],
        }),
        delegationId: "del-hades-review",
        lane: "hades",
      });
      db.returning
        .mockResolvedValueOnce([{ id: "run-1", reviewer: "Hades", model: "Kimi K3 (kimi-coding/kimi-k3)" }])
        .mockResolvedValueOnce([{ id: "anno-1", spanStart: 2 }]);

      const res = await request(app)
        .post("/api/companies/company-1/book-studio/books/book-1/review-runs")
        .send({ chapterNumber: 1, lens: "prose" })
        .expect(201);

      expect(res.body.available).toBe(true);
      expect(vi.mocked(callAgentLane).mock.calls[0][1]).toMatchObject({
        lane: "hades",
        companyId: "company-1",
        metadata: { bookId: "book-1", chapterNumber: 1, lens: "prose", operation: "review-run" },
      });
      expect(db.values.mock.calls[0][0]).toMatchObject({
        reviewer: "Hades",
        model: "Kimi K3 (kimi-coding/kimi-k3)",
      });
      expect(db.values.mock.calls[1][0]).toMatchObject({ author: "Hades / Kimi K3" });
    });
  });

  describe("POST /chat/reset", () => {
    it("archives active rows and never deletes transcript history", async () => {
      const { app, db, mockQuery: mockQueryFor } = createApp();
      db.select.mockReturnValueOnce(mockQueryFor([{ id: "book-1", companyId: "company-1" }]));
      const set = vi.fn();
      const where = vi.fn();
      const returning = vi.fn().mockResolvedValue([{ id: "m1" }, { id: "m2" }]);
      set.mockReturnValue({ where });
      where.mockReturnValue({ returning });
      db.update.mockReturnValue({ set });

      const res = await request(app)
        .post("/api/companies/company-1/book-studio/books/book-1/chat/reset")
        .send({})
        .expect(200);

      expect(res.body).toEqual({ messages: [], archivedCount: 2, activeCount: 0 });
      expect(set).toHaveBeenCalledWith({ archivedAt: expect.any(Date) });
      expect(returning).toHaveBeenCalledTimes(1);
      expect((db as unknown as { delete?: unknown }).delete).toBeUndefined();
    });
  });

  describe("POST /chat/:messageId/to-draft", () => {
    const msg = {
      id: "msg-1",
      bookId: "book-1",
      role: "assistant" as const,
      content: "This character would be a mysterious figure who appears only at night.",
      createdAt: new Date(),
    };

    const userMsg = {
      id: "msg-2",
      bookId: "book-1",
      role: "user" as const,
      content: "Create a character for me.",
      createdAt: new Date(),
    };

    it("returns correct character draft", async () => {
      const { app, db, mockQuery } = createApp();
      db.select.mockReturnValueOnce(mockQuery([msg]));

      const res = await request(app)
        .post("/api/companies/company-1/book-studio/books/book-1/chat/msg-1/to-draft")
        .send({ target: "character" })
        .expect(200);

      expect(res.body).toEqual({
        entityType: "character",
        draft: {
          name: "",
          role: "",
          description: "This character would be a mysterious figure who appears only at night.",
          voiceCard: {},
          source: "co_created",
        },
        sourceMessageId: "msg-1",
      });
    });

    it("returns correct world-location draft", async () => {
      const { app, db, mockQuery } = createApp();
      const locMsg = { ...msg, content: "The Whispering Forest is an ancient woodland where the trees remember everything." };
      db.select.mockReturnValueOnce(mockQuery([locMsg]));

      const res = await request(app)
        .post("/api/companies/company-1/book-studio/books/book-1/chat/msg-1/to-draft")
        .send({ target: "world-location" })
        .expect(200);

      expect(res.body.entityType).toBe("world-location");
      expect(res.body.draft.description).toBe("The Whispering Forest is an ancient woodland where the trees remember everything.");
      expect(res.body.draft.source).toBe("co_created");
    });

    it("returns correct style draft", async () => {
      const { app, db, mockQuery } = createApp();
      const styleMsg = { ...msg, content: "Try using first-person present tense for a more immediate feel." };
      db.select.mockReturnValueOnce(mockQuery([styleMsg]));

      const res = await request(app)
        .post("/api/companies/company-1/book-studio/books/book-1/chat/msg-1/to-draft")
        .send({ target: "style" })
        .expect(200);

      expect(res.body.entityType).toBe("style");
      expect(res.body.draft.sampleParagraph).toBe("Try using first-person present tense for a more immediate feel.");
      expect(res.body.draft.bannedCliches).toEqual([]);
    });

    it("returns correct outline draft", async () => {
      const { app, db, mockQuery } = createApp();
      const outlineMsg = { ...msg, content: "Chapter 1 should open with the protagonist discovering the hidden map in the library attic." };
      db.select.mockReturnValueOnce(mockQuery([outlineMsg]));

      const res = await request(app)
        .post("/api/companies/company-1/book-studio/books/book-1/chat/msg-1/to-draft")
        .send({ target: "outline" })
        .expect(200);

      expect(res.body.entityType).toBe("outline");
      expect(res.body.draft.chapterNumber).toBe(1);
      expect(res.body.draft.beats[0].description).toBe("Chapter 1 should open with the protagonist discovering the hidden map in the library attic.");
    });

    it("returns 404 when message is not found", async () => {
      const { app, db, mockQuery } = createApp();
      db.select.mockReturnValueOnce(mockQuery([]));

      const res = await request(app)
        .post("/api/companies/company-1/book-studio/books/book-1/chat/nonexistent/to-draft")
        .send({ target: "character" })
        .expect(404);

      expect(res.body).toHaveProperty("error");
    });

    it("returns 400 when drafting from a user message", async () => {
      const { app, db, mockQuery } = createApp();
      db.select.mockReturnValueOnce(mockQuery([userMsg]));

      const res = await request(app)
        .post("/api/companies/company-1/book-studio/books/book-1/chat/msg-2/to-draft")
        .send({ target: "character" })
        .expect(400);

      expect(res.body).toHaveProperty("error", "Can only draft from assistant messages");
    });
  });
});
