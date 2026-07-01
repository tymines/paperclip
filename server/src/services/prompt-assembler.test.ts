import { describe, expect, it } from "vitest";
import {
  assemblePrompt,
  detectFreeTextConflicts,
  resolveControlValue,
  QUALITY_BOILERPLATE,
  type AssemblyCatalog,
  type PersonaForAssembly,
} from "./prompt-assembler.js";

// A trimmed catalog mirroring the 0116 seed: one control per relevant category,
// in deliberately-scrambled input order to prove the assembler re-sorts.
const CATALOG: AssemblyCatalog = {
  controls: [
    { key: "lighting", category: "lighting", promptTemplate: "{value}", sortOrder: 60 },
    { key: "hairstyle", category: "face", promptTemplate: "{value}", sortOrder: 20 },
    { key: "body_type", category: "body", promptTemplate: "{value}", sortOrder: 10 },
    { key: "pose", category: "pose", promptTemplate: "{value}", sortOrder: 30 },
    { key: "outfit", category: "wardrobe", promptTemplate: "{value}", sortOrder: 40 },
    { key: "scene", category: "scene", promptTemplate: "{value}", sortOrder: 50 },
  ],
  options: [
    { controlKey: "hairstyle", value: "wavy_long", label: "Long Wavy", promptFragment: "long wavy hair flowing past her shoulders" },
    { controlKey: "hairstyle", value: "bun", label: "Bun", promptFragment: "hair tied up in a casual messy bun" },
    { controlKey: "hairstyle", value: "ponytail", label: "Ponytail", promptFragment: "hair pulled back in a high ponytail" },
    { controlKey: "body_type", value: "athletic", label: "Athletic", promptFragment: "fit athletic build with visible tone" },
    { controlKey: "body_type", value: "curvy", label: "Curvy", promptFragment: "curvy hourglass figure" },
    { controlKey: "pose", value: "mirror_selfie", label: "Mirror Selfie", promptFragment: "taking a mirror selfie with her phone" },
    { controlKey: "outfit", value: "cozy_sweater", label: "Cozy Sweater", promptFragment: "oversized cozy knit sweater" },
    { controlKey: "outfit", value: "lingerie", label: "Lingerie", promptFragment: "satin lingerie set", contentRating: "explicit" },
    { controlKey: "scene", value: "bedroom", label: "Bedroom", promptFragment: "in a sunlit bedroom" },
    { controlKey: "lighting", value: "window_light", label: "Window Light", promptFragment: "window light streaming in" },
  ],
};

const SIDNEY: PersonaForAssembly = {
  bio: "Sidney is a 22-year-old   lifestyle model.",
  attributes: {
    trigger_word: "sidney_sfw",
    body_type: "athletic",
    default_hairstyle: "wavy_long",
    eye_color: "blue",
  },
};

