import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";

describe("Image Studio generation worker configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("enables generation polling independently while heartbeats remain disabled", () => {
    vi.stubEnv("HEARTBEAT_SCHEDULER_ENABLED", "false");
    vi.stubEnv("IMAGE_STUDIO_GENERATION_WORKER_ENABLED", "true");
    vi.stubEnv("IMAGE_STUDIO_GENERATION_WORKER_INTERVAL_MS", "15000");

    const config = loadConfig();
    expect(config.heartbeatSchedulerEnabled).toBe(false);
    expect(config.imageStudioGenerationWorkerEnabled).toBe(true);
    expect(config.imageStudioGenerationWorkerIntervalMs).toBe(15000);
  });

  it("keeps the dedicated worker opt-in", () => {
    vi.stubEnv("HEARTBEAT_SCHEDULER_ENABLED", "true");
    vi.stubEnv("IMAGE_STUDIO_GENERATION_WORKER_ENABLED", "false");

    const config = loadConfig();
    expect(config.heartbeatSchedulerEnabled).toBe(true);
    expect(config.imageStudioGenerationWorkerEnabled).toBe(false);
  });
});
