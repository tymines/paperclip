import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ──────────────────────────────────────────
const mockLogActivity = vi.hoisted(() => vi.fn());
const mockGeminiApiKey = vi.hoisted(() => vi.fn((): string | null => "fake-key"));
const mockStreamDesignReply = vi.hoisted(() => vi.fn());
const mockConceptImageStatus = vi.hoisted(() => vi.fn(() => ({ configured: false, reason: "no key" })));
const mockResolveConceptImageGenerator = vi.hoisted(() => vi.fn(() => null));

vi.mock("../services/index.js", () => ({
  logActivity: mockLogActivity,
}));

vi.mock("../services/app-dev/design-chat.js", () => ({
  DESIGN_AGENT_MODEL: "gemini-2.5-flash",
  DesignModelUnconfiguredError: class extends Error {},
  streamDesignReply: mockStreamDesignReply,
  geminiApiKey: mockGeminiApiKey,
}));

vi.mock("../services/app-dev/concept-image.js", () => ({
  conceptImageStatus: mockConceptImageStatus,
  resolveConceptImageGenerator: mockResolveConceptImageGenerator,
}));

vi.mock("../middleware/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// ── Test fixtures ──────────────────────────────────────────
const COMPANY_ID = randomUUID();
const APP_ID = randomUUID();

function makeAppRow(overrides: Record<string, unknown> = {}) {
  return {
    id: APP_ID,
    companyId: COMPANY_ID,
    key: "testapp",
    name: "Test App",
    tagline: null as string | null,
    kind: "app",
    accent: "#3B82FF",
    repo: null as string | null,
    feedbackOriginId: "testapp",
    sortOrder: 0,
    createdAt: new Date("2026-07-05T00:00:00Z"),
    updatedAt: new Date("2026-07-05T00:00:00Z"),
    ...overrides,
  };
}

function makeBlueprintRow(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    companyId: null,
    category: "dashboard",
    name: "Analytics Dashboard",
    description: "A real-time analytics dashboard",
    icon: "chart-bar",
    starterStack: ["react", "tailwind"],
    sortOrder: 1,
    createdAt: new Date("2026-07-05T00:00:00Z"),
    ...overrides,
  };
}

// ── Mock DB builder ────────────────────────────────────────

/**
 * Build a mock Drizzle query chain where `where()` returns a thenable
 * that also supports `.orderBy()` and `.limit()` — matching Drizzle's
 * actual API where `where()` is chainable AND awaitable.
 */
function mockChain<T = unknown>(results: T) {
  const thenable = Promise.resolve(results);
  return Object.assign(thenable, {
    orderBy: vi.fn(() => Promise.resolve(results)),
    limit: vi.fn(() => Promise.resolve(results)),
    where: vi.fn(() => mockChain(results)),
  });
}

function mockFullChain<T = unknown>(results: T) {
  return {
    from: vi.fn(() => mockChain(results)),
  };
}

// ── App builder ────────────────────────────────────────────
async function createApp(
  actor: Record<string, unknown>,
  mockDb: Record<string, unknown>,
) {
  const { appDevRoutes } = await import("../routes/app-dev.js");
  const { errorHandler } = await import("../middleware/index.js");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", appDevRoutes(mockDb as any));
  app.use(errorHandler);
  return app;
}

const DEFAULT_ACTOR = {
  type: "board",
  userId: "user-1",
  source: "local_implicit",
  companyIds: [COMPANY_ID],
};

