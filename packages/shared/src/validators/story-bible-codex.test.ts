import { describe, expect, it } from "vitest";
import {
  STORY_BIBLE_CANON_ENTITY_TYPES,
  createStoryBibleCanonEntitySchema,
  createStoryBibleFactSchema,
  createStoryBibleRelationshipSchema,
} from "./story-bible.js";

describe("story bible codex validators", () => {
  it("enumerates exactly the twelve canon entity types", () => {
    expect(STORY_BIBLE_CANON_ENTITY_TYPES).toEqual([
      "characters",
      "locations",
      "lore",
      "factions",
      "objects",
      "systems",
      "timeline",
      "threads",
      "themes",
      "glossary",
      "relationships",
      "facts",
    ]);
  });

  it("accepts structured character payload fields and rejects untyped blob keys", () => {
    const parsed = createStoryBibleCanonEntitySchema.parse({
      type: "characters",
      name: "Kaelen",
      payload: {
        role: "ward",
        description: "Careful heir with a public mask.",
        want: "Protect the archive.",
        need: "Trust someone else with the truth.",
        wound: "His mentor betrayed him.",
        lie: "Needing help makes him weak.",
        aliases: ["Kae"],
        voice: { register: "formal", cadence: "measured", signaturePhrases: ["plainly"] },
      },
    });

    expect(parsed.payload).toMatchObject({ want: "Protect the archive.", aliases: ["Kae"] });

    expect(() =>
      createStoryBibleCanonEntitySchema.parse({
        type: "characters",
        name: "Blob",
        payload: { arbitraryProseBlob: "not a typed field" },
      }),
    ).toThrow();
  });

  it("constrains relationship meter boundaries", () => {
    expect(createStoryBibleRelationshipSchema.parse({
      fromEntityId: "11111111-1111-4111-8111-111111111111",
      toEntityId: "22222222-2222-4222-8222-222222222222",
      type: "trust",
      arcStage: "strained",
      meter: -100,
      rules: ["Never reveals the archive before chapter 8."],
    }).meter).toBe(-100);

    expect(createStoryBibleRelationshipSchema.parse({
      fromEntityId: "11111111-1111-4111-8111-111111111111",
      toEntityId: "22222222-2222-4222-8222-222222222222",
      type: "trust",
      arcStage: "strained",
      meter: 100,
      rules: [],
    }).meter).toBe(100);

    expect(() =>
      createStoryBibleRelationshipSchema.parse({
        fromEntityId: "11111111-1111-4111-8111-111111111111",
        toEntityId: "22222222-2222-4222-8222-222222222222",
        type: "trust",
        arcStage: "strained",
        meter: 101,
        rules: [],
      }),
    ).toThrow();
  });

  it("validates atomic facts without permitting future-less or anonymous provenance", () => {
    expect(createStoryBibleFactSchema.parse({
      statement: "Kaelen can read the archive seals.",
      entityRefs: ["11111111-1111-4111-8111-111111111111"],
      knownAsOfChapter: 3,
      source: { chapter: 3, scene: "archive" },
      provenance: "authored",
      locked: true,
    })).toMatchObject({ knownAsOfChapter: 3, locked: true });

    expect(() =>
      createStoryBibleFactSchema.parse({
        statement: "Bad provenance.",
        entityRefs: [],
        knownAsOfChapter: 1,
        source: { chapter: 1 },
        provenance: "imported",
      }),
    ).toThrow();
  });
});
