import { pgTable, uuid, text, timestamp, index, integer, jsonb, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { books } from "./books.js";

export const storyBibleChatMessages = pgTable("story_bible_chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  turnId: uuid("turn_id"),
  role: text("role").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull().default("completed"),
  via: text("via"),
  delegationId: uuid("delegation_id"),
  conversationId: text("conversation_id"),
  retryCount: integer("retry_count").notNull().default(0),
  retryable: boolean("retryable").notNull().default(true),
  authorization: jsonb("authorization").$type<Record<string, unknown> | null>(),
  actionResult: jsonb("action_result").$type<Record<string, unknown> | null>(),
  error: text("error"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  bookCreatedAtIndex: index("chat_messages_book_created_at_idx").on(table.bookId, table.createdAt),
  uniqueTurnRoleIndex: uniqueIndex("chat_messages_book_turn_role_unique_idx").on(table.bookId, table.turnId, table.role),
}));

export type StoryBibleChatMessage = typeof storyBibleChatMessages.$inferSelect;
export type NewStoryBibleChatMessage = typeof storyBibleChatMessages.$inferInsert;
