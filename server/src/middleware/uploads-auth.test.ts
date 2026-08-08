import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { errorHandler } from "./error-handler.js";
import { uploadsAuthenticationGuard } from "./uploads-auth.js";

function appFor(actor: Express.Request["actor"]) {
  const app = express();
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.get("/api/uploads/example.png", uploadsAuthenticationGuard(), (_req, res) => {
    res.status(200).send("media");
  });
  app.use(errorHandler);
  return app;
}

describe("uploadsAuthenticationGuard", () => {
  it("rejects unauthenticated upload reads", async () => {
    const response = await request(appFor({ type: "none", source: "none" })).get(
      "/api/uploads/example.png",
    );

    expect(response.status).toBe(401);
  });

  it("allows an authenticated board session", async () => {
    const response = await request(
      appFor({
        type: "board",
        source: "local_implicit",
        userId: "board-user",
        companyIds: [],
      }),
    ).get("/api/uploads/example.png");

    expect(response.status).toBe(200);
    expect(response.text).toBe("media");
  });
});
