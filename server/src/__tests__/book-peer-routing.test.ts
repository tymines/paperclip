import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import express from "express";
import request from "supertest";
import {
  __resetRateLimits,
  __resetReachabilityCache,
  checkPeerReachable,
  dispatchDelegation,
  getPeerEndpoint,
  PeerUnconfiguredError,
} from "../services/jarvis-delegation.js";
import { jarvisRoutes } from "../routes/jarvis.js";

const KEYS = [
  "JARVIS_PEER_CALLIOPE_URL",
  "JARVIS_PEER_CALLIOPE_TOKEN",
  "JARVIS_PEER_HADES_URL",
  "JARVIS_PEER_HADES_TOKEN",
] as const;

const original = new Map<string, string | undefined>();

describe("Book Studio named Hermes Harness peer routing", () => {
  beforeEach(() => {
    for (const key of KEYS) {
      original.set(key, process.env[key]);
      delete process.env[key];
    }
    __resetRateLimits();
    __resetReachabilityCache();
  });

  afterEach(() => {
    for (const key of KEYS) {
      const value = original.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    original.clear();
    vi.restoreAllMocks();
  });

  it.each(["calliope", "hades"] as const)(
    "%s fails closed instead of inheriting the shared/default route",
    (peer) => {
      expect(() => getPeerEndpoint(peer)).toThrowError(PeerUnconfiguredError);
      try {
        getPeerEndpoint(peer);
      } catch (error) {
        expect(error).toMatchObject({ code: "peer_unconfigured", peer });
      }
    },
  );

  it("accepts an explicitly configured Hades endpoint and preserves identity", () => {
    process.env.JARVIS_PEER_HADES_URL = "http://127.0.0.1:29991";
    process.env.JARVIS_PEER_HADES_TOKEN = "test-token";
    expect(getPeerEndpoint("hades")).toEqual({
      url: "http://127.0.0.1:29991",
      token: "test-token",
      identityId: "hades",
    });
  });

  it("reports peer_unconfigured without issuing a network probe", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(checkPeerReachable("calliope")).resolves.toEqual({
      reachable: false,
      error: "peer_unconfigured",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allows the Hades production-diagnostic reachability route", async () => {
    process.env.JARVIS_PEER_HADES_URL = "http://127.0.0.1:29992";
    process.env.JARVIS_PEER_HADES_TOKEN = "test-token";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));

    const app = express();
    app.use((req, _res, next) => {
      (req as unknown as { actor: unknown }).actor = {
        type: "board",
        userId: "test-user",
        isInstanceAdmin: true,
        source: "local_implicit",
        memberships: [],
      };
      next();
    });
    app.use("/api", jarvisRoutes({} as Db));

    const res = await request(app)
      .get("/api/companies/co-1/jarvis/delegations/peers/hades/reachable")
      .expect(200);
    expect(res.body).toEqual({ reachable: true });
  });

  it("refuses dispatch before touching persistence when Hades is unconfigured", async () => {
    const db = { insert: vi.fn() } as unknown as Db;
    await expect(
      dispatchDelegation(db, {
        companyId: "co-1",
        agent: "hades",
        task: "Review chapter 2",
        requestedByActorId: "test-user",
      }),
    ).resolves.toMatchObject({
      id: "",
      status: "failed",
      reachable: false,
      error: "peer_unconfigured",
    });
    expect((db as unknown as { insert: ReturnType<typeof vi.fn> }).insert).not.toHaveBeenCalled();
  });
});
