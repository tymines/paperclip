import { pgTable, uuid, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { books } from "./books.js";
import { companies } from "./companies.js";
import { manuscriptChapters } from "./manuscript_chapters.js";

// Book Studio — span-anchored review annotations (Dispatch Build Spec §4/§6).
// GATED: migration 0151 is written but NOT applied. Server code that touches
// these tables MUST catch relation-does-not-exist (42P01) and fall back to the
// books.metadata.reviewNotes jsonb path, surfacing `available: false` honestly.

// One review pass (manual "run review" click or an assisted/autopilot hook).
// Groups the annotations it produced so a pass can be read/dismissed as a unit.
export const bookReviewRuns = pgTable(
  "book_review_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    // Review lens for the pass: canon | voice | continuity | structure | prose
    lens: text("lens").notNull().default("prose"),
    // Who/what ran the review (e.g. "reviewer-lane", "baily", an agent id).
    reviewer: text("reviewer").notNull().default("reviewer-lane"),
    // Model (or provider chain) that produced the annotations — recorded honestly.
    model: text("model").notNull().default(""),
    // Scope of the pass, e.g. "chapter:3" or "book".
    scope: text("scope").notNull().default(""),
    summary: text("summary").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    bookIdx: index("book_review_runs_book_idx").on(table.bookId),
    bookCreatedIdx: index("book_review_runs_book_created_idx").on(table.bookId, table.createdAt),
  }),
);

// Span-anchored annotation against manuscript prose. Anchors are character
// offsets into manuscript_chapters.content, pinned to a content hash so a
// stale anchor (chapter edited since) is detectable rather than silently wrong.
export const bookAnnotations = pgTable(
  "book_annotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
    // manuscript_chapters.id is text (see manuscript_chapters.ts).
    chapterId: text("chapter_id").notNull().references(() => manuscriptChapters.id, { onDelete: "cascade" }),
    chapterNumber: integer("chapter_number").notNull(),
    reviewRunId: uuid("review_run_id").references(() => bookReviewRuns.id, { onDelete: "set null" }),
    // Span anchor (character offsets). Null span = chapter-level annotation.
    spanStart: integer("span_start"),
    spanEnd: integer("span_end"),
    // Hash of the chapter content at anchor time — mismatch ⇒ stale anchor.
    contentHash: text("content_hash").notNull().default(""),
    // note | review | suggestion
    kind: text("kind").notNull().default("note"),
    body: text("body").notNull(),
    author: text("author").notNull().default("user"),
    resolved: boolean("resolved").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    bookIdx: index("book_annotations_book_idx").on(table.bookId),
    chapterIdx: index("book_annotations_chapter_idx").on(table.chapterId),
    bookResolvedIdx: index("book_annotations_book_resolved_idx").on(table.bookId, table.resolved),
    reviewRunIdx: index("book_annotations_review_run_idx").on(table.reviewRunId),
  }),
);

export type BookReviewRun = typeof bookReviewRuns.$inferSelect;
export type NewBookReviewRun = typeof bookReviewRuns.$inferInsert;
export type BookAnnotation = typeof bookAnnotations.$inferSelect;
export type NewBookAnnotation = typeof bookAnnotations.$inferInsert;
