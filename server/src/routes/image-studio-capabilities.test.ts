import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { ImageProvider } from "../services/image-providers/types.js";
import { imageStudioCapabilitiesRouter } from "../services/image-studio/capabilities-router.js";

function provider(): ImageProvider {
  return {
    id: "replicate",
    name: "Replicate",
    color: "#ec4899",
    tokenKey: "replicate",
    isConfigured: vi.fn(async () => true),
    verify: vi.fn(async () => ({ ok: true, detail: "must stay server-only" })),
    listModels: vi.fn(async () => [
      {
        id: "persona-lora",
        name: "Persona LoRA",
        kind: "image" as const,
        costPerUnit: 0.04,
        costUnit: "image" as const,
        lora: true,
        nsfw: true,
      },
    ]),
    defaultModel: vi.fn(() => "persona-lora"),
    submitGeneration: vi.fn(async () => ({ predictionId: "unused" })),
    pollPrediction: vi.fn(async () => ({
      id: "unused",
      status: "starting",
      outputUrl: null,
    })),
    downloadOutput: vi.fn(async () => Buffer.from([])),
  };
}

function appFor(companyIds: string[]) {
  const app = express();
  app.use((req, _res, next) => {
    req.actor = {
      type: "board",
      source: "session",
      userId: "user-1",
      companyIds,
      isInstanceAdmin: false,
    };
    next();
  });
  app.use(
    "/api",
    imageStudioCapabilitiesRouter([provider()]),
  );
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status =
      typeof error === "object" && error && "status" in error
        ? Number((error as { status: number }).status)
        : 500;
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(status).json({ error: message });
  });
  return app;
}

describe("GET company Image Studio capabilities", () => {
  it("returns normalized capability truth from injected fake providers", async () => {
    const response = await request(appFor(["company-1"]))
      .get("/api/companies/company-1/image-studio/capabilities")
      .expect(200);

    expect(response.body.capabilities).toEqual([
      expect.objectContaining({
        id: "general",
        enabled: true,
        identityMethod: "trained_persona_identity",
        readiness: "credential_verified",
      }),
    ]);
    expect(response.body.providers).toEqual([
      expect.objectContaining({
        configured: true,
        credentialVerified: true,
        catalogAvailable: true,
      }),
    ]);
    expect(JSON.stringify(response.body)).not.toContain("must stay server-only");
  });

  it("rejects a board session without company access", async () => {
    const response = await request(appFor(["company-2"]))
      .get("/api/companies/company-1/image-studio/capabilities")
      .expect(403);

    expect(response.body.error).toBe("User does not have access to this company");
  });
});
