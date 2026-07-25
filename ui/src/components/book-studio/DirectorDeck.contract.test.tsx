// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BOOK_STUDIO_PARITY_FEATURES,
  STORY_BIBLE_ENTITY_SECTIONS,
} from "./directorDeckContract";
import { DirectorDeckShell } from "./DirectorDeckShell";

describe("Book Studio Director's Deck contract", () => {
  it("uses Baily decision language and never routes review decisions to Tyler", () => {
    const html = renderToStaticMarkup(<DirectorDeckShell mode="manual" lockedChapter />);

    expect(html).toContain("Your call");
    expect(html).toContain("Needs your decision");
    expect(html).not.toMatch(/Ask Tyler/i);
  });

  it("exposes exactly twelve Story Bible entity sections", () => {
    expect(STORY_BIBLE_ENTITY_SECTIONS.map((section) => section.label)).toEqual([
      "Characters",
      "Locations",
      "Lore",
      "Factions",
      "Objects",
      "Systems",
      "Timeline",
      "Threads",
      "Themes",
      "Glossary",
      "Relationships",
      "Facts",
    ]);

    const html = renderToStaticMarkup(<DirectorDeckShell mode="assisted" />);
    for (const section of STORY_BIBLE_ENTITY_SECTIONS) {
      expect(html).toContain(section.label);
    }
  });

  it("keeps review available in every director mode with full gate outcomes", () => {
    for (const mode of ["manual", "assisted", "autopilot"] as const) {
      const html = renderToStaticMarkup(<DirectorDeckShell mode={mode} />);
      expect(html).toContain("Run review");
      expect(html).toContain("This chapter");
      expect(html).toContain("Pick chapter");
      expect(html).toContain("Whole book");
      expect(html).toContain("PASS");
      expect(html).toContain("FAIL");
      expect(html).toContain("NO_VERDICT");
    }
  });

  it("shows lock controls and honest LOCKED conflict handling", () => {
    const html = renderToStaticMarkup(<DirectorDeckShell mode="manual" lockedChapter />);

    expect(html).toContain("Chapter locked");
    expect(html).toContain("Lock passage");
    expect(html).toContain("409 LOCKED");
    expect(html).toContain("Locked Content");
    expect(html).toContain("Fast draft refuses locked chapters");
    expect(html).toContain("Craft draft refuses locked chapters");
  });

  it("tracks all fifty-three audited parity features as explicit evidence rows", () => {
    expect(BOOK_STUDIO_PARITY_FEATURES).toHaveLength(53);
    expect(BOOK_STUDIO_PARITY_FEATURES.every((row) => ["PASS", "FAIL", "NO_VERDICT"].includes(row.status))).toBe(true);
    expect(BOOK_STUDIO_PARITY_FEATURES.map((row) => row.id)).toEqual(
      Array.from({ length: 53 }, (_, index) => index + 1),
    );
  });
});
