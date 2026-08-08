import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { errorHandler } from "../middleware/error-handler.js";
import { requireImageStudioAuthentication } from "../services/image-studio/route-auth.js";

function appFor(actor: Express.Request["actor"]) {
  const app = express();
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use(requireImageStudioAuthentication);
  app.get("/image-studio/probe", (_req, res) => {
    res.json({ reached: true });
  });
  app.use(errorHandler);
  return app;
}

describe("legacy Image Studio route authentication", () => {
  it("denies an unauthenticated request before the route handler", async () => {
    const response = await request(appFor({ type: "none", source: "none" }))
      .get("/image-studio/probe")
      .expect(401);

    expect(response.body).toEqual({ error: "Unauthorized" });
  });

  it("allows an authenticated request to reach the route handler", async () => {
    const response = await request(
      appFor({ type: "board", source: "local_implicit", userId: "board-1" }),
    )
      .get("/image-studio/probe")
      .expect(200);

    expect(response.body).toEqual({ reached: true });
  });
});
