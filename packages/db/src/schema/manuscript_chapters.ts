import { pgTable, text, uuid, integer, timestamp, uniqueIndex, boolean, index } from "drizzle-orm/pg-core";
import { books } from "./books.js";
import { companies } from "./companies.js";

export const manuscriptChapters = pgTable(
  "manuscript_chapters",
  {
    id: text("id").primaryKey(),
    bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
    chapterNumber: integer("chapter_number").notNull(),
    title: text("title").notNull().default(""),
    content: text("content").notNull().default(""),
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

export const passageLocks = pgTable(
  "passage_locks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id").notNull().references(() => manuscriptChapters.id, { onDelete: "cascade" }),
    chapterNumber: integer("chapter_number").notNull(),
    spanStart: integer("span_start").notNull(),
    spanEnd: integer("span_end").notNull(),
    contentHash: text("content_hash").notNull().default(""),
    reason: text("reason").notNull().default(""),
    createdByUserId: text("created_by_user_id").notNull().default("board"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    bookChapterIdx: index("passage_locks_book_chapter_idx").on(table.bookId, table.chapterNumber),
    chapterIdx: index("passage_locks_chapter_idx").on(table.chapterId),
  }),
);

export type ManuscriptChapter = typeof manuscriptChapters.$inferSelect;
export type NewManuscriptChapter = typeof manuscriptChapters.$inferInsert;
export type PassageLock = typeof passageLocks.$inferSelect;
export type NewPassageLock = typeof passageLocks.$inferInsert;
