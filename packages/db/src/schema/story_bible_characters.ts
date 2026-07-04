import { pgTable, uuid, text, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { books } from "./books.js";

export const storyBibleCharacters = pgTable("story_bible_characters", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  role: text("role").notNull().default(""),
  description: text("description").notNull().default(""),
  voiceCard: jsonb("voice_card").$type<Record<string, unknown>>().notNull().default({}),
  locked: boolean("locked").notNull().default(false),
  source: text("source").notNull().default("authored"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StoryBibleCharacter = typeof storyBibleCharacters.$inferSelect;
export type NewStoryBibleCharacter = typeof storyBibleCharacters.$inferInsert;
