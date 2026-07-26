import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { books } from "./books.js";
import { companies } from "./companies.js";
import { manuscriptChapters } from "./manuscript_chapters.js";

// Book Studio — span-anchored passage locks (Spec v1 §7).
// A passage lock protects a character-offset span of one chapter's prose from
// every AI write path: revision proposals exclude the span or ask, and the
// accept path never writes it. Locks compose (④): a chapter lock covers its
// passage locks; a passage lock covers its span. Anchors pin to a content hash
// (same re-anchoring rule as annotations) so a shifted span is detected as
// stale instead of silently protecting the wrong text.
// Only the human author creates/removes locks (route-level actor guard).
export const passageLocks = pgTable(
  "passage_locks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    // manuscript_chapters.id is text (see manuscript_chapters.ts).
    chapterId: text("chapter_id").notNull().references(() => manuscriptChapters.id, { onDelete: "cascade" }),
    chapterNumber: integer("chapter_number").notNull(),
    spanStart: integer("span_start").notNull(),
    spanEnd: integer("span_end").notNull(),
    // Hash of the chapter content at lock time — mismatch ⇒ stale anchor.
    contentHash: text("content_hash").notNull().default(""),
    // Optional author label ("keep this paragraph").
    note: text("note").notNull().default(""),
    createdBy: text("created_by").notNull().default("user"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    bookIdx: index("passage_locks_book_idx").on(table.bookId),
    chapterIdx: index("passage_locks_chapter_idx").on(table.chapterId),
  }),
);

export type PassageLock = typeof passageLocks.$inferSelect;
export type NewPassageLock = typeof passageLocks.$inferInsert;
