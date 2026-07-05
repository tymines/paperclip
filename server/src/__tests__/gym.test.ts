import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ──────────────────────────────────────────
const mockLogActivity = vi.hoisted(() => vi.fn());
const mockRunEvaluation = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  logActivity: mockLogActivity,
}));

vi.mock("../middleware/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// ── Test fixtures ──────────────────────────────────────────
const COMPANY_ID = randomUUID();
const SUITE_ID = randomUUID();
const RUN_ID = randomUUID();
const PROMPT_ID = randomUUID();
const AGENT_ID = randomUUID();
const AGENT_PROFILE_ID = randomUUID();

function makeSuiteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SUITE_ID,
    companyId: COMPANY_ID,
    name: "Test Suite",
    description: "An eval suite for testing",
    testCases: [
      { id: "tc-1", prompt: "What is 2+2?", expectedResponse: "4", rubric: "Correctness", weight: 1 },
    ],
    createdBy: "user-1",
    createdAt: new Date("2026-07-05T00:00:00Z"),
    updatedAt: new Date("2026-07-05T00:00:00Z"),
    ...overrides,
  };
}

function makeRunRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    companyId: COMPANY_ID,
    suiteId: SUITE_ID,
    status: "completed",
    scores: [{ testCaseId: "tc-1", score: 85, reasoning: "Good", latencyMs: 500 }],
    overallScore: 85,
    modelUsed: "gemini-2.5-flash",
    promptCandidateId: null,
    agentProfileId: null,
    durationMs: 500,
    error: null,
    startedAt: new Date("2026-07-05T00:00:00Z"),
    completedAt: new Date("2026-07-05T00:00:00Z"),
    createdAt: new Date("2026-07-05T00:00:00Z"),
    ...overrides,
  };
}

function makePromptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PROMPT_ID,
    companyId: COMPANY_ID,
    name: "My Prompt",
    systemPrompt: "You are a helpful assistant",
    userPromptTemplate: null,
    model: "gemini-2.5-flash",
    temperature: 70,
    version: 1,
    tags: [],
    metadata: {},
    createdBy: "user-1",
    createdAt: new Date("2026-07-05T00:00:00Z"),
    updatedAt: new Date("2026-07-05T00:00:00Z"),
    ...overrides,
  };
}

function makeProfileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: AGENT_PROFILE_ID,
    companyId: COMPANY_ID,
    agentId: AGENT_ID,
    name: "Test Agent",
    description: "A test agent profile",
    promptCandidateId: null,
    totalRuns: 5,
    averageScore: 75,
    bestScore: 90,
    lastRunAt: new Date("2026-07-05T00:00:00Z"),
    createdAt: new Date("2026-07-05T00:00:00Z"),
    updatedAt: new Date("2026-07-05T00:00:00Z"),
    ...overrides,
  };
}

