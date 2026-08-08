import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ContentGeneratorUnavailableError,
  contentGeneratorUnavailablePayload,
  generateContentIdeas,
} from "./content-generator.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("generateContentIdeas", () => {
  it("classifies missing configuration without invoking a provider", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");

    await expect(
      generateContentIdeas({ name: "Persona", bio: null, attributes: {} }, "topic", 1),
    ).rejects.toMatchObject({
      name: "ContentGeneratorUnavailableError",
      code: "content_generator_unavailable",
      retryable: false,
    } satisfies Partial<ContentGeneratorUnavailableError>);
  });

  it("returns a stable retryable payload for an upstream failure", () => {
    expect(contentGeneratorUnavailablePayload(new Error("private provider detail"))).toEqual({
      error: "Content idea generation is unavailable.",
      code: "content_generator_unavailable",
      retryable: true,
    });
  });

  it("returns a stable non-retryable payload for missing configuration", () => {
    expect(contentGeneratorUnavailablePayload(new ContentGeneratorUnavailableError(false)))
      .toEqual({
        error: "Content idea generation is unavailable.",
        code: "content_generator_unavailable",
        retryable: false,
      });
  });
});
