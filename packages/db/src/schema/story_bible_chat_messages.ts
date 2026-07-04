import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { books } from "./books.js";

export const storyBibleChatMessages = pgTable("story_bible_chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  bookCreatedAtIndex: index("chat_messages_book_created_at_idx").on(table.bookId, table.createdAt),
}));

export type StoryBibleChatMessage = typeof storyBibleChatMessages.$inferSelect;
export type NewStoryBibleChatMessage = typeof storyBibleChatMessages.$inferInsert;
