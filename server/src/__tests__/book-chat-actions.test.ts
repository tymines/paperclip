import { beforeEach, describe, expect, it, vi } from "vitest";
import { books, storyBibleCharacters, storyBibleOutline, storyBibleStyle, storyBibleWorldLocations } from "@paperclipai/db";

vi.mock("../services/index.js", () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));
import { logActivity } from "../services/index.js";
import { applyBookChatAuthorization, deriveBookChatAuthorization, resolveBookChatAuthorization } from "../services/book-chat-actions.js";

describe("Book Studio direct-add authorization", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["sounds good"], ["yes"], ["add that"], ["make it better"], ["add character Mira"], ["add outline beat: reveal"],
    ["delete character Mira: gone"], ["rename the book to Elsewhere"], ["set overview"],
    ["add character Mira: An engineer; and add location Harbor: Flooded docks"],
  ])("fails closed for ambiguous, generic, incomplete, or destructive text: %s", (message) => {
    expect(deriveBookChatAuthorization(message)).toBeNull();
  });

  it("derives only exact operation, destination, target, and content from the latest human text", () => {
    expect(deriveBookChatAuthorization("set overview to A haunted city learns to dream.")).toMatchObject({ operation: "overview.set", destination: "overview", content: "A haunted city learns to dream." });
    expect(deriveBookChatAuthorization("append premise: The mayor is the last sleeper.")).toMatchObject({ operation: "overview.append", destination: "overview" });
    expect(deriveBookChatAuthorization("add character named Mira: A cautious engineer with a secret.")).toMatchObject({ operation: "character.create", destination: "characters", name: "Mira" });
    expect(deriveBookChatAuthorization("update location Old Harbor: Flooded docks and bell towers.")).toMatchObject({ operation: "location.update", destination: "world-locations", name: "Old Harbor" });
    expect(deriveBookChatAuthorization("add style entry: pov=close third; tense=past; comps=Gormenghast; sample=Rain worried the windows.")).toMatchObject({ operation: "style.create", destination: "style" });
    expect(deriveBookChatAuthorization("update style entry: pov=close third; tense=past; comps=Gormenghast; sample=Rain worried the windows.")).toMatchObject({ operation: "style.update", destination: "style" });
    expect(deriveBookChatAuthorization("add outline beat to chapter 3: Mira discovers the false map.")).toMatchObject({ operation: "outline.add-beat", destination: "outline", chapterNumber: 3 });
    expect(deriveBookChatAuthorization("update outline beat 2 in chapter 3: Mira burns the false map.")).toMatchObject({ operation: "outline.update-beat", destination: "outline", chapterNumber: 3, beatNumber: 2 });
  });

  it("rejects newline and comma-then compound instructions without rejecting a valid single instruction", () => {
    expect(deriveBookChatAuthorization("set overview to First\nthen add a character")).toBeNull();
    expect(deriveBookChatAuthorization("set overview to First, then add a character")).toBeNull();
    expect(deriveBookChatAuthorization("set overview to One clear premise")).toMatchObject({ operation: "overview.set" });
  });

  it("snapshots an exact current target identity for later lock/stale validation", () => {
    const authorization = deriveBookChatAuthorization("update character Mira: New description")!;
    const resolved = resolveBookChatAuthorization(authorization, { book: { id: "book-1", locked: false, updatedAt: "2026-08-04T10:00:00.000Z" }, characters: [{ id: "char-1", name: "Mira", locked: false, updatedAt: "2026-08-04T12:00:00.000Z" }], locations: [], styles: [], outlines: [] });
    expect(resolved).toMatchObject({ target: { id: "char-1", locked: false } });
  });
});

function mockDb(options: { companyId?: string; character?: any; style?: any; outline?: any; bookMetadata?: Record<string, unknown>; updateReturningEmpty?: boolean } = {}) {
  const state = {
    book: { id: "book-1", companyId: options.companyId ?? "company-1", title: "Book", slug: "book", metadata: options.bookMetadata ?? {}, updatedAt: new Date("2026-08-04T10:00:00Z") },
    characters: options.character ? [options.character] : [], locations: [] as any[], styles: options.style ? [options.style] : [], outlines: options.outline ? [options.outline] : [],
  };
  const rows = (table: unknown) => table === books ? (state.book ? [state.book] : []) : table === storyBibleCharacters ? state.characters : table === storyBibleWorldLocations ? state.locations : table === storyBibleStyle ? state.styles : table === storyBibleOutline ? state.outlines : [];
  const db: any = {
    transaction: vi.fn(async (callback) => callback(db)),
    execute: vi.fn().mockResolvedValue([]),
    select: vi.fn(() => ({ from: (table: unknown) => ({ where: () => ({ limit: async () => rows(table).slice(0, 1) }) }) })),
    update: vi.fn((table: unknown) => ({ set: (changes: any) => ({ where: () => ({ returning: async () => {
      if (options.updateReturningEmpty) return [];
      if (table === books) Object.assign(state.book, changes);
      if (table === storyBibleCharacters && state.characters[0]) Object.assign(state.characters[0], changes);
      if (table === storyBibleStyle && state.styles[0]) Object.assign(state.styles[0], changes);
      if (table === storyBibleOutline && state.outlines[0]) Object.assign(state.outlines[0], changes);
      return [{ id: table === books ? state.book.id : rows(table)[0]?.id }];
    } }) }) })),
    insert: vi.fn((table: unknown) => ({ values: (values: any) => ({ returning: async () => {
      const created = { id: `new-${rows(table).length + 1}`, locked: false, updatedAt: new Date(), ...values }; rows(table).push(created); return [created];
    } }) })),
  };
  return { db, state };
}

