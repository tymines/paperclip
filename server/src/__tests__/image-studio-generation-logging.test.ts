import { describe, expect, it, vi } from "vitest";
import { logGenerationTickWarnings } from "../services/image-studio/generation-logging.js";

describe("Image Studio generation lifecycle logging", () => {
  it("logs only sanitized counters for enqueue outcomes", () => {
    const logger = { warn: vi.fn() };
    const result = {
      polled: 3,
      submitted: 1,
      succeeded: 0,
      failed: 2,
      pollDeferred: 1,
      quarantinedSubmissions: 1,
      quarantinedLandings: 1,
      skippedDuringShutdown: false,
      prompt: "private prompt",
      providerHandle: "private-handle",
      outputUrl: "https://private.example/output.png",
      secret: "private-token",
    };

    logGenerationTickWarnings(logger, result, "enqueue");

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [fields, message] = logger.warn.mock.calls[0];
    expect(fields).toEqual({
      source: "enqueue",
      failed: 2,
      pollDeferred: 1,
      quarantinedSubmissions: 1,
      quarantinedLandings: 1,
    });
    expect(message).toContain("failed, deferred, or quarantined");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toMatch(
      /private prompt|private-handle|private\.example|private-token/,
    );
  });

  it("stays silent when no warning counter advanced", () => {
    const logger = { warn: vi.fn() };
    logGenerationTickWarnings(
      logger,
      {
        polled: 1,
        submitted: 1,
        succeeded: 0,
        failed: 0,
        pollDeferred: 0,
        quarantinedSubmissions: 0,
        quarantinedLandings: 0,
        skippedDuringShutdown: false,
      },
      "scheduled",
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
