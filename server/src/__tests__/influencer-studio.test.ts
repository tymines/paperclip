// @ts-nocheck
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the services
vi.mock("../services/influencer-studio/content-generator.js", () => ({
  generateContentIdeas: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  logActivity: vi.fn(),
}));

function createMockDb() {
  const mockQuery = {
    limit: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
  };
  const mockSelect = {
    from: vi.fn().mockReturnValue(mockQuery),
  };
  const mockInsert = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  };
  return {
    mockDb: {
      select: vi.fn().mockReturnValue(mockSelect),
      insert: vi.fn().mockReturnValue(mockInsert),
    },
    mockQuery,
    mockInsert,
  };
}

function makeApp(routesFn, mockDb, opts?) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = { actorType: "board", actorId: "test-board-user", agentId: null };
    next();
  });
  app.use(routesFn(mockDb, opts));
  return app;
}

describe("Influencer Studio Routes", () => {
  let imageStudioRoutesFn;
  let influencerStudioRoutesFn;

  beforeEach(async () => {
    vi.resetModules();
    vi.doUnmock("../routes/image-studio.js");
    vi.doUnmock("../routes/influencer-studio.js");

    const routes = await vi.importActual("../routes/image-studio.js");
    const infRoutes = await vi.importActual("../routes/influencer-studio.js");
    imageStudioRoutesFn = routes.imageStudioRoutes;
    influencerStudioRoutesFn = infRoutes.influencerStudioRoutes;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("POST generate-content", () => {
    it("returns 400 when topic is missing", async () => {
      const { mockDb } = createMockDb();
      const res = await request(makeApp(imageStudioRoutesFn, mockDb))
        .post("/companies/test-company/image-studio/personas/p1/generate-content")
        .send({});
      expect(res.status).toBe(400);
    });

    it("returns 400 when topic is empty", async () => {
      const { mockDb } = createMockDb();
      const res = await request(makeApp(imageStudioRoutesFn, mockDb))
        .post("/companies/test-company/image-studio/personas/p1/generate-content")
        .send({ topic: "" });
      expect(res.status).toBe(400);
    });

    it("returns 404 when persona doesn't exist", async () => {
      const { mockDb, mockQuery } = createMockDb();
      mockQuery.limit.mockResolvedValue([]);
      const res = await request(makeApp(imageStudioRoutesFn, mockDb))
        .post("/companies/test-company/image-studio/personas/p1/generate-content")
        .send({ topic: "fashion" });
      expect(res.status).toBe(404);
    });
  });

  describe("POST schedule-post", () => {
    it("returns 400 when caption is missing", async () => {
      const { mockDb } = createMockDb();
      const res = await request(makeApp(imageStudioRoutesFn, mockDb))
        .post("/companies/test-company/image-studio/personas/p1/schedule-post")
        .send({});
      expect(res.status).toBe(400);
    });

    it("returns 400 when caption is empty", async () => {
      const { mockDb } = createMockDb();
      const res = await request(makeApp(imageStudioRoutesFn, mockDb))
        .post("/companies/test-company/image-studio/personas/p1/schedule-post")
        .send({ caption: "" });
      expect(res.status).toBe(400);
    });

    it("returns 404 when persona doesn't exist", async () => {
      const { mockDb, mockQuery } = createMockDb();
      mockQuery.limit.mockResolvedValue([]);
      const res = await request(makeApp(imageStudioRoutesFn, mockDb))
        .post("/companies/test-company/image-studio/personas/p1/schedule-post")
        .send({ caption: "Hello world" });
      expect(res.status).toBe(404);
    });

    it("creates social_post with status='draft'", async () => {
      const { mockDb, mockQuery, mockInsert } = createMockDb();
      mockQuery.limit.mockResolvedValue([{ id: "p1" }]);
      const fakePost = {
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
      };
      mockInsert.returning.mockResolvedValue([fakePost]);
      const res = await request(makeApp(imageStudioRoutesFn, mockDb))
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
      const { mockDb, mockQuery } = createMockDb();
      mockQuery.orderBy.mockResolvedValue([]);
      const res = await request(makeApp(influencerStudioRoutesFn, mockDb))
        .get("/companies/test-company/influencer/drafts");
      expect(res.status).toBe(200);
      expect(res.body.drafts).toEqual([]);
    });

    it("filters by personaId when provided", async () => {
      const { mockDb, mockQuery } = createMockDb();
      const fakeDraft = {
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
      };
      mockQuery.orderBy.mockResolvedValue([fakeDraft]);
      const res = await request(makeApp(influencerStudioRoutesFn, mockDb))
        .get("/companies/test-company/influencer/drafts?personaId=specific-persona");
      expect(res.status).toBe(200);
      expect(res.body.drafts).toHaveLength(1);
      expect(res.body.drafts[0].content).toBe("Filtered post");
    });
  });
});
