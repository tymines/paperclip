import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIsConfigured = vi.hoisted(() => vi.fn().mockResolvedValue(true));

vi.mock("../services/image-providers/replicate.js", () => ({
  replicateProvider: {
    isConfigured: mockIsConfigured,
  },
}));

async function createApp() {
  vi.resetModules();
  const [{ errorHandler }, { bookStudioImageGenerateRoutes }] =
    await Promise.all([
      import("../middleware/index.js") as Promise<
        typeof import("../middleware/index.js")
      >,
      import("../routes/book-studio-image-generate.js") as Promise<
        typeof import("../routes/book-studio-image-generate.js")
      >,
    ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "user-1",
      companyIds: ["company-1"],
      source: "session",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", bookStudioImageGenerateRoutes({} as any));
  app.use(errorHandler);
  return app;
}

async function requestApp(
  app: express.Express,
  buildRequest: (baseUrl: string) => request.Test,
) {
  const { createServer } =
    await vi.importActual<typeof import("node:http")>("node:http");
  const server = createServer(app);
  try {
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected HTTP server to listen on a TCP port");
    }
    return await buildRequest(`http://127.0.0.1:${address.port}`);
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  }
}

describe.sequential("book studio image generate routes", () => {
  beforeEach(() => {
    mockIsConfigured.mockReset();
    mockIsConfigured.mockResolvedValue(true);
  });

  // ── POST /companies/:companyId/book-studio/generate/image ──────────────
  describe("POST /generate/image", () => {
    const ENDPOINT = "/api/companies/company-1/book-studio/generate/image";

    it("returns 200 + correct draft response shape", async () => {
      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl)
          .post(ENDPOINT)
          .send({ prompt: "A mystical library with floating books" }),
      );

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        draft: {
          imageUrl: expect.any(String),
          prompt: "A mystical library with floating books",
          model: "black-forest-labs/flux-dev-lora",
          metadata: {
            provider: "replicate",
            modelId: "black-forest-labs/flux-dev-lora",
          },
        },
        status: "draft",
        entityType: "image",
      });
    });

    it("accepts optional style and aspectRatio", async () => {
      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl)
          .post(ENDPOINT)
          .send({
            prompt: "A mystical library",
            style: "digital painting",
            aspectRatio: "1:1",
          }),
      );

      expect(res.status).toBe(200);
      expect(res.body.draft.aspectRatio).toBe("1:1");
    });

    it("returns 400 when prompt is missing", async () => {
      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl).post(ENDPOINT).send({}),
      );

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "prompt is required" });
    });

    it("returns 400 when prompt is not a string", async () => {
      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl).post(ENDPOINT).send({ prompt: 42 }),
      );

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "prompt is required" });
    });

    it("returns 503 when Replicate is not configured", async () => {
      mockIsConfigured.mockResolvedValue(false);

      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl)
          .post(ENDPOINT)
          .send({ prompt: "A castle" }),
      );

      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({
        error: "image generation is not configured",
      });
    });
  });

  // ── POST /companies/:companyId/book-studio/generate/cover ──────────────
  describe("POST /generate/cover", () => {
    const ENDPOINT = "/api/companies/company-1/book-studio/generate/cover";

    it("returns 200 + correct draft response shape", async () => {
      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl)
          .post(ENDPOINT)
          .send({
            prompt: "Fantasy book cover with dragons",
            bookId: "book-1",
          }),
      );

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        draft: {
          imageUrl: expect.any(String),
          prompt: "Fantasy book cover with dragons",
          model: "black-forest-labs/flux-dev-lora",
          metadata: {
            provider: "replicate",
            modelId: "black-forest-labs/flux-dev-lora",
          },
        },
        status: "draft",
        entityType: "cover",
      });
    });

    it("returns 400 when prompt is missing", async () => {
      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl)
          .post(ENDPOINT)
          .send({ bookId: "book-1" }),
      );

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "prompt is required" });
    });

    it("returns 400 when bookId is missing", async () => {
      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl)
          .post(ENDPOINT)
          .send({ prompt: "A cover" }),
      );

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "bookId is required" });
    });

    it("returns 503 when Replicate is not configured", async () => {
      mockIsConfigured.mockResolvedValue(false);

      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl)
          .post(ENDPOINT)
          .send({ prompt: "A cover", bookId: "book-1" }),
      );

      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({
        error: "image generation is not configured",
      });
    });
  });

  // ── POST /companies/:companyId/book-studio/generate/scene-illustration ──
  describe("POST /generate/scene-illustration", () => {
    const ENDPOINT =
      "/api/companies/company-1/book-studio/generate/scene-illustration";

    it("returns 200 + correct draft response shape", async () => {
      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl)
          .post(ENDPOINT)
          .send({
            prompt: "Dark forest at twilight",
            sceneId: "scene-1",
          }),
      );

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        draft: {
          imageUrl: expect.any(String),
          prompt: "Dark forest at twilight",
          model: "black-forest-labs/flux-dev-lora",
          metadata: {
            provider: "replicate",
            modelId: "black-forest-labs/flux-dev-lora",
          },
        },
        status: "draft",
        entityType: "scene-illustration",
      });
    });

    it("returns 400 when prompt is missing", async () => {
      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl)
          .post(ENDPOINT)
          .send({ sceneId: "scene-1" }),
      );

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "prompt is required" });
    });

    it("returns 400 when sceneId is missing", async () => {
      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl)
          .post(ENDPOINT)
          .send({ prompt: "A scene" }),
      );

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "sceneId is required" });
    });

    it("returns 503 when Replicate is not configured", async () => {
      mockIsConfigured.mockResolvedValue(false);

      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl)
          .post(ENDPOINT)
          .send({ prompt: "A scene", sceneId: "scene-1" }),
      );

      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({
        error: "image generation is not configured",
      });
    });
  });
});
