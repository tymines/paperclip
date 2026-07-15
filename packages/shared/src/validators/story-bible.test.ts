import { describe, expect, it } from "vitest";
import {
  createStoryBibleStyleSchema,
  updateStoryBibleStyleSchema,
} from "./story-bible.js";

describe("story bible style tropes", () => {
  it("preserves tropes when creating a style entry", () => {
    const tropes = ["Enemies to Lovers", "Found Family"];

    const parsed = createStoryBibleStyleSchema.parse({ tropes });

    expect(parsed.tropes).toEqual(tropes);
  });

  it("preserves tropes when updating a style entry", () => {
    const tropes = ["Redemption Arc"];

    const parsed = updateStoryBibleStyleSchema.parse({ tropes });

    expect(parsed.tropes).toEqual(tropes);
  });
});
