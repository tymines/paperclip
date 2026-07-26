import { pgTable, text, uuid, integer, timestamp, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { books } from "./books.js";

export const manuscriptChapters = pgTable(
  "manuscript_chapters",
  {
    id: text("id").primaryKey(),
    bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
    chapterNumber: integer("chapter_number").notNull(),
    title: text("title").notNull().default(""),
    content: text("content").notNull().default(""),
    // Spec v1 §7 LOCK: protected from every AI write path (the AI skips or asks,
    // never clobbers — even on a directed revision or ?overwrite=1). Only the
    // human author sets/clears this; her own edits are unaffected.
    locked: boolean("locked").notNull().default(false),
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
