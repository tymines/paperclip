// Story Bible codex (Spec v1 §4.1) — migration 0160.
// The structured canon store: 8 new entity types + typed relationships +
// atomic spoiler-gated facts. Characters/Locations stay on their existing
// tables (Tyler's ruling). Every entity is a typed record — never a prose blob.
//
// Uniform entity shape: id · bookId (cascade) · name · summary · details jsonb
// (type-specific depth: want/need/wound/lie, voice, mechanics…) · locked ·
// source (authored | co-created | imported | auto-extracted) · timestamps.
// locked = §7 enforcement — only the human author locks/unlocks; the AI never
// writes locked canon.
import { pgTable, uuid, text, integer, smallint, timestamp, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { books } from "./books.js";

const entityColumns = {
  id: uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  summary: text("summary").notNull().default(""),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  locked: boolean("locked").notNull().default(false),
  source: text("source").notNull().default("authored"),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/** Lore — world history, myths, religions, cultures. */
export const bibleLore = pgTable("bible_lore", { ...entityColumns });

/** Factions — groups, organizations, nations, crews. */
export const bibleFactions = pgTable("bible_factions", { ...entityColumns });

/** Objects — significant items, artifacts, weapons, MacGuffins. */
export const bibleObjects = pgTable("bible_objects", { ...entityColumns });

/** Systems — magic/tech rule systems: costs, limits, mechanics. */
export const bibleSystems = pgTable("bible_systems", { ...entityColumns });

/** Timeline — in-world events, ordered by chapter then order_index. */
export const bibleTimelineEvents = pgTable("bible_timeline_events", {
  ...entityColumns,
  chapterNumber: integer("chapter_number"),
  orderIndex: integer("order_index").notNull().default(0),
});

/** Threads — promises/setups and their payoff state (Chekhov tracking). */
export const bibleThreads = pgTable("bible_threads", {
  ...entityColumns,
  payoffState: text("payoff_state").notNull().default("open"), // open | paid | abandoned
  payoffChapter: integer("payoff_chapter"),
});

/** Themes — the book's thematic statements and motifs. */
export const bibleThemes = pgTable("bible_themes", { ...entityColumns });

/** Glossary — in-world terms + definitions. */
export const bibleGlossary = pgTable("bible_glossary", {
  ...entityColumns,
  term: text("term").notNull().default(""),
  definition: text("definition").notNull().default(""),
});

/**
 * ② Relationships — typed data, first-class. Any entity pair, not just
 * character↔character. meter −100…+100; rules[] are gate constraints (the
 * gate can FAIL a chapter that violates a relationship rule, §6.3).
 * entity_type values: character | location | lore | faction | object |
 * system | timeline | thread | theme | glossary.
 */
export const bibleRelationships = pgTable(
  "bible_relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
    fromEntityType: text("from_entity_type").notNull(),
    fromEntityId: uuid("from_entity_id").notNull(),
    toEntityType: text("to_entity_type").notNull(),
    toEntityId: uuid("to_entity_id").notNull(),
    type: text("type").notNull().default(""),
    arcStage: text("arc_stage").notNull().default(""),
    meter: smallint("meter").notNull().default(0), // −100…+100 (CHECK in SQL)
    rules: jsonb("rules").$type<string[]>().notNull().default([]),
    locked: boolean("locked").notNull().default(false),
    source: text("source").notNull().default("authored"),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bible_relationships_book_idx").on(t.bookId)],
);

/**
 * ③/④ Facts — atomic structured records, not prose blobs. Attach to entities
 * by reference; individually lockable; flow through the bible review queue
 * when auto-extracted. Spoiler gating: known_as_of = the chapter where the
 * fact becomes known in-story — only facts with known_as_of ≤ N enter the
 * writer's context packet for chapter N (and the critic's fact-check).
 */
export const bibleFacts = pgTable(
  "bible_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
    statement: text("statement").notNull(),
    entityRefs: jsonb("entity_refs").$type<{ entityType: string; entityId: string }[]>().notNull().default([]),
    knownAsOf: integer("known_as_of").notNull().default(1),
    sourceChapter: integer("source_chapter"),
    sourceScene: text("source_scene").notNull().default(""),
    provenance: text("provenance").notNull().default("authored"), // authored | co-created | auto-extracted
    locked: boolean("locked").notNull().default(false),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bible_facts_book_known_idx").on(t.bookId, t.knownAsOf)],
);

export type BibleLore = typeof bibleLore.$inferSelect;
export type BibleFaction = typeof bibleFactions.$inferSelect;
export type BibleObject = typeof bibleObjects.$inferSelect;
export type BibleSystem = typeof bibleSystems.$inferSelect;
export type BibleTimelineEvent = typeof bibleTimelineEvents.$inferSelect;
export type BibleThread = typeof bibleThreads.$inferSelect;
export type BibleTheme = typeof bibleThemes.$inferSelect;
export type BibleGlossaryEntry = typeof bibleGlossary.$inferSelect;
export type BibleRelationship = typeof bibleRelationships.$inferSelect;
export type BibleFact = typeof bibleFacts.$inferSelect;
