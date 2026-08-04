import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { Db } from "@paperclipai/db";

vi.mock("../services/book-agent-lanes.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../services/book-agent-lanes.js")>();
  return { ...mod, callAgentLane: vi.fn() };
});

import { storyBibleGenerateRoutes } from "../routes/story-bible-generate.js";
import { callAgentLane, AgentLaneUnavailableError } from "../services/book-agent-lanes.js";

function q<T>(value: T): any {
  const promise = Promise.resolve(value);
  const chain: Record<string, any> = {
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  for (const method of ["from", "where", "orderBy", "limit"]) {
    chain[method] = vi.fn(() => chain);
  }
  return chain;
}

function mockDb(bookCompanyId = "c1"): Db {
  let bookLookupPending = true;
  return {
    select: vi.fn(() => {
      const value = bookLookupPending
        ? [{ id: "book-1", companyId: bookCompanyId, title: "The Echo of Stone" }]
        : [];
      bookLookupPending = false;
      return q(value);
    }),
  } as unknown as Db;
}

function createTestApp(bookCompanyId = "c1") {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.actor = { type: "board", userId: "test-user", source: "local_implicit" };
    next();
  });
  app.use(storyBibleGenerateRoutes(mockDb(bookCompanyId)));
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status || 500).json({ error: err.message || "Internal error" });
  });
  return app;
}

describe("Story-bible generation through Calliope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const genericCases = [
    {
      endpoint: "character",
      output: {
        name: "Elena Voss",
        role: "protagonist",
        description: "A sharp-witted archaeologist.",
        voiceCard: "dry and intellectual",
      },
      assertion: (draft: Record<string, unknown>) => {
        expect(draft.name).toBe("Elena Voss");
        expect(draft.voiceCard).toEqual({ description: "dry and intellectual" });
      },
    },
    {
      endpoint: "location",
      output: {
        name: "Sunken Athenaeum",
        description: "A ruined library in a flooded caldera.",
        rules: ["magic is suppressed"],
        sensoryNotes: "dripping water echoes",
      },
      assertion: (draft: Record<string, unknown>) => {
        expect(draft.name).toBe("Sunken Athenaeum");
        expect(draft.rules).toEqual({ "0": "magic is suppressed" });
      },
    },
    {
      endpoint: "world-rule",
      output: {
        name: "The Veil of Silence",
        description: "Divine communication arrives garbled.",
        rules: { prayer: "garbled" },
      },
      assertion: (draft: Record<string, unknown>) => {
        expect(draft.name).toBe("The Veil of Silence");
      },
    },
    {
      endpoint: "style",
      output: {
        pov: "third person limited",
        tense: "past",
        comps: ["Shades of Magic", "Library at Mount Char"],
        sampleParagraph: "The book did not want to open.",
        bannedCliches: ["it was all a dream"],
      },
      assertion: (draft: Record<string, unknown>) => {
        expect(draft.pov).toBe("third person limited");
        expect(draft.comps).toBe("Shades of Magic, Library at Mount Char");
      },
    },
  ];

  it.each(genericCases)("returns the existing $endpoint draft shape from Calliope", async ({ endpoint, output, assertion }) => {
    vi.mocked(callAgentLane).mockResolvedValue({
      text: JSON.stringify(output),
      delegationId: `del-${endpoint}`,
      lane: "calliope",
    });

    const res = await request(createTestApp())
      .post(`/companies/c1/book-studio/books/book-1/generate/${endpoint}`)
      .send({ prompt: "Generate a fitting entry" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "draft", entityType: endpoint });
    assertion(res.body.draft);
    const laneCall = vi.mocked(callAgentLane).mock.calls[0][1];
    expect(laneCall).toMatchObject({
      lane: "calliope",
      companyId: "c1",
      metadata: { bookId: "book-1", operation: `generate-${endpoint}` },
      requestedByActorId: "test-user",
    });
  });

  it("preserves the multi-chapter outline response and deterministic numbering", async () => {
    vi.mocked(callAgentLane).mockResolvedValue({
      text: JSON.stringify({
        chapters: [
          { chapterNumber: 99, title: "The Wrong Book", beats: ["Discovery", "Escape"] },
          { chapterNumber: 200, title: "The Deep Door", beats: ["Descent"] },
        ],
      }),
      delegationId: "del-outline",
      lane: "calliope",
    });

    const res = await request(createTestApp())
      .post("/companies/c1/book-studio/books/book-1/generate/outline-beats")
      .send({ prompt: "Generate two chapters" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "draft", entityType: "outline-beats" });
    expect(res.body.draft.chapters).toEqual([
      { chapterNumber: 1, title: "The Wrong Book", beats: [{ description: "Discovery" }, { description: "Escape" }] },
      { chapterNumber: 2, title: "The Deep Door", beats: [{ description: "Descent" }] },
    ]);
  });

  it("returns an honest 503 and no draft when Calliope is unavailable", async () => {
    vi.mocked(callAgentLane).mockRejectedValue(
      new AgentLaneUnavailableError("calliope", "peer unreachable (timeout)"),
    );

    const res = await request(createTestApp())
      .post("/companies/c1/book-studio/books/book-1/generate/character")
      .send({});

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      error: "Calliope is unavailable. No story-bible draft was generated.",
      via: "none",
      agentLane: "unavailable",
    });
    expect(res.body).not.toHaveProperty("draft");
  });

  it("enforces the URL company before dispatching Calliope", async () => {
    const res = await request(createTestApp("c2"))
      .post("/companies/c1/book-studio/books/book-1/generate/character")
      .send({});

    expect(res.status).toBe(404);
    expect(callAgentLane).not.toHaveBeenCalled();
  });
});
