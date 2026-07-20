import { describe, expect, it } from "vitest";
import { compileChapterContext } from "./book-context-compiler.js";
import { serializeStructured } from "./serialize-structured.js";

/**
 * Drizzle stores table names under this symbol.
 */
const DRIZZLE_TABLE_NAME = Symbol.for("drizzle:Name");

/**
 * Build a mock DB client that returns structured JSONB data for all three
 * affected fields: voiceCard (character), sensoryNotes (location), rules (location).
 * Each contains nested objects and arrays that trigger [object Object] corruption
 * when naively interpolated in template literals.
 */
function buildMockDb() {
  const now = new Date();

  // ---- Structured JSONB data that triggers [object Object] ----
  const voiceCard = {
    tone: "wry and sardonic",
    speechPattern: "frequent rhetorical questions",
    catchphrases: ["Well, well, well", "Would you believe it?"],
    quirks: { alwaysChecksWatch: true, muttersUnderBreath: "counts seconds" },
  };

  const voiceCard2 = {
    traits: { age: 30, accent: "faint Spanish" },
    catchphrases: ["Never mind that", "You wouldn't believe me"],
    notes: { speaksSlowly: true, avoidsEyeContact: true },
  };

  const sensoryNotes = {
    lighting: "dim amber gaslight",
    sounds: ["distant train whistle", "creaking floorboards", "rain on tin roof"],
    smells: ["dusty velvet", "old paper", "coffee"],
    mood: "melancholic foreboding",
  };

  const sensoryNotes2 = {
    lighting: "candlelit halls",
    sounds: ["grandfather clock", "footsteps in empty rooms"],
    mood: "oppressive grandeur",
  };

  const rules = {
    magic: "no visible magic — only subtle reality warping",
    technology: "early 1900s level, no electricity in buildings",
    social: "women cannot inherit property",
    factions: ["The Guild", "The Order of the Lamp"],
  };

  const rules2 = {
    entry: "by invitation only",
    secretRooms: ["basement vault", "attic study"],
  };

  // Map of drizzle table names (internal Symbol) to row data
  const tableData: Record<string, unknown[]> = {
    books: [
      {
        id: "book-1",
        companyId: "comp-1",
        slug: "test-novel",
        title: "Test Novel",
        metadata: { premise: "A story about testing persistence" },
        createdAt: now,
        updatedAt: now,
      },
    ],
    story_bible_style: [
      {
        id: "style-1",
        bookId: "book-1",
        pov: "third_person_limited",
        tense: "past",
        comps: "Stylish prose",
        sampleParagraph: "It was a dark and stormy night.",
        bannedCliches: [],
        tropes: [],
        locked: false,
        source: "authored",
        createdAt: now,
        updatedAt: now,
      },
    ],
    story_bible_characters: [
      {
        id: "char-1",
        bookId: "book-1",
        name: "Detective Morgan",
        role: "protagonist",
        description: "A weary detective with a sharp tongue",
        voiceCard,
        locked: false,
        source: "authored",
        metadata: {},
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "char-2",
        bookId: "book-1",
        name: "Elena Vasquez",
        role: "informant",
        description: "A mysterious woman with secrets",
        voiceCard: voiceCard2,
        locked: false,
        source: "authored",
        metadata: {},
        createdAt: now,
        updatedAt: now,
      },
    ],
    story_bible_world_locations: [
      {
        id: "loc-1",
        bookId: "book-1",
        name: "Union Station",
        description: "A grand Beaux-Arts train station",
        rules,
        sensoryNotes,
        locked: false,
        source: "authored",
        metadata: {},
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "loc-2",
        bookId: "book-1",
        name: "Blackwood Mansion",
        description: "An old Victorian mansion on the hill",
        rules: rules2,
        sensoryNotes: sensoryNotes2,
        locked: false,
        source: "authored",
        metadata: {},
        createdAt: now,
        updatedAt: now,
      },
    ],
    story_bible_outline: [
      {
        id: "beat-1",
        bookId: "book-1",
        chapterNumber: 1,
        title: "The Arrival",
        beats: [
          { beat: "Morgan arrives at Union Station after midnight" },
          { beat: "Elena approaches him on the platform" },
        ],
        locked: false,
        source: "authored",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "beat-2",
        bookId: "book-1",
        chapterNumber: 2,
        title: "The Meeting",
        beats: [
          { beat: "They discuss the case in the station cafe" },
          { beat: "Morgan learns about the missing artifact" },
        ],
        locked: false,
        source: "authored",
        createdAt: now,
        updatedAt: now,
      },
    ],
    manuscript_chapters: [],
  };

  /**
   * Drizzle ORM's from() method determines the table name via getTableName(),
   * which returns table[Symbol.for("drizzle:Name")].
   */
  const mockSelect = () => ({
    from: (table: any) => ({
      where: (_condition: any) => {
        const tableName: string =
          table?.[DRIZZLE_TABLE_NAME] ?? (typeof table === "object" ? table?.name : undefined) ?? "unknown";
        return Promise.resolve(tableData[tableName] ?? []);
      },
    }),
  });

  return { select: mockSelect } as any;
}

describe("compileChapterContext — structured JSONB serialization", () => {
  it("serializes all three JSONB fields as structured text, not [object Object]", async () => {
    const db = buildMockDb();
    const result = await compileChapterContext(db, "book-1", 1);

    // THE CORE ASSERTION: the assembled prompt must not have raw [object Object]
    expect(result.userPrompt).not.toContain("[object Object]");

    // Structural assertions to confirm data made it through
    expect(result.userPrompt).toContain("Test Novel");
    expect(result.userPrompt).toContain("Detective Morgan");
    expect(result.userPrompt).toContain("Elena Vasquez");
    expect(result.userPrompt).toContain("Union Station");

    // These prove the JSONB data was properly serialized rather than dropped
    // (character voiceCard)
    expect(result.userPrompt).toContain("wry and sardonic");
    expect(result.userPrompt).toContain("Well, well, well");
    expect(result.userPrompt).toContain("faint Spanish");

    // (location sensoryNotes)
    expect(result.userPrompt).toContain("dim amber gaslight");
    expect(result.userPrompt).toContain("melancholic foreboding");
    expect(result.userPrompt).toContain("distant train whistle");

    // (location rules)
    expect(result.userPrompt).toContain("no visible magic");
    expect(result.userPrompt).toContain("The Guild");
    expect(result.userPrompt).toContain("women cannot inherit property");
  });

  it("serializeStructured handles strings verbatim", () => {
    expect(serializeStructured("hello world")).toBe("hello world");
    expect(serializeStructured("")).toBe("");
  });

  it("serializeStructured handles null/undefined as empty string", () => {
    expect(serializeStructured(null)).toBe("");
    expect(serializeStructured(undefined)).toBe("");
  });

  it("serializeStructured handles arrays", () => {
    const result = serializeStructured(["alpha", "beta", "gamma"]);
    expect(result).toBe("alpha\nbeta\ngamma");
  });

  it("serializeStructured handles nested objects", () => {
    const input = {
      name: "test",
      tags: ["a", "b"],
      meta: { depth: 2, active: true },
    };
    const result = serializeStructured(input);
    expect(result).toContain("name: test");
    expect(result).toContain("tags:\na\nb");
    expect(result).toContain("depth: 2");
    expect(result).toContain("active: true");
  });

  it("serializeStructured handles numbers and booleans", () => {
    expect(serializeStructured(42)).toBe("42");
    expect(serializeStructured(false)).toBe("false");
  });
});
