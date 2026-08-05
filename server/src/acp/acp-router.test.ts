import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("http");
vi.unmock("node:http");

const mockAgentService = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("../services/agents.js", () => ({
  agentService: () => mockAgentService,
}));

async function createApp(
  actor: Record<string, unknown>,
  listAgents?: (companyId: string) => Promise<any[]>,
  getCompany: (companyId: string) => Promise<{ issuePrefix: string } | null> = async () => ({ issuePrefix: "AUG" }),
) {
  vi.resetModules();
  const [{ errorHandler }, { createAcpRouter }] = await Promise.all([
    import("../middleware/index.js") as Promise<typeof import("../middleware/index.js")>,
    import("./acp-router.js") as Promise<typeof import("./acp-router.js")>,
  ]);
  const app = express();
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", createAcpRouter({} as any, { listAgents, getCompany }));
  app.use(errorHandler);
  return app;
}

async function requestApp(app: express.Express, path: string) {
  const { createServer } = await vi.importActual<typeof import("node:http")>("node:http");
  const server = createServer(app);
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP test server");
    return await request(`http://127.0.0.1:${address.port}`).get(path);
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
}

describe.sequential("ACP Fleet route", () => {
  beforeEach(() => mockAgentService.list.mockReset());

  it("requires companyId before returning a roster", async () => {
    const app = await createApp({ type: "none", source: "none" });
    const response = await requestApp(app, "/api/acp/fleet");

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ ok: false, error: "companyId is required", stage: "validation" });
    expect(mockAgentService.list).not.toHaveBeenCalled();
  });

  it("denies board access to another company's roster before reading agents", async () => {
    const app = await createApp({
      type: "board",
      userId: "user-1",
      companyIds: ["company-1"],
      source: "session",
      isInstanceAdmin: false,
    });
    const response = await requestApp(app, "/api/acp/fleet?companyId=company-2");

    expect(response.status).toBe(403);
    expect(mockAgentService.list).not.toHaveBeenCalled();
  });

  it("denies an unauthenticated company roster read", async () => {
    const app = await createApp({ type: "none", source: "none" });
    const response = await requestApp(app, "/api/acp/fleet?companyId=company-1");

    expect(response.status).toBe(401);
    expect(mockAgentService.list).not.toHaveBeenCalled();
  });

  it("reconciles an authorized paused row", async () => {
    mockAgentService.list.mockResolvedValue([
      { id: "db-athena", name: "Athena", role: "engineer", title: "Athena", status: "paused" },
    ]);
    const app = await createApp({
      type: "board",
      userId: "user-1",
      companyIds: ["company-1"],
      source: "session",
      isInstanceAdmin: false,
    });
    const response = await requestApp(app, "/api/acp/fleet?companyId=company-1");

    expect(response.status).toBe(200);
    expect(mockAgentService.list).toHaveBeenCalledWith("company-1");
    expect(response.body.agents.find((agent: { name: string }) => agent.name === "Athena")).toMatchObject({
      id: "db-athena",
      registered: true,
      status: "paused",
    });
  });

  it("reconciles canonical definitions only for the AUG company prefix", async () => {
    mockAgentService.list.mockResolvedValue([
      { id: "db-athena", name: "Athena", role: "engineer", title: "Athena", status: "paused" },
    ]);
    const app = await createApp({
      type: "board", userId: "user-1", companyIds: ["company-1"], source: "session", isInstanceAdmin: false,
    }, undefined, async () => ({ issuePrefix: "aug" }));
    const response = await requestApp(app, "/api/acp/fleet?companyId=company-1");

    expect(response.status).toBe(200);
    expect(response.body.agents).toHaveLength(16);
    expect(response.body.agents.find((agent: { name: string }) => agent.name === "Athena")).toMatchObject({ id: "db-athena" });
  });

  it("returns only registered company agents for authorized non-AUG companies", async () => {
    mockAgentService.list.mockResolvedValue([
      { id: "db-other", name: "Other Agent", role: "worker", title: "Local agent", status: "active" },
    ]);
    const app = await createApp({
      type: "board", userId: "user-1", companyIds: ["company-1"], source: "session", isInstanceAdmin: false,
    }, undefined, async () => ({ issuePrefix: "OTHER" }));
    const response = await requestApp(app, "/api/acp/fleet?companyId=company-1");

    expect(response.status).toBe(200);
    expect(response.body.agents).toEqual([expect.objectContaining({ id: "db-other", name: "Other Agent", registered: true })]);
    expect(response.body.agents.some((agent: { name: string }) => agent.name === "Zeus")).toBe(false);
  });

  it("propagates roster read failures instead of marking definitions unregistered", async () => {
    const app = await createApp({
      type: "board",
      userId: "user-1",
      companyIds: ["company-1"],
      source: "session",
      isInstanceAdmin: false,
    }, async () => {
      throw new Error("roster unavailable");
    });
    const response = await requestApp(app, "/api/acp/fleet?companyId=company-1");

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ ok: false, error: "Fleet roster unavailable", stage: "roster" });
    expect(response.body.agents).toBeUndefined();
  });
});
