import { describe, expect, it } from "vitest";
import { compileChapterContext } from "./book-context-compiler.js";

const TABLE_NAME = Symbol.for("drizzle:Name");

function mockDb() {
  const rows: Record<string, unknown[]> = {
    books: [{ id: "book-1", title: "The Copper City", metadata: {} }],
    story_bible_style: [],
    story_bible_characters: [
      {
        name: "Mara",
        role: "captain",
        description: "A patient investigator",
        voiceCard: { cadence: "clipped sentences", refrain: "Count every door" },
      },
    ],
    story_bible_world_locations: [
      {
        name: "Bell Tower",
        description: "The city's oldest watch post",
        sensoryNotes: { sound: "copper bells at midnight", air: "cold and metallic" },
        rules: { magic: "iron breaks every spell", access: "only captains carry keys" },
      },
    ],
    story_bible_outline: [
      {
        chapterNumber: 1,
        title: "Midnight Watch",
        beats: [{ beat: "Mara searches the Bell Tower" }],
      },
    ],
    manuscript_chapters: [],
  };

  return {
    select: () => ({
      from: (table: Record<symbol, string>) => ({
        where: async () => rows[table[TABLE_NAME]] ?? [],
      }),
    }),
  } as any;
}

describe("compileChapterContext", () => {
  it("renders object-valued voice cards, sensory notes, and world rules into the writer prompt", async () => {
    const { userPrompt } = await compileChapterContext(mockDb(), "book-1", 1);

    expect(userPrompt).not.toContain("[object Object]");
    expect(userPrompt).toContain("clipped sentences");
    expect(userPrompt).toContain("Count every door");
    expect(userPrompt).toContain("copper bells at midnight");
    expect(userPrompt).toContain("cold and metallic");
    expect(userPrompt).toContain("iron breaks every spell");
    expect(userPrompt).toContain("only captains carry keys");
  });
});
