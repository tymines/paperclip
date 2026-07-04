import { pgTable, uuid, text, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { books } from "./books.js";

export const storyBibleWorldLocations = pgTable("story_bible_world_locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  rules: jsonb("rules").$type<Record<string, unknown>>().notNull().default({}),
  sensoryNotes: jsonb("sensory_notes").$type<Record<string, unknown>>().notNull().default({}),
  locked: boolean("locked").notNull().default(false),
  source: text("source").notNull().default("authored"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StoryBibleWorldLocation = typeof storyBibleWorldLocations.$inferSelect;
export type NewStoryBibleWorldLocation = typeof storyBibleWorldLocations.$inferInsert;
