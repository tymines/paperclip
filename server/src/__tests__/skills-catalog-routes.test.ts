/**
 * Smoke tests for the v2 Skills catalog API surface — covers the four new
 * endpoints (`PATCH /enabled`, `GET /agents`, `PATCH /agents/:id`,
 * `POST /invoke`, `POST /install-manifest`) plus their permission gates.
 *
 * Mocks the company-skills service so we exercise the wiring (validation,
 * authz, response shape) without booting the full stack.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  hasPermission: vi.fn(),
}));

const mockCompanySkillService = vi.hoisted(() => ({
  setEnabled: vi.fn(),
  listAgentGrants: vi.fn(),
  setAgentGrant: vi.fn(),
  invokePreview: vi.fn(),
  installFromManifest: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

function registerModuleMocks() {
  vi.doMock("../routes/authz.js", async () => vi.importActual("../routes/authz.js"));

  vi.doMock("@paperclipai/shared/telemetry", () => ({
    trackSkillImported: vi.fn(),
    trackErrorHandlerCrash: vi.fn(),
  }));

  vi.doMock("../telemetry.js", () => ({
    getTelemetryClient: () => ({ track: vi.fn() }),
  }));

  vi.doMock("../services/access.js", () => ({
    accessService: () => mockAccessService,
  }));

  vi.doMock("../services/activity-log.js", () => ({
    logActivity: mockLogActivity,
  }));

  vi.doMock("../services/agents.js", () => ({
    agentService: () => mockAgentService,
  }));

  vi.doMock("../services/company-skills.js", () => ({
    companySkillService: () => mockCompanySkillService,
  }));

  vi.doMock("../services/index.js", () => ({
    accessService: () => mockAccessService,
    agentService: () => mockAgentService,
    companySkillService: () => mockCompanySkillService,
    logActivity: mockLogActivity,
  }));
}

async function createApp(actor: Record<string, unknown>) {
  const [{ companySkillRoutes }, { errorHandler }] = await Promise.all([
    vi.importActual<typeof import("../routes/company-skills.js")>("../routes/company-skills.js"),
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", companySkillRoutes({} as any));
  app.use(errorHandler);
  return app;
}

const localBoardActor = {
  type: "board" as const,
  userId: "local-board",
  companyIds: ["company-1"],
  source: "local_implicit" as const,
  isInstanceAdmin: true,
};

describe("skills catalog routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@paperclipai/shared/telemetry");
    vi.doUnmock("../telemetry.js");
    vi.doUnmock("../services/access.js");
    vi.doUnmock("../services/activity-log.js");
    vi.doUnmock("../services/agents.js");
    vi.doUnmock("../services/company-skills.js");
    vi.doUnmock("../services/index.js");
    vi.doUnmock("../routes/company-skills.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    registerModuleMocks();
    vi.clearAllMocks();
    mockAccessService.canUser.mockResolvedValue(true);
    mockAccessService.hasPermission.mockResolvedValue(true);
    mockLogActivity.mockResolvedValue(undefined);
  });

  describe("PATCH /skills/:id/enabled", () => {
    it("toggles enabled state and logs activity", async () => {
      mockCompanySkillService.setEnabled.mockResolvedValue({
        id: "skill-1",
        slug: "translate",
        name: "Translate",
        enabled: false,
      });
      const app = await createApp(localBoardActor);
      const res = await request(app)
        .patch("/api/companies/company-1/skills/skill-1/enabled")
        .send({ enabled: false });

      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
      expect(mockCompanySkillService.setEnabled).toHaveBeenCalledWith("company-1", "skill-1", false);
      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: "company.skill_disabled" }),
      );
    });

    it("returns 404 when the skill is missing", async () => {
      mockCompanySkillService.setEnabled.mockResolvedValue(null);
      const app = await createApp(localBoardActor);
      const res = await request(app)
        .patch("/api/companies/company-1/skills/missing/enabled")
        .send({ enabled: true });
      expect(res.status).toBe(404);
    });

    it("rejects payloads missing the enabled flag", async () => {
      const app = await createApp(localBoardActor);
      const res = await request(app)
        .patch("/api/companies/company-1/skills/skill-1/enabled")
        .send({});
      expect(res.status).toBe(400);
      expect(mockCompanySkillService.setEnabled).not.toHaveBeenCalled();
    });
  });

  describe("GET /skills/:id/agents", () => {
    it("returns the grants list", async () => {
      mockCompanySkillService.listAgentGrants.mockResolvedValue({
        skill: { id: "skill-1", key: "translate" },
        grants: [
          { agentId: "agent-a", agentName: "A", agentUrlKey: "a", adapterType: "claude", granted: true },
          { agentId: "agent-b", agentName: "B", agentUrlKey: "b", adapterType: "claude", granted: false },
        ],
      });
      const app = await createApp(localBoardActor);
      const res = await request(app).get("/api/companies/company-1/skills/skill-1/agents");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        skillId: "skill-1",
        skillKey: "translate",
        grants: expect.arrayContaining([
          expect.objectContaining({ agentId: "agent-a", granted: true }),
          expect.objectContaining({ agentId: "agent-b", granted: false }),
        ]),
      });
    });
  });

  describe("PATCH /skills/:id/agents/:agentId", () => {
    it("flips a grant on", async () => {
      mockCompanySkillService.setAgentGrant.mockResolvedValue({
        agentId: "agent-a",
        agentName: "A",
        agentUrlKey: "a",
        adapterType: "claude",
        granted: true,
      });
      const app = await createApp(localBoardActor);
      const res = await request(app)
        .patch("/api/companies/company-1/skills/skill-1/agents/agent-a")
        .send({ granted: true });
      expect(res.status).toBe(200);
      expect(res.body.granted).toBe(true);
      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: "company.skill_granted" }),
      );
    });

    it("returns 404 when the agent is unknown to this company", async () => {
      mockCompanySkillService.setAgentGrant.mockResolvedValue(null);
      const app = await createApp(localBoardActor);
      const res = await request(app)
        .patch("/api/companies/company-1/skills/skill-1/agents/missing")
        .send({ granted: false });
      expect(res.status).toBe(404);
    });
  });

  describe("POST /skills/:id/invoke", () => {
    it("echoes input and returns preview metadata", async () => {
      mockCompanySkillService.invokePreview.mockResolvedValue({
        status: "ok",
        startedAt: new Date(),
        finishedAt: new Date(),
        latencyMs: 4,
        echo: { prompt: "hi" },
        preview: "Hello world.",
        warnings: [],
      });
      const app = await createApp(localBoardActor);
      const res = await request(app)
        .post("/api/companies/company-1/skills/skill-1/invoke")
        .send({ input: { prompt: "hi" } });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.echo).toEqual({ prompt: "hi" });
    });
  });

  describe("POST /skills/install-manifest", () => {
    it("creates a skill from an inline manifest", async () => {
      mockCompanySkillService.installFromManifest.mockResolvedValue({
        id: "skill-99",
        slug: "translate",
        name: "Translate",
      });
      const app = await createApp(localBoardActor);
      const res = await request(app)
        .post("/api/companies/company-1/skills/install-manifest")
        .send({ manifest: { name: "Translate", description: "Translate text" } });
      expect(res.status).toBe(201);
      expect(res.body.id).toBe("skill-99");
      expect(mockCompanySkillService.installFromManifest).toHaveBeenCalledWith(
        "company-1",
        expect.objectContaining({ manifest: expect.objectContaining({ name: "Translate" }) }),
      );
    });

    it("rejects payloads with neither url nor manifest", async () => {
      const app = await createApp(localBoardActor);
      const res = await request(app)
        .post("/api/companies/company-1/skills/install-manifest")
        .send({});
      expect(res.status).toBe(400);
      expect(mockCompanySkillService.installFromManifest).not.toHaveBeenCalled();
    });
  });
});
