import { describe, expect, it } from "vitest";
import {
  evaluateNsfwGuard,
  metadataContentRating,
  isPlatformSfwOnly,
} from "./nsfw-guard.js";
import { personaTrainingProfile } from "./training.js";

describe("nsfw-guard", () => {
  it("flags instagram and tiktok as SFW-only", () => {
    expect(isPlatformSfwOnly("instagram")).toBe(true);
    expect(isPlatformSfwOnly("tiktok")).toBe(true);
    expect(isPlatformSfwOnly("reddit")).toBe(false);
    expect(isPlatformSfwOnly("x")).toBe(false);
  });

  it("reads explicit rating from metadata signals", () => {
    expect(metadataContentRating({ contentRating: "explicit" })).toBe("explicit");
    expect(metadataContentRating({ content_rating: "explicit" })).toBe("explicit");
    expect(metadataContentRating({ nsfw: true })).toBe("explicit");
    expect(metadataContentRating({ triggerWord: "sidney_nsfw" })).toBe("explicit");
    expect(metadataContentRating({ trigger_word: "sidney_sfw" })).toBeNull();
    expect(metadataContentRating({})).toBeNull();
    expect(metadataContentRating(null)).toBeNull();
  });

  it("hard-rejects explicit content on SFW-only platforms", () => {
    const v = evaluateNsfwGuard("instagram", { contentRating: "explicit" });
    expect(v.blocked).toBe(true);
    expect(v.reason).toContain("instagram");

    expect(evaluateNsfwGuard("tiktok", { triggerWord: "sidney_nsfw" }).blocked).toBe(true);
  });

  it("fails open for untagged posts (existing behaviour unchanged)", () => {
    expect(evaluateNsfwGuard("instagram", undefined).blocked).toBe(false);
    expect(evaluateNsfwGuard("instagram", { caption: "hi" }).blocked).toBe(false);
    expect(evaluateNsfwGuard("instagram", { contentRating: "sfw" }).blocked).toBe(false);
  });

  it("allows explicit content on non-SFW-only platforms", () => {
    expect(evaluateNsfwGuard("x", { contentRating: "explicit" }).blocked).toBe(false);
    expect(evaluateNsfwGuard("reddit", { nsfw: true }).blocked).toBe(false);
  });
});

describe("personaTrainingProfile — NSFW tagging source", () => {
  it("tags the Sidney NSFW persona explicit with the nsfw trigger word", () => {
    const p = personaTrainingProfile("Sidney NSFW");
    expect(p.contentRating).toBe("explicit");
    expect(p.triggerWord).toBe("sidney_nsfw");
    expect(p.defaultPhotosDir).toMatch(/sidney-training-photos-nsfw$/);
  });

  it("tags the Sidney SFW persona sfw", () => {
    const p = personaTrainingProfile("Sidney SFW");
    expect(p.contentRating).toBe("sfw");
    expect(p.triggerWord).toBe("sidney_sfw");
    expect(p.defaultPhotosDir).toMatch(/sidney-training-photos$/);
  });
});
