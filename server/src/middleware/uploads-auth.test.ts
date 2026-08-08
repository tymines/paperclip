import express from "express";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { errorHandler } from "./error-handler.js";
import { uploadsAuthenticationGuard } from "./uploads-auth.js";

async function appFor(actor: Express.Request["actor"]) {
  const uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-uploads-auth-"));
  await fs.writeFile(path.join(uploadsDir, "example.png"), Buffer.from("media"));
  const app = express();
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use(
    "/api/uploads",
    uploadsAuthenticationGuard(),
    express.static(uploadsDir, { cacheControl: false, fallthrough: false }),
  );
  app.use(errorHandler);
  return { app, uploadsDir };
}

describe("uploadsAuthenticationGuard", () => {
  it("rejects unauthenticated upload reads", async () => {
    const { app, uploadsDir } = await appFor({ type: "none", source: "none" });
    const response = await request(app).get("/api/uploads/example.png");

    expect(response.status).toBe(401);
    await fs.rm(uploadsDir, { recursive: true, force: true });
  });

  it("serves authenticated media only through a private browser cache", async () => {
    const { app, uploadsDir } = await appFor({
        type: "board",
        source: "local_implicit",
        userId: "board-user",
        companyIds: [],
      });
    const response = await request(app).get("/api/uploads/example.png");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(Buffer.from("media"));
    expect(response.headers["cache-control"]).toBe("private, max-age=3600");
    await fs.rm(uploadsDir, { recursive: true, force: true });
  });
});