describe("Book Studio direct-add executor", () => {
  const actor = { actorType: "user" as const, actorId: "board-1" };

  it("applies an overview addition atomically and activity-logs turn provenance", async () => {
    const { db, state } = mockDb({ bookMetadata: { description: "Old" } });
    const authorization = resolveBookChatAuthorization(deriveBookChatAuthorization("append overview: New"), { book: { id: state.book.id, locked: false, updatedAt: state.book.updatedAt.toISOString() }, characters: [], locations: [], styles: [], outlines: [] })!;
    const result = await applyBookChatAuthorization(db, { companyId: "company-1", bookId: "book-1", turnId: "turn-1", actor, authorization });
    expect(result).toMatchObject({ status: "applied", section: "overview", destination: "Overview description" });
    expect(state.book.metadata).toMatchObject({ description: "Old\n\nNew" });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(logActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "book.brainstorm_action_applied", details: expect.objectContaining({ turnId: "turn-1", operation: "overview.append" }) }));
  });

  it("creates a named character without reducing existing fields", async () => {
    const { db, state } = mockDb();
    const authorization = deriveBookChatAuthorization("add character named Mira: A careful engineer.")!;
    const result = await applyBookChatAuthorization(db, { companyId: "company-1", bookId: "book-1", turnId: "turn-2", actor, authorization });
    expect(result.status).toBe("applied");
    expect(state.characters[0]).toMatchObject({ name: "Mira", role: "", description: "A careful engineer.", voiceCard: {}, source: "co_created" });
  });

  it("does not accept an agent as mutation authority", async () => {
    const { db } = mockDb();
    const result = await applyBookChatAuthorization(db, {
      companyId: "company-1",
      bookId: "book-1",
      turnId: "turn-agent",
      actor: { actorType: "agent", actorId: "calliope", agentId: "calliope" },
      authorization: deriveBookChatAuthorization("add character Mira: An engineer")!,
    });
    expect(result).toMatchObject({ status: "failed", error: expect.stringContaining("human") });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("updates an exact unlocked Style target without reducing governed fields", async () => {
    const updatedAt = new Date("2026-08-04T12:00:00Z");
    const current = { id: "style-1", bookId: "book-1", pov: "close third", tense: "past", comps: "Old", sampleParagraph: "Old", bannedCliches: ["woke up"], tropes: ["found family"], locked: false, updatedAt };
    const { db, state } = mockDb({ style: current });
    const authorization = resolveBookChatAuthorization(
      deriveBookChatAuthorization("update style entry: pov=close third; tense=past; comps=Gormenghast; sample=Rain worried the windows."),
      { book: { id: "book-1", locked: false, updatedAt: "2026-08-04T10:00:00.000Z" }, characters: [], locations: [], styles: [{ id: current.id, pov: current.pov, tense: current.tense, locked: false, updatedAt: updatedAt.toISOString() }], outlines: [] },
    )!;
    expect(await applyBookChatAuthorization(db, { companyId: "company-1", bookId: "book-1", turnId: "turn-style", actor, authorization })).toMatchObject({ status: "applied", section: "style" });
    expect(state.styles[0]).toMatchObject({ comps: "Gormenghast", bannedCliches: ["woke up"], tropes: ["found family"] });
  });

  it("preserves the target timestamp through JSON storage before applying", async () => {
    const updatedAt = new Date("2026-08-04T12:00:00Z");
    const current = { id: "char-1", bookId: "book-1", name: "Mira", description: "Old", locked: false, updatedAt };
    const { db, state } = mockDb({ character: current });
    const resolved = resolveBookChatAuthorization(
      deriveBookChatAuthorization("update character Mira: New description"),
      { book: { id: "book-1", locked: false, updatedAt: "2026-08-04T10:00:00.000Z" }, characters: [{ id: current.id, name: current.name, locked: false, updatedAt: updatedAt.toISOString() }], locations: [], styles: [], outlines: [] },
    )!;
    const stored = JSON.parse(JSON.stringify(resolved));
    expect(await applyBookChatAuthorization(db, { companyId: "company-1", bookId: "book-1", turnId: "turn-json", actor, authorization: stored })).toMatchObject({ status: "applied" });
    expect(state.characters[0].description).toBe("New description");
  });

  it("fails closed when a target changes between validation and the conditional update", async () => {
    const updatedAt = new Date("2026-08-04T12:00:00Z");
    const current = { id: "style-1", bookId: "book-1", pov: "close third", tense: "past", comps: "Old", sampleParagraph: "Old", bannedCliches: [], tropes: [], locked: false, updatedAt };
    const { db } = mockDb({ style: current, updateReturningEmpty: true });
    const authorization = resolveBookChatAuthorization(
      deriveBookChatAuthorization("update style entry: pov=close third; tense=past; comps=New; sample=New sample."),
      { book: { id: "book-1", locked: false, updatedAt: "2026-08-04T10:00:00.000Z" }, characters: [], locations: [], styles: [{ id: current.id, pov: current.pov, tense: current.tense, locked: false, updatedAt: updatedAt.toISOString() }], outlines: [] },
    )!;
    expect(await applyBookChatAuthorization(db, { companyId: "company-1", bookId: "book-1", turnId: "turn-race", actor, authorization })).toMatchObject({ status: "failed", error: expect.stringContaining("changed or was locked") });
    expect(logActivity).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ details: expect.objectContaining({ turnId: "turn-race" }) }));
  });

  it("updates only the exact numbered Outline beat and returns its chapter destination", async () => {
    const updatedAt = new Date("2026-08-04T12:00:00Z");
    const current = { id: "outline-1", bookId: "book-1", chapterNumber: 3, title: "Map", beats: [{ description: "First", note: "keep" }, { description: "Old second" }], locked: false, updatedAt };
    const { db, state } = mockDb({ outline: current });
    const authorization = resolveBookChatAuthorization(
      deriveBookChatAuthorization("update outline beat 2 in chapter 3: Mira burns the false map."),
      { book: { id: "book-1", locked: false, updatedAt: "2026-08-04T10:00:00.000Z" }, characters: [], locations: [], styles: [], outlines: [{ id: current.id, chapterNumber: 3, locked: false, updatedAt: updatedAt.toISOString() }] },
    )!;
    expect(await applyBookChatAuthorization(db, { companyId: "company-1", bookId: "book-1", turnId: "turn-outline", actor, authorization })).toMatchObject({ status: "applied", section: "outline", chapterNumber: 3 });
    expect(state.outlines[0].beats).toEqual([{ description: "First", note: "keep" }, { description: "Mira burns the false map." }]);
  });

  it("fails closed for locked, stale, and cross-company targets before mutation", async () => {
    const updatedAt = new Date("2026-08-04T12:00:00Z");
    const base = deriveBookChatAuthorization("update character Mira: Changed")!;
    const lockedAuth = resolveBookChatAuthorization(base, { book: { id: "book-1", locked: false, updatedAt: "2026-08-04T10:00:00.000Z" }, characters: [{ id: "char-1", name: "Mira", locked: true, updatedAt: updatedAt.toISOString() }], locations: [], styles: [], outlines: [] })!;
    const locked = mockDb({ character: { id: "char-1", bookId: "book-1", name: "Mira", description: "Old", locked: true, updatedAt } });
    expect(await applyBookChatAuthorization(locked.db, { companyId: "company-1", bookId: "book-1", turnId: "turn-l", actor, authorization: lockedAuth })).toMatchObject({ status: "failed", error: expect.stringContaining("locked") });
    expect(locked.state.characters[0].description).toBe("Old");

    const staleAuth = resolveBookChatAuthorization(base, { book: { id: "book-1", locked: false, updatedAt: "2026-08-04T10:00:00.000Z" }, characters: [{ id: "char-1", name: "Mira", locked: false, updatedAt: updatedAt.toISOString() }], locations: [], styles: [], outlines: [] })!;
    const stale = mockDb({ character: { id: "char-1", bookId: "book-1", name: "Mira", description: "Old", locked: false, updatedAt: new Date("2026-08-04T13:00:00Z") } });
    expect(await applyBookChatAuthorization(stale.db, { companyId: "company-1", bookId: "book-1", turnId: "turn-s", actor, authorization: staleAuth })).toMatchObject({ status: "failed", error: expect.stringContaining("changed") });
    expect(stale.state.characters[0].description).toBe("Old");

    const foreign = mockDb({ companyId: "company-2" }); foreign.db.select.mockImplementationOnce(() => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }));
    expect(await applyBookChatAuthorization(foreign.db, { companyId: "company-1", bookId: "book-1", turnId: "turn-x", actor, authorization: base })).toMatchObject({ status: "failed", error: expect.stringContaining("Book not found") });
    expect(logActivity).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ details: expect.objectContaining({ turnId: "turn-x" }) }));
  });
});
