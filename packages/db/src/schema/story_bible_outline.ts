import { pgTable, uuid, text, timestamp, jsonb, integer, boolean } from "drizzle-orm/pg-core";
import { books } from "./books.js";

export const storyBibleOutline = pgTable("story_bible_outline", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  chapterNumber: integer("chapter_number").notNull().default(1),
  title: text("title").notNull().default(""),
  beats: jsonb("beats").$type<Record<string, unknown>[]>().notNull().default([]),
  locked: boolean("locked").notNull().default(false),
  source: text("source").notNull().default("authored"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StoryBibleOutline = typeof storyBibleOutline.$inferSelect;
export type NewStoryBibleOutline = typeof storyBibleOutline.$inferInsert;