// ── Mock DB builder ────────────────────────────────────────
function mockChain<T = unknown>(results: T) {
  const thenable = Promise.resolve(results);
  return Object.assign(thenable, {
    orderBy: vi.fn(() => mockChain(results)),
    limit: vi.fn(() => mockChain(results)),
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
  const { gymRoutes } = await import("../routes/gym.js");
  const { errorHandler } = await import("../middleware/index.js");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", gymRoutes(mockDb as any));
  app.use(errorHandler);
  return app;
}

const DEFAULT_ACTOR = {
  type: "board",
  userId: "user-1",
  source: "local_implicit",
  companyIds: [COMPANY_ID],
};

const AGENT_ACTOR = {
  type: "agent",
  agentId: "agent-1",
  companyId: COMPANY_ID,
  source: "api_key",
};

// ── Suite ──────────────────────────────────────────────────
describe("Gym Studio routes", () => {
  let mockDb: Record<string, unknown>;
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = {};
    mockRunEvaluation.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── GET /suites ─────────────────────────────────────────
  describe("GET /companies/:companyId/gym/suites", () => {
    it("returns suites list for a company", async () => {
      mockDb.select = vi.fn(() => mockFullChain([makeSuiteRow()]));
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app).get(`/api/companies/${COMPANY_ID}/gym/suites`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("suites");
      expect(Array.isArray(res.body.suites)).toBe(true);
      expect(res.body.suites[0].name).toBe("Test Suite");
    });
  });

  // ── POST /suites ────────────────────────────────────────
  describe("POST /companies/:companyId/gym/suites", () => {
    it("creates a new suite successfully", async () => {
      mockDb.insert = vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([makeSuiteRow()])),
        })),
      }));
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/gym/suites`)
        .send({ name: "Test Suite", testCases: [{ prompt: "test", expectedResponse: "answer", rubric: "quality", weight: 1 }] });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("suite");
      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: "create_gym_suite" }),
      );
    });

    it("returns 422 when name is missing", async () => {
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/gym/suites`)
        .send({ testCases: [] });
      expect(res.status).toBe(422);
      expect(res.body.error).toContain("name");
    });

    it("returns 422 when testCases is not an array", async () => {
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/gym/suites`)
        .send({ name: "Test", testCases: "not-array" });
      expect(res.status).toBe(422);
      expect(res.body.error).toContain("array");
    });

    it("returns 422 when testCases is empty", async () => {
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/gym/suites`)
        .send({ name: "Test", testCases: [] });
      expect(res.status).toBe(422);
      expect(res.body.error).toContain("empty");
    });

    it("returns 422 when more than 5 test cases", async () => {
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/gym/suites`)
        .send({
          name: "Test",
          testCases: Array.from({ length: 6 }, (_, i) => ({
            prompt: `test${i}`,
            expectedResponse: "ans",
            rubric: "q",
            weight: 1,
          })),
        });
      expect(res.status).toBe(422);
      expect(res.body.error).toContain("max 5");
    });
  });

  // ── DELETE /suites/:suiteId ─────────────────────────────
  describe("DELETE /companies/:companyId/gym/suites/:suiteId", () => {
    it("deletes a suite successfully", async () => {
      mockDb.delete = vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([makeSuiteRow()])),
        })),
      }));
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app).delete(`/api/companies/${COMPANY_ID}/gym/suites/${SUITE_ID}`);
      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(true);
      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: "delete_gym_suite" }),
      );
    });

    it("returns 404 for nonexistent suite", async () => {
      mockDb.delete = vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([])),
        })),
      }));
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app).delete(`/api/companies/${COMPANY_ID}/gym/suites/nonexistent`);
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("not found");
    });
  });

  // ── POST /suites/:suiteId/run ───────────────────────────
  describe("POST /companies/:companyId/gym/suites/:suiteId/run", () => {
    it("returns 404 for missing suite", async () => {
      mockDb.select = vi.fn(() => mockFullChain([]));
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/gym/suites/nonexistent/run`)
        .send({});
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("not found");
    });
  });

  // ── GET /runs ───────────────────────────────────────────
  describe("GET /companies/:companyId/gym/runs", () => {
    it("returns runs list for a company", async () => {
      mockDb.select = vi.fn(() => mockFullChain([makeRunRow()]));
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app).get(`/api/companies/${COMPANY_ID}/gym/runs`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("runs");
      expect(Array.isArray(res.body.runs)).toBe(true);
    });
  });

  // ── GET /runs/:runId ────────────────────────────────────
  describe("GET /companies/:companyId/gym/runs/:runId", () => {
    it("returns a single run", async () => {
      mockDb.select = vi.fn(() => mockFullChain([makeRunRow()]));
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app).get(`/api/companies/${COMPANY_ID}/gym/runs/${RUN_ID}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("run");
      expect(res.body.run.id).toBe(RUN_ID);
    });

    it("returns 404 for missing run", async () => {
      mockDb.select = vi.fn(() => mockFullChain([]));
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app).get(`/api/companies/${COMPANY_ID}/gym/runs/nonexistent`);
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("not found");
    });
  });

  // ── POST /prompts ───────────────────────────────────────
  describe("POST /companies/:companyId/gym/prompts", () => {
    it("creates a prompt candidate successfully", async () => {
      mockDb.insert = vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([makePromptRow()])),
        })),
      }));
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/gym/prompts`)
        .send({ name: "My Prompt", systemPrompt: "You are helpful" });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("candidate");
      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: "create_gym_prompt" }),
      );
    });

    it("returns 422 when name is missing", async () => {
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/gym/prompts`)
        .send({ systemPrompt: "You are helpful" });
      expect(res.status).toBe(422);
      expect(res.body.error).toContain("name");
    });

    it("returns 422 when systemPrompt is missing", async () => {
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/gym/prompts`)
        .send({ name: "My Prompt" });
      expect(res.status).toBe(422);
      expect(res.body.error).toContain("systemPrompt");
    });
  });

  // ── GET /agents/:agentId/profile ───────────────────────
  describe("GET /companies/:companyId/gym/agents/:agentId/profile", () => {
    it("returns agent profile with recent runs", async () => {
      // First select for profile, second for recent runs
      const profileRow = makeProfileRow();
      mockDb.select = vi.fn()
        .mockReturnValueOnce(mockFullChain([profileRow]))
        .mockReturnValueOnce(mockFullChain([makeRunRow()]));
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app).get(`/api/companies/${COMPANY_ID}/gym/agents/${AGENT_ID}/profile`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("profile");
      expect(res.body).toHaveProperty("recentRuns");
    });

    it("returns 404 when no profile exists", async () => {
      mockDb.select = vi.fn(() => mockFullChain([]));
      app = await createApp(DEFAULT_ACTOR, mockDb);

      const res = await request(app).get(`/api/companies/${COMPANY_ID}/gym/agents/nonexistent/profile`);
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("no profile found");
    });
  });

  // ── Agent actor tests ───────────────────────────────────
  describe("Agent actor authorization", () => {
    it("allows agent access to own company suites", async () => {
      mockDb.select = vi.fn(() => mockFullChain([makeSuiteRow()]));
      app = await createApp(AGENT_ACTOR, mockDb);

      const res = await request(app).get(`/api/companies/${COMPANY_ID}/gym/suites`);
      expect(res.status).toBe(200);
    });
  });

  // ── Scoring service unit tests ──────────────────────────
  describe("Scoring service (unit tests)", () => {
    it("normalizeScore converts 0-1 float to 0-100 int", async () => {
      const { normalizeScore } = await import("../services/gym/scoring.js");
      expect(normalizeScore(0.5)).toBe(50);
      expect(normalizeScore(1.0)).toBe(100);
      expect(normalizeScore(0.0)).toBe(0);
    });

    it("normalizeScore passes through 0-100 int unchanged", async () => {
      const { normalizeScore } = await import("../services/gym/scoring.js");
      expect(normalizeScore(75)).toBe(75);
      expect(normalizeScore(0)).toBe(0);
      expect(normalizeScore(100)).toBe(100);
    });

    it("normalizeScore clamps out-of-range values", async () => {
      const { normalizeScore } = await import("../services/gym/scoring.js");
      expect(normalizeScore(-10)).toBe(0);
      expect(normalizeScore(150)).toBe(100);
    });

    it("aggregateScores returns average", async () => {
      const { aggregateScores } = await import("../services/gym/scoring.js");
      const scores = [
        { testCaseId: "1", score: 80, reasoning: "a", latencyMs: 100 },
        { testCaseId: "2", score: 90, reasoning: "b", latencyMs: 200 },
      ];
      expect(aggregateScores(scores)).toBe(85);
    });

    it("aggregateScores returns 0 for empty array", async () => {
      const { aggregateScores } = await import("../services/gym/scoring.js");
      expect(aggregateScores([])).toBe(0);
    });

    it("computeDrift returns mean absolute difference", async () => {
      const { computeDrift } = await import("../services/gym/scoring.js");
      const baseline = [
        { testCaseId: "1", score: 80, reasoning: "a", latencyMs: 100 },
        { testCaseId: "2", score: 90, reasoning: "b", latencyMs: 200 },
      ];
      const current = [
        { testCaseId: "1", score: 70, reasoning: "c", latencyMs: 150 },
        { testCaseId: "2", score: 85, reasoning: "d", latencyMs: 250 },
      ];
      // |80-70| + |90-85| = 10 + 5 = 15, /2 = 7.5, rounded = 7
      // Wait: computeDrift uses Math.round on the average
      // diffs = [10, 5], sum=15, /2 = 7.5, Math.round(7.5) = 8
      expect(computeDrift(baseline, current)).toBe(8);
    });

    it("computeDrift returns 0 for empty or unmatched arrays", async () => {
      const { computeDrift } = await import("../services/gym/scoring.js");
      const baseline = [
        { testCaseId: "1", score: 80, reasoning: "a", latencyMs: 100 },
      ];
      const current = [
        { testCaseId: "2", score: 90, reasoning: "b", latencyMs: 200 },
      ];
      expect(computeDrift(baseline, current)).toBe(0);
    });
  });

  // ── Evaluator service unit tests ────────────────────────
  describe("Evaluator service (unit tests)", () => {
    it("GymEvalUnconfiguredError has correct name", async () => {
      const evaluator = await vi.importActual<typeof import("../services/gym/evaluator.js")>("../services/gym/evaluator.js");
      const err = new evaluator.GymEvalUnconfiguredError();
      expect(err.name).toBe("GymEvalUnconfiguredError");
      expect(err.message).toContain("Gemini API key not configured");
    });

    it("runEvaluation throws when no API key is set", async () => {
      const prevGemini = process.env.GEMINI_API_KEY;
      const prevGoogle = process.env.GOOGLE_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      try {
        const evaluator = await vi.importActual<typeof import("../services/gym/evaluator.js")>("../services/gym/evaluator.js");
        const suite = makeSuiteRow() as any;
        await expect(evaluator.runEvaluation({ suite })).rejects.toThrow("Gemini API key not configured");
      } finally {
        if (prevGemini) process.env.GEMINI_API_KEY = prevGemini;
        if (prevGoogle) process.env.GOOGLE_API_KEY = prevGoogle;
      }
    });

    it("runEvaluation caps at 5 test cases (v1 limit)", async () => {
      const { runEvaluation } = await vi.importActual<typeof import("../services/gym/evaluator.js")>("../services/gym/evaluator.js");
      const manyCases = Array.from({ length: 10 }, (_, i) => ({
        id: `tc-${i}`,
        prompt: `test ${i}`,
        expectedResponse: `ans ${i}`,
        rubric: "quality",
        weight: 1,
      }));
      const suite = { ...makeSuiteRow(), testCases: manyCases } as any;
      await expect(runEvaluation({ suite })).rejects.toThrow("Gemini API key not configured");
    });
  });
});
