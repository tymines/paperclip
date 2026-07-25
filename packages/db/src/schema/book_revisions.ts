import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { books } from "./books.js";
import { companies } from "./companies.js";
import { manuscriptChapters } from "./manuscript_chapters.js";

// Book Studio — directed revision diff proposals (Spec v1 §5.D/E).
// The AI NEVER writes manuscript prose outside an accepted proposal: a directed
// revision job (chapter / passage / canon-fix scope) produces one of these rows
// with status "pending"; only Baily's accept writes through persistChapterProse.
// `content_hash` pins the proposal to the chapter text it was computed against —
// the accept path re-checks it so a stale proposal can never silently clobber
// newer human edits (TOCTOU).
export const bookRevisions = pgTable(
  "book_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    // manuscript_chapters.id is text (see manuscript_chapters.ts).
    chapterId: text("chapter_id").notNull().references(() => manuscriptChapters.id, { onDelete: "cascade" }),
    chapterNumber: integer("chapter_number").notNull(),
    // chapter | passage | canon-fix
    scope: text("scope").notNull().default("chapter"),
    // Passage scope: character offsets into manuscript_chapters.content.
    spanStart: integer("span_start"),
    spanEnd: integer("span_end"),
    // Baily's direction for this revision (or the source critique note text).
    instruction: text("instruction").notNull().default(""),
    // Link back to the review note that originated this job (Send-to-revision).
    // JSONB review notes have string ids, so this is plain text, not an FK.
    sourceNoteId: text("source_note_id"),
    // The diff: exact text being replaced ("" = whole chapter) + the proposal.
    originalText: text("original_text").notNull().default(""),
    proposedText: text("proposed_text").notNull(),
    rationale: text("rationale").notNull().default(""),
    // Hash of chapter content when the proposal was computed.
    contentHash: text("content_hash").notNull().default(""),
    // Writer lane that produced the proposal — recorded honestly.
    model: text("model").notNull().default(""),
    // pending | accepted | rejected
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => ({
    bookIdx: index("book_revisions_book_idx").on(table.bookId),
    bookStatusIdx: index("book_revisions_book_status_idx").on(table.bookId, table.status),
    chapterIdx: index("book_revisions_chapter_idx").on(table.chapterId),
  }),
);

export type BookRevision = typeof bookRevisions.$inferSelect;
export type NewBookRevision = typeof bookRevisions.$inferInsert;
