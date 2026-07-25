import { describe, expect, it } from "vitest";
import {
  buildCodexContextAudit,
  validateCodexEntityRefs,
  prepareFactAutoExtractionProposal,
} from "./story-bible-codex.js";

const entities = [
  { id: "char-1", bookId: "book-1", companyId: "company-1", type: "characters", name: "Kaelen" },
  { id: "loc-1", bookId: "book-1", companyId: "company-1", type: "locations", name: "Archive" },
  { id: "other-book", bookId: "book-2", companyId: "company-1", type: "characters", name: "Mara" },
  { id: "other-company", bookId: "book-3", companyId: "company-2", type: "characters", name: "Vey" },
];

describe("story bible codex services", () => {
  it("keeps knownAsOf boundary inclusive and withholds future fact statement text", () => {
    const chapterThreeFact = {
      id: "fact-3",
      bookId: "book-1",
      companyId: "company-1",
      statement: "Kaelen can read the archive seals.",
      entityRefs: ["char-1"],
      knownAsOfChapter: 3,
      source: { chapter: 3, scene: "vault" },
      provenance: "authored",
      locked: false,
    };
    const chapterFourFact = {
      id: "fact-4",
      bookId: "book-1",
      companyId: "company-1",
      statement: "The archive is secretly alive.",
      entityRefs: ["loc-1"],
      knownAsOfChapter: 4,
      source: { chapter: 4, scene: "heart" },
      provenance: "co-created",
      locked: true,
    };

    const audit = buildCodexContextAudit({
      chapterNumber: 3,
      entities: entities.slice(0, 2),
      facts: [chapterThreeFact, chapterFourFact],
    });

    expect(audit.consultedFacts.map((f) => f.id)).toEqual(["fact-3"]);
    expect(audit.modelContextText).toContain(chapterThreeFact.statement);
    expect(audit.modelContextText).not.toContain(chapterFourFact.statement);
    expect(JSON.stringify(audit.withheldFacts)).not.toContain(chapterFourFact.statement);
    expect(audit.withheldFacts).toEqual([
      {
        id: "fact-4",
        knownAsOfChapter: 4,
        entityRefs: ["loc-1"],
        locked: true,
        provenance: "co-created",
      },
    ]);
  });

  it("rejects cross-book and cross-company entity refs", () => {
    expect(validateCodexEntityRefs({
      companyId: "company-1",
      bookId: "book-1",
      entityIds: ["char-1", "loc-1"],
      entities,
    })).toEqual({ ok: true });

    expect(validateCodexEntityRefs({
      companyId: "company-1",
      bookId: "book-1",
      entityIds: ["other-book"],
      entities,
    })).toMatchObject({ ok: false, code: "CROSS_BOOK_REF" });

    expect(validateCodexEntityRefs({
      companyId: "company-1",
      bookId: "book-1",
      entityIds: ["other-company"],
      entities,
    })).toMatchObject({ ok: false, code: "CROSS_COMPANY_REF" });
  });

  it("keeps locked facts unchanged when auto-extraction proposes a contradiction", () => {
    const existing = {
      id: "fact-locked",
      bookId: "book-1",
      companyId: "company-1",
      statement: "Kaelen is incapable of subterfuge.",
      entityRefs: ["char-1"],
      knownAsOfChapter: 2,
      source: { chapter: 2 },
      provenance: "authored",
      locked: true,
    };

    const proposal = prepareFactAutoExtractionProposal({
      companyId: "company-1",
      bookId: "book-1",
      proposedFact: {
        statement: "Kaelen lies easily in public.",
        entityRefs: ["char-1"],
        knownAsOfChapter: 8,
        source: { chapter: 8, scene: "court" },
        provenance: "auto-extracted",
      },
      existingFacts: [existing],
    });

    expect(existing.statement).toBe("Kaelen is incapable of subterfuge.");
    expect(proposal.status).toBe("pending_review");
    expect(proposal.flags).toContain("locked_fact_conflict");
    expect(proposal.applied).toBe(false);
  });
});