describe("assemblePrompt", () => {
  it("leads with the trigger word, then bio", () => {
    const out = assemblePrompt(SIDNEY, {}, "", CATALOG);
    expect(out.startsWith("sidney_sfw, Sidney is a 22-year-old lifestyle model.")).toBe(true);
    // bio whitespace collapsed
    expect(out).not.toContain("year-old   lifestyle");
  });

  it("pre-fills from persona defaults when nothing is selected", () => {
    const out = assemblePrompt(SIDNEY, {}, "", CATALOG);
    // body_type (athletic) and default_hairstyle (wavy_long) both resolve
    expect(out).toContain("fit athletic build with visible tone");
    expect(out).toContain("long wavy hair flowing past her shoulders");
  });

  it("emits structured fragments in stable category order (body → face → pose → wardrobe → scene → lighting)", () => {
    const out = assemblePrompt(
      SIDNEY,
      { pose: "mirror_selfie", outfit: "cozy_sweater", scene: "bedroom", lighting: "window_light" },
      "",
      CATALOG,
    );
    const order = [
      "fit athletic build with visible tone", // body
      "long wavy hair flowing past her shoulders", // face
      "taking a mirror selfie with her phone", // pose
      "oversized cozy knit sweater", // wardrobe
      "in a sunlit bedroom", // scene
      "window light streaming in", // lighting
    ];
    let last = -1;
    for (const frag of order) {
      const idx = out.indexOf(frag);
      expect(idx, `${frag} present`).toBeGreaterThan(-1);
      expect(idx, `${frag} after previous`).toBeGreaterThan(last);
      last = idx;
    }
  });

  it("matches the documented Sidney example", () => {
    const out = assemblePrompt(
      SIDNEY,
      { pose: "mirror_selfie", outfit: "cozy_sweater", scene: "bedroom", lighting: "window_light" },
      "",
      CATALOG,
    );
    expect(out).toBe(
      "sidney_sfw, Sidney is a 22-year-old lifestyle model., " +
        "fit athletic build with visible tone, long wavy hair flowing past her shoulders, " +
        "taking a mirror selfie with her phone, oversized cozy knit sweater, " +
        "in a sunlit bedroom, window light streaming in, photorealistic, high quality",
    );
  });

  it("lets an explicit selection override the persona default", () => {
    const out = assemblePrompt(SIDNEY, { hairstyle: "bun" }, "", CATALOG);
    expect(out).toContain("hair tied up in a casual messy bun");
    expect(out).not.toContain("long wavy hair flowing past her shoulders");
  });

  it("always closes with the quality boilerplate", () => {
    const out = assemblePrompt(SIDNEY, {}, "", CATALOG);
    expect(out.endsWith(QUALITY_BOILERPLATE)).toBe(true);
  });

  it("handles a missing persona (no trigger, no bio, no defaults)", () => {
    const out = assemblePrompt(null, { pose: "mirror_selfie" }, "", CATALOG);
    expect(out).toBe("taking a mirror selfie with her phone, photorealistic, high quality");
  });

  it("handles no selections and no persona (just boilerplate)", () => {
    expect(assemblePrompt(null, {}, "", CATALOG)).toBe(QUALITY_BOILERPLATE);
    expect(assemblePrompt(undefined, undefined, undefined, CATALOG)).toBe(QUALITY_BOILERPLATE);
  });

  it("handles free-text only", () => {
    const out = assemblePrompt(null, {}, "in a Berlin nightclub", CATALOG);
    expect(out).toBe("in a Berlin nightclub, photorealistic, high quality");
  });

  it("appends free-text after structured fragments and trims it", () => {
    const out = assemblePrompt(SIDNEY, { pose: "mirror_selfie" }, "   neon reflections  ", CATALOG);
    const poseIdx = out.indexOf("taking a mirror selfie");
    const freeIdx = out.indexOf("neon reflections");
    expect(freeIdx).toBeGreaterThan(poseIdx);
    expect(out).toContain(", neon reflections, photorealistic, high quality");
  });

  it("skips selections that reference an unknown option value", () => {
    const out = assemblePrompt(SIDNEY, { pose: "doing_a_backflip" }, "", CATALOG);
    expect(out).not.toContain("backflip");
    // still a valid prompt with defaults + boilerplate
    expect(out.endsWith(QUALITY_BOILERPLATE)).toBe(true);
  });

  it("supports explicit-rated options when selected", () => {
    const out = assemblePrompt(
      { attributes: { trigger_word: "sidney_nsfw" } },
      { outfit: "lingerie" },
      "",
      CATALOG,
    );
    expect(out).toBe("sidney_nsfw, satin lingerie set, photorealistic, high quality");
  });

  it("honors a non-trivial prompt_template wrapper", () => {
    const catalog: AssemblyCatalog = {
      controls: [{ key: "hairstyle", category: "face", promptTemplate: "with {value}", sortOrder: 1 }],
      options: [{ controlKey: "hairstyle", value: "bun", label: "Bun", promptFragment: "a messy bun" }],
    };
    expect(assemblePrompt(null, { hairstyle: "bun" }, "", catalog)).toBe(
      "with a messy bun, photorealistic, high quality",
    );
  });
});

describe("resolveControlValue", () => {
  it("prefers an explicit selection over a persona default", () => {
    expect(resolveControlValue("hairstyle", { hairstyle: "bun" }, SIDNEY)).toBe("bun");
  });
  it("falls back to attributes[key] then default_<key>", () => {
    expect(resolveControlValue("body_type", {}, SIDNEY)).toBe("athletic");
    expect(resolveControlValue("hairstyle", {}, SIDNEY)).toBe("wavy_long");
  });
  it("returns null when nothing resolves", () => {
    expect(resolveControlValue("pose", {}, SIDNEY)).toBeNull();
    expect(resolveControlValue("pose", {}, null)).toBeNull();
  });
});

describe("detectFreeTextConflicts", () => {
  it("flags free-text that contradicts a structured selection", () => {
    const conflicts = detectFreeTextConflicts(
      { hairstyle: "bun" },
      "she has a high ponytail",
      CATALOG,
      { hairstyle: "Hairstyle" },
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      controlKey: "hairstyle",
      controlLabel: "Hairstyle",
      selectedLabel: "Bun",
      conflictingLabel: "Ponytail",
    });
  });

  it("does not flag when free-text agrees with the selection", () => {
    const conflicts = detectFreeTextConflicts(
      { hairstyle: "bun" },
      "messy bun, soft lighting",
      CATALOG,
    );
    expect(conflicts).toHaveLength(0);
  });

  it("returns nothing for empty free-text", () => {
    expect(detectFreeTextConflicts({ hairstyle: "bun" }, "", CATALOG)).toHaveLength(0);
    expect(detectFreeTextConflicts({ hairstyle: "bun" }, null, CATALOG)).toHaveLength(0);
  });
});
