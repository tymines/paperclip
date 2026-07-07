import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Router } from "express";

// Mock the services
vi.mock("../services/influencer-studio/content-generator.js", () => ({
  generateContentIdeas: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  logActivity: vi.fn(),
}));

// ── Mock DB ───────────────────────────────────────────────────────────────
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

function createMockDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => q([]),
          orderBy: () => q([]),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => q([]),
      }),
    }),
  };
}

// ── Build test apps ───────────────────────────────────────────────────────

interface MockDb {
  select: () => any;
  insert: () => any;
}

async function createImageStudioApp(mockDb: MockDb) {
  const mod = await import("../routes/image-studio.js");
  const router: Router = mod.imageStudioRoutes(mockDb);
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.actor = { actorType: "board", actorId: "test-board-user", agentId: null };
    next();
  });
  app.use(router);
  return { app };
}

async function createInfluencerStudioApp(mockDb: MockDb) {
  const mod = await import("../routes/influencer-studio.js");
  const router: Router = mod.influencerStudioRoutes(mockDb);
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.actor = { actorType: "board", actorId: "test-board-user", agentId: null };
    next();
  });
  app.use(router);
  return { app };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("Influencer Studio Routes", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("POST generate-content", () => {
    it("returns 400 when topic is missing", async () => {
      const { app } = await createImageStudioApp(createMockDb());
      const res = await request(app)
        .post("/companies/test-company/image-studio/personas/p1/generate-content")
        .send({});
      expect(res.status).toBe(400);
    });

    it("returns 400 when topic is empty", async () => {
      const { app } = await createImageStudioApp(createMockDb());
      const res = await request(app)
        .post("/companies/test-company/image-studio/personas/p1/generate-content")
        .send({ topic: "" });
      expect(res.status).toBe(400);
    });

    it("returns 404 when persona doesn't exist", async () => {
      const { app } = await createImageStudioApp(createMockDb());
      const res = await request(app)
        .post("/companies/test-company/image-studio/personas/p1/generate-content")
        .send({ topic: "fashion" });
      expect(res.status).toBe(404);
    });
  });

  describe("POST schedule-post", () => {
    it("returns 400 when caption is missing", async () => {
      const { app } = await createImageStudioApp(createMockDb());
      const res = await request(app)
        .post("/companies/test-company/image-studio/personas/p1/schedule-post")
        .send({});
      expect(res.status).toBe(400);
    });

    it("returns 400 when caption is empty", async () => {
      const { app } = await createImageStudioApp(createMockDb());
      const res = await request(app)
        .post("/companies/test-company/image-studio/personas/p1/schedule-post")
        .send({ caption: "" });
      expect(res.status).toBe(400);
    });

    it("returns 404 when persona doesn't exist", async () => {
      const { app } = await createImageStudioApp(createMockDb());
      const res = await request(app)
        .post("/companies/test-company/image-studio/personas/p1/schedule-post")
        .send({ caption: "Hello world" });
      expect(res.status).toBe(404);
    });

    it("creates social_post with status='draft'", async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              // Persona lookup: return a found persona
              limit: () => q([{ id: "p1" }]),
            }),
          }),
        }),
        insert: () => ({
          values: () => ({
            returning: () => q([{
              id: randomUUID(),
              companyId: "test-company",
              content: "Hello world",
              postType: "text",
              status: "draft",
              mediaUrls: [],
              metadata: { personaId: "p1", source: "influencer-studio" },
              createdBy: "test-board-user",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }]),
          }),
        }),
      };
      const { app } = await createImageStudioApp(mockDb);
      const res = await request(app)
        .post("/companies/test-company/image-studio/personas/p1/schedule-post")
        .send({ caption: "Hello world" });
      expect(res.status).toBe(201);
      expect(res.body.post).toBeDefined();
      expect(res.body.post.status).toBe("draft");
      expect(res.body.post.content).toBe("Hello world");
    });
  });

  describe("GET /influencer/drafts", () => {
    it("returns empty array when no drafts exist", async () => {
      const { app } = await createInfluencerStudioApp(createMockDb());
      const res = await request(app)
        .get("/companies/test-company/influencer/drafts");
      expect(res.status).toBe(200);
      expect(res.body.drafts).toEqual([]);
    });

    it("filters by personaId when provided", async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => q([{
                id: randomUUID(),
                companyId: "test-company",
                content: "Filtered post",
                postType: "text",
                status: "draft",
                mediaUrls: [],
                metadata: { personaId: "specific-persona", source: "influencer-studio" },
                createdBy: "test-board-user",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }]),
            }),
          }),
        }),
        insert: () => ({
          values: () => ({
            returning: () => q([]),
          }),
        }),
      };
      const { app } = await createInfluencerStudioApp(mockDb);
      const res = await request(app)
        .get("/companies/test-company/influencer/drafts?personaId=specific-persona");
      expect(res.status).toBe(200);
      expect(res.body.drafts).toHaveLength(1);
      expect(res.body.drafts[0].content).toBe("Filtered post");
    });
  });
});
