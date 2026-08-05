import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { books, storyBibleCharacters, storyBibleChatMessages, storyBibleOutline, storyBibleStyle, storyBibleWorldLocations } from "@paperclipai/db";

vi.mock("../services/book-agent-lanes.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../services/book-agent-lanes.js")>()), callAgentLane: vi.fn() }));
vi.mock("../services/index.js", () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));
import { AgentLaneUnavailableError, callAgentLane } from "../services/book-agent-lanes.js";
import { bookStudioRoutes } from "../routes/book-studio.js";

const book = { id: "book-1", companyId: "company-1", slug: "book", title: "Book", metadata: {}, createdAt: new Date(), updatedAt: new Date() };
const userRow = (overrides: Record<string, unknown> = {}) => ({ id: "u-1", bookId: "book-1", turnId: "turn-1", role: "user", content: "hello", status: "failed", via: "none", delegationId: null, conversationId: "book-studio:company-1:book-1", retryCount: 0, retryable: true, authorization: null, actionResult: null, error: "offline", archivedAt: null, createdAt: new Date("2026-08-04T12:00:00Z"), ...overrides });

function createApp(initialMessages: any[]) {
  const state = { messages: [...initialMessages] };
  const rowsFor = (table: unknown) => table === books ? [book] : table === storyBibleChatMessages ? state.messages : table === storyBibleCharacters || table === storyBibleWorldLocations || table === storyBibleStyle || table === storyBibleOutline ? [] : [];
  const query = (table: unknown) => {
    const get = () => rowsFor(table);
    const thenable: any = { where: () => thenable, orderBy: () => thenable, limit: async (limit: number) => get().slice(0, limit), then: (resolve: any, reject: any) => Promise.resolve(get()).then(resolve, reject) };
    return thenable;
  };
  const db: any = {
    execute: vi.fn().mockResolvedValue([]),
    select: vi.fn(() => ({ from: (table: unknown) => query(table) })),
    update: vi.fn((table: unknown) => ({ set: (changes: any) => ({ where: () => {
      let affected: any[] = [];
      if (table === storyBibleChatMessages) {
        if (changes.status === "pending" && changes.retryCount) {
          const row = state.messages.find((item) => item.status === "failed" && item.role === "user" && !item.archivedAt);
          if (row) { row.status = "pending"; row.error = null; row.retryCount += 1; affected = [row]; }
        } else {
          for (const row of state.messages) { if (!row.archivedAt || changes.archivedAt) { Object.assign(row, changes); affected.push(row); } }
        }
      }
      const promise: any = Promise.resolve(affected); promise.returning = () => Promise.resolve(affected); return promise;
    } }) })),
    insert: vi.fn((table: unknown) => ({ values: (values: any) => ({ returning: async () => { const row = { id: `m-${state.messages.length + 1}`, createdAt: new Date(), archivedAt: null, error: null, ...values }; if (table === storyBibleChatMessages) state.messages.push(row); return [row]; } }) })),
  };
  db.transaction = vi.fn(async (callback: (tx: any) => unknown) => callback(db));
  const app = express(); app.use(express.json());
  app.use((req: any, _res, next) => { req.actor = { type: "board", userId: "board-1", source: "local_implicit" }; next(); });
  app.use("/api", bookStudioRoutes(db));
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ error: err.message }));
  return { app, db, state };
}

describe("Book Studio chat v4 durability", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists stable book-scoped archive groups with chronological normalized turns", async () => {
    const archivedAt = new Date("2026-08-04T13:00:00Z");
    const user = userRow({ status: "completed", archivedAt, createdAt: new Date("2026-08-04T12:00:00Z") });
    const assistant = { ...user, id: "a-1", role: "assistant", content: "answer", createdAt: new Date("2026-08-04T12:01:00Z"), via: "calliope" };
    const { app } = createApp([assistant, user]);
    const result = await request(app).get("/api/companies/company-1/book-studio/books/book-1/chat/archives").expect(200);
    expect(result.body.archives).toHaveLength(1);
    expect(result.body.archives[0].archivedAt).toBe(archivedAt.toISOString());
    expect(result.body.archives[0].messages[0]).toMatchObject({ userMessage: "hello", reply: "answer", status: "completed" });
  });

  it("refuses reset while an active turn is pending", async () => {
    const { app, db } = createApp([userRow({ status: "pending" })]);
    await request(app).post("/api/companies/company-1/book-studio/books/book-1/chat/reset").expect(409);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("uses a real failed-to-pending claim so concurrent retry cannot dispatch twice", async () => {
    let resolveLane!: (value: any) => void;
    vi.mocked(callAgentLane).mockReturnValue(new Promise((resolve) => { resolveLane = resolve; }));
    const { app, state } = createApp([userRow()]);
    const first = request(app).post("/api/companies/company-1/book-studio/books/book-1/chat/turn-1/retry").then((response) => response);
    for (let i = 0; i < 20 && vi.mocked(callAgentLane).mock.calls.length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 1));
    const second = await request(app).post("/api/companies/company-1/book-studio/books/book-1/chat/turn-1/retry").expect(409);
    expect(second.body.error).toContain("still working");
    expect(callAgentLane).toHaveBeenCalledTimes(1);
    expect(callAgentLane).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ conversationId: "book-studio:company-1:book-1", metadata: expect.objectContaining({ turnId: "turn-1", retryCount: 1 }) }));
    resolveLane({ text: "answer", delegationId: "del-1", lane: "calliope" });
    expect((await first).status).toBe(200);
    expect(state.messages.filter((row) => row.role === "assistant" && row.turnId === "turn-1")).toHaveLength(1);
  });

  it("never retries an indeterminate delegation", async () => {
    const { app } = createApp([userRow({ retryable: false, delegationId: "del-unknown" })]);
    const result = await request(app).post("/api/companies/company-1/book-studio/books/book-1/chat/turn-1/retry").expect(409);
    expect(result.body.error).toContain("cannot be safely retried");
    expect(callAgentLane).not.toHaveBeenCalled();
  });

  it("makes a retry permanently non-retryable when its dispatch outcome is indeterminate", async () => {
    vi.mocked(callAgentLane).mockRejectedValue(new AgentLaneUnavailableError("calliope", "durable state unproven", { fallbackSafe: false, delegationId: "del-unknown" }));
    const { app, state } = createApp([userRow()]);
    const first = await request(app).post("/api/companies/company-1/book-studio/books/book-1/chat/turn-1/retry").expect(502);
    expect(first.body.retryable).toBe(false);
    expect(state.messages[0]).toMatchObject({ status: "failed", retryable: false, delegationId: "del-unknown" });
    await request(app).post("/api/companies/company-1/book-studio/books/book-1/chat/turn-1/retry").expect(409);
    expect(callAgentLane).toHaveBeenCalledTimes(1);
  });
});
