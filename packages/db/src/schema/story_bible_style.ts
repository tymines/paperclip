import { pgTable, uuid, text, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { books } from "./books.js";

export const storyBibleStyle = pgTable("story_bible_style", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  pov: text("pov").notNull().default(""),
  tense: text("tense").notNull().default(""),
  comps: text("comps").notNull().default(""),
  sampleParagraph: text("sample_paragraph").notNull().default(""),
  bannedCliches: jsonb("banned_cliches").$type<string[]>().notNull().default([]),
  tropes: jsonb("tropes").$type<string[]>().notNull().default([]),
  locked: boolean("locked").notNull().default(false),
  source: text("source").notNull().default("authored"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StoryBibleStyle = typeof storyBibleStyle.$inferSelect;
export type NewStoryBibleStyle = typeof storyBibleStyle.$inferInsert;