// ── Suite ──────────────────────────────────────────────────
describe("App Dev Studio routes", () => {
  let mockDb: Record<string, unknown>;
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── GET /apps ───────────────────────────────────────────
  describe("GET /companies/:companyId/app-dev/apps", () => {
    it("returns apps list for a company", async () => {
      // ensureApps reads issues; main query reads appDevApps + issues + approvals
      mockDb.select = vi.fn(() => mockFullChain([makeAppRow()]));
      mockDb.insert = vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => Promise.resolve([])),
        })),
      })) as any;
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app).get(`/api/companies/${COMPANY_ID}/app-dev/apps`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("apps");
      expect(Array.isArray(res.body.apps)).toBe(true);
    });
  });

  // ── GET /blueprints ─────────────────────────────────────
  describe("GET /companies/:companyId/app-dev/blueprints", () => {
    it("returns blueprint catalog", async () => {
      // ensureApps calls select first; blueprint route calls its own select
      mockDb.select = vi.fn(() => mockFullChain([makeBlueprintRow()]));
      mockDb.insert = vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => Promise.resolve([])),
        })),
      })) as any;
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app).get(`/api/companies/${COMPANY_ID}/app-dev/blueprints`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("blueprints");
    });
  });

  // ── GET /apps/:appId/builds ─────────────────────────────
  describe("GET /companies/:companyId/app-dev/apps/:appId/builds", () => {
    it("returns pipeline stages and builds", async () => {
      // ensureApps + main query both via select
      mockDb.select = vi.fn(() => mockFullChain([]));
      mockDb.insert = vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => Promise.resolve([])),
        })),
      })) as any;
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app).get(
        `/api/companies/${COMPANY_ID}/app-dev/apps/${APP_ID}/builds`,
      );
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("appKey");
      expect(res.body).toHaveProperty("stages");
      expect(res.body).toHaveProperty("builds");
    });
  });

  // ── GET /apps/:appId/releases ───────────────────────────
  describe("GET /companies/:companyId/app-dev/apps/:appId/releases", () => {
    it("returns version-grouped feedback", async () => {
      mockDb.select = vi.fn(() => mockFullChain([makeAppRow({ feedbackOriginId: "testapp" })]));
      mockDb.insert = vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => Promise.resolve([])),
        })),
      })) as any;
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app).get(
        `/api/companies/${COMPANY_ID}/app-dev/apps/${APP_ID}/releases`,
      );
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("appKey");
      expect(res.body).toHaveProperty("source");
      expect(res.body).toHaveProperty("latestVersion");
      expect(res.body).toHaveProperty("unversionedCount");
      expect(res.body).toHaveProperty("versions");
    });

    it("returns 404 for missing app", async () => {
      mockDb.select = vi.fn(() => mockFullChain([]));
      mockDb.insert = vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => Promise.resolve([])),
        })),
      })) as any;
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app).get(
        `/api/companies/${COMPANY_ID}/app-dev/apps/nonexistent-app/releases`,
      );
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty("error");
    });
  });

  // ── POST /design-chat/stream ───────────────────────────
  describe("POST /companies/:companyId/app-dev/design-chat/stream", () => {
    it("returns error on missing prompt", async () => {
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/app-dev/design-chat/stream`)
        .send({});
      expect(res.status).toBe(200);
      expect(res.text).toContain("prompt is required");
    });

    it("returns model_unconfigured without Gemini key", async () => {
      mockGeminiApiKey.mockReturnValueOnce(null);
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/app-dev/design-chat/stream`)
        .send({ prompt: "Design a login screen" });
      expect(res.text).toContain("model_unconfigured");
      expect(res.text).toContain("Gemini");
    });
  });

  // ── PATCH /apps/:appId ─────────────────────────────────
  describe("PATCH /companies/:companyId/app-dev/apps/:appId", () => {
    it("updates app name successfully", async () => {
      // getApp calls select; PATCH handler calls update
      mockDb.select = vi.fn(() => mockFullChain([makeAppRow()]));
      mockDb.update = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => Promise.resolve([makeAppRow({ name: "New Name" })])),
          })),
        })),
      }));
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app)
        .patch(`/api/companies/${COMPANY_ID}/app-dev/apps/${APP_ID}`)
        .send({ name: "New Name" });
      expect(res.status).toBe(200);
      expect(res.body.apps[0].name).toBe("New Name");
    });

    it("validates accent color (422 on invalid hex)", async () => {
      mockDb.select = vi.fn(() => mockFullChain([makeAppRow()]));
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app)
        .patch(`/api/companies/${COMPANY_ID}/app-dev/apps/${APP_ID}`)
        .send({ accent: "not-a-color" });
      expect(res.status).toBe(422);
      expect(res.body.error).toContain("hex color");
    });

    it("returns 404 on missing app", async () => {
      mockDb.select = vi.fn(() => mockFullChain([]));
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app)
        .patch(`/api/companies/${COMPANY_ID}/app-dev/apps/nonexistent`)
        .send({ name: "New Name" });
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("not found");
    });

    it("logs activity on successful patch", async () => {
      mockDb.select = vi.fn(() => mockFullChain([makeAppRow()]));
      mockDb.update = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => Promise.resolve([makeAppRow({ name: "Updated" })])),
          })),
        })),
      }));
      app = await createApp(DEFAULT_ACTOR, mockDb);

      await request(app)
        .patch(`/api/companies/${COMPANY_ID}/app-dev/apps/${APP_ID}`)
        .send({ name: "Updated" });

      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "app_dev_update_app",
          entityType: "app_dev_app",
          entityId: APP_ID,
        }),
      );
    });

    it("returns 422 on empty body", async () => {
      mockDb.select = vi.fn(() => mockFullChain([makeAppRow()]));
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app)
        .patch(`/api/companies/${COMPANY_ID}/app-dev/apps/${APP_ID}`)
        .send({});
      expect(res.status).toBe(422);
      expect(res.body.error).toContain("No valid fields");
    });
  });
});
