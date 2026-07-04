import { pgTable, text, uuid, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { books } from "./books.js";

export const manuscriptChapters = pgTable(
  "manuscript_chapters",
  {
    id: text("id").primaryKey(),
    bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
    chapterNumber: integer("chapter_number").notNull(),
    title: text("title").notNull().default(""),
    content: text("content").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    bookChapterUniqueIdx: uniqueIndex("manuscript_chapters_book_chapter_unique_idx").on(
      table.bookId,
      table.chapterNumber,
    ),
  }),
);

export type ManuscriptChapter = typeof manuscriptChapters.$inferSelect;
export type NewManuscriptChapter = typeof manuscriptChapters.$inferInsert;
