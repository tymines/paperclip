import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ──────────────────────────────────────────────────────

const mockIsConfigured = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const mockSubmitGeneration = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ predictionId: "pred-123" }),
);
const mockPollPrediction = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    id: "pred-123",
    status: "succeeded",
    outputUrl: "https://replicate.delivery/pbxt/test/output.png",
    error: null,
    costUsd: 0.01,
  }),
);
const mockDownloadOutput = vi.hoisted(() =>
  vi.fn().mockResolvedValue(Buffer.from("fake-png-data")),
);

vi.mock("../services/image-providers/replicate.js", () => ({
  replicateProvider: {
    isConfigured: mockIsConfigured,
    submitGeneration: mockSubmitGeneration,
    pollPrediction: mockPollPrediction,
    downloadOutput: mockDownloadOutput,
  },
}));

// ── Test app builder ───────────────────────────────────────────────────

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

// ── HTTP test helper (starts/stops a real server for supertest) ────────

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

// ── Tests ──────────────────────────────────────────────────────────────

describe.sequential("book studio image generate routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConfigured.mockResolvedValue(true);
    mockSubmitGeneration.mockResolvedValue({ predictionId: "pred-123" });
    mockPollPrediction.mockResolvedValue({
      id: "pred-123",
      status: "succeeded",
      outputUrl: "https://replicate.delivery/pbxt/test/output.png",
      error: null,
      costUsd: 0.01,
    });
    mockDownloadOutput.mockResolvedValue(Buffer.from("fake-png-data"));
  });

  // ── POST /generate/image ──────────────────────────────────────────────

  describe("POST /generate/image", () => {
    const ENDPOINT = "/api/companies/company-1/book-studio/generate/image";

    it("returns 200 + generating response with predictionId", async () => {
      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl).post(ENDPOINT).send({
          prompt: "A mystical library with floating books",
          bookSlug: "echo-of-stone",
        }),
      );

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        draft: {
          predictionId: "pred-123",
          status: "starting",
          prompt: "A mystical library with floating books",
          model: "black-forest-labs/flux-dev-lora",
        },
        status: "generating",
        entityType: "image",
      });
      expect(mockSubmitGeneration).toHaveBeenCalledWith({
        prompt: "A mystical library with floating books",
        modelRef: "black-forest-labs/flux-dev-lora",
        aspectRatio: "16:9",
        steps: 28,
      });
    });

    it("accepts optional aspectRatio", async () => {
      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl).post(ENDPOINT).send({
          prompt: "A mystical library",
          bookSlug: "echo-of-stone",
          aspectRatio: "1:1",
        }),
      );

      expect(res.status).toBe(200);
      expect(mockSubmitGeneration).toHaveBeenCalledWith(
        expect.objectContaining({ aspectRatio: "1:1" }),
      );
    });

    it("returns 400 when prompt is missing", async () => {
      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl).post(ENDPOINT).send({ bookSlug: "echo-of-stone" }),
      );

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "prompt is required" });
    });

    it("returns 400 when prompt is not a string", async () => {
      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl).post(ENDPOINT).send({ prompt: 42, bookSlug: "echo-of-stone" }),
      );

      expect(res.status).toBe(400);
    });

    it("returns 400 when bookSlug is missing", async () => {
      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl).post(ENDPOINT).send({ prompt: "A castle" }),
      );

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "bookSlug is required" });
    });

    it("returns 503 when Replicate is not configured", async () => {
      mockIsConfigured.mockResolvedValue(false);

      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl).post(ENDPOINT).send({
          prompt: "A castle",
          bookSlug: "echo-of-stone",
        }),
      );

      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({
        error: "image generation is not configured",
      });
    });
  });

  // ── POST /generate/cover ──────────────────────────────────────────────

  describe("POST /generate/cover", () => {
    const ENDPOINT = "/api/companies/company-1/book-studio/generate/cover";

    it("returns 200 + generating response with predictionId", async () => {
      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl).post(ENDPOINT).send({
          prompt: "Fantasy book cover with dragons",
          bookSlug: "echo-of-stone",
        }),
      );

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        draft: {
          predictionId: "pred-123",
          status: "starting",
          prompt: "Fantasy book cover with dragons",
          model: "black-forest-labs/flux-dev-lora",
        },
        status: "generating",
        entityType: "cover",
      });
      // Cover should use 2:3 aspect ratio
      expect(mockSubmitGeneration).toHaveBeenCalledWith(
        expect.objectContaining({ aspectRatio: "2:3" }),
      );
    });

    it("returns 400 when prompt is missing", async () => {
      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl)
          .post(ENDPOINT)
          .send({ bookSlug: "echo-of-stone" }),
      );

      expect(res.status).toBe(400);
    });

    it("returns 400 when bookSlug is missing", async () => {
      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl).post(ENDPOINT).send({ prompt: "A cover" }),
      );

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "bookSlug is required" });
    });

    it("returns 503 when Replicate is not configured", async () => {
      mockIsConfigured.mockResolvedValue(false);

      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl).post(ENDPOINT).send({
          prompt: "A cover",
          bookSlug: "echo-of-stone",
        }),
      );

      expect(res.status).toBe(503);
    });
  });

  // ── POST /generate/scene-illustration ─────────────────────────────────

  describe("POST /generate/scene-illustration", () => {
    const ENDPOINT =
      "/api/companies/company-1/book-studio/generate/scene-illustration";

    it("returns 200 + generating response with predictionId", async () => {
      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl).post(ENDPOINT).send({
          prompt: "Dark forest at twilight",
          bookSlug: "echo-of-stone",
          sceneId: "scene-1",
        }),
      );

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        draft: {
          predictionId: "pred-123",
          status: "starting",
          prompt: "Dark forest at twilight",
          model: "black-forest-labs/flux-dev-lora",
        },
        status: "generating",
        entityType: "scene-illustration",
      });
    });

    it("returns 400 when prompt is missing", async () => {
      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl)
          .post(ENDPOINT)
          .send({ bookSlug: "echo-of-stone", sceneId: "scene-1" }),
      );

      expect(res.status).toBe(400);
    });

    it("returns 400 when bookSlug is missing", async () => {
      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl).post(ENDPOINT).send({
          prompt: "A scene",
          sceneId: "scene-1",
        }),
      );

      expect(res.status).toBe(400);
    });

    it("returns 503 when Replicate is not configured", async () => {
      mockIsConfigured.mockResolvedValue(false);

      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl).post(ENDPOINT).send({
          prompt: "A scene",
          bookSlug: "echo-of-stone",
          sceneId: "scene-1",
        }),
      );

      expect(res.status).toBe(503);
    });
  });

  // ── GET /generate/poll/:predictionId ──────────────────────────────────

  describe("GET /generate/poll/:predictionId", () => {
    const POLL_ENDPOINT =
      "/api/companies/company-1/book-studio/generate/poll/pred-123";

    it("returns processing while prediction is still running", async () => {
      mockPollPrediction.mockResolvedValue({
        id: "pred-123",
        status: "processing",
        outputUrl: null,
        error: null,
        costUsd: null,
      });

      // First submit so the prediction is tracked
      const app = await createApp();
      // Submit first
      await requestApp(app, (baseUrl) =>
        request(baseUrl)
          .post("/api/companies/company-1/book-studio/generate/image")
          .send({ prompt: "Test", bookSlug: "echo-of-stone" }),
      );

      // Then poll
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl).get(POLL_ENDPOINT),
      );

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        draft: { status: "processing" },
      });
    });

    it("returns completed with imageUrl when succeeded", async () => {
      const app = await createApp();
      // Submit first
      await requestApp(app, (baseUrl) =>
        request(baseUrl)
          .post("/api/companies/company-1/book-studio/generate/image")
          .send({ prompt: "Test", bookSlug: "echo-of-stone" }),
      );

      // Poll with succeeded status
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl).get(POLL_ENDPOINT),
      );

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        draft: {
          imageUrl: expect.stringContaining("/api/book-studio/media/echo-of-stone/"),
          status: "completed",
        },
      });
      expect(mockDownloadOutput).toHaveBeenCalledWith(
        "https://replicate.delivery/pbxt/test/output.png",
      );
    });

    it("returns failed when prediction failed", async () => {
      mockPollPrediction.mockResolvedValue({
        id: "pred-123",
        status: "failed",
        outputUrl: null,
        error: "NSFW content detected",
        costUsd: null,
      });

      const app = await createApp();
      await requestApp(app, (baseUrl) =>
        request(baseUrl)
          .post("/api/companies/company-1/book-studio/generate/image")
          .send({ prompt: "Test", bookSlug: "echo-of-stone" }),
      );

      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl).get(POLL_ENDPOINT),
      );

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        draft: {
          status: "failed",
          error: "NSFW content detected",
        },
      });
    });

    it("returns 404 for unknown predictionId", async () => {
      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl).get(
          "/api/companies/company-1/book-studio/generate/pred/unknown-pred",
        ),
      );

      expect(res.status).toBe(404);
    });
  });

  // ── GET /media/:bookSlug/:filename ────────────────────────────────────

  describe("GET /media/:bookSlug/:filename", () => {
    it("returns 404 for non-existent file", async () => {
      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl).get(
          "/api/companies/company-1/book-studio/media/echo-of-stone/nonexistent.png",
        ),
      );

      expect(res.status).toBe(404);
    });
  });
});
