import { describe, expect, it } from "vitest";
import {
  CONTENT_GENERATOR_UNAVAILABLE_MESSAGE,
  ContentGeneratorUnavailableError,
  contentGeneratorCapability,
  contentGeneratorUnavailablePayload,
  generateContentIdeas,
} from "./content-generator.js";

describe("generateContentIdeas", () => {
  it("stays disabled without invoking any provider", async () => {
    await expect(
      generateContentIdeas({ name: "Persona", bio: null, attributes: {} }, "topic", 1),
    ).rejects.toMatchObject({
      name: "ContentGeneratorUnavailableError",
      code: "content_generator_unavailable",
      retryable: false,
    } satisfies Partial<ContentGeneratorUnavailableError>);
  });

  it("reports the precise missing non-Gemini capability", () => {
    expect(contentGeneratorCapability()).toEqual({
      enabled: false,
      code: "content_generator_unavailable",
      reason: CONTENT_GENERATOR_UNAVAILABLE_MESSAGE,
    });
  });

  it("returns a stable retryable payload for an upstream failure", () => {
    expect(contentGeneratorUnavailablePayload(new Error("private provider detail"))).toEqual({
      error: CONTENT_GENERATOR_UNAVAILABLE_MESSAGE,
      code: "content_generator_unavailable",
      retryable: true,
    });
  });

  it("returns a stable non-retryable payload for missing configuration", () => {
    expect(contentGeneratorUnavailablePayload(new ContentGeneratorUnavailableError(false)))
      .toEqual({
        error: CONTENT_GENERATOR_UNAVAILABLE_MESSAGE,
        code: "content_generator_unavailable",
        retryable: false,
      });
  });
});
