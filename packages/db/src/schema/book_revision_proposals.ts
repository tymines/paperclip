import { pgTable, uuid, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { books } from "./books.js";
import { companies } from "./companies.js";
import { manuscriptChapters } from "./manuscript_chapters.js";

export const bookRevisionProposals = pgTable(
  "book_revision_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id").references(() => manuscriptChapters.id, { onDelete: "set null" }),
    chapterNumber: integer("chapter_number").notNull(),
    scope: text("scope").notNull().default("chapter"),
    instruction: text("instruction").notNull().default(""),
    baseContentHash: text("base_content_hash").notNull().default(""),
    proposedContent: text("proposed_content").notNull(),
    status: text("status").notNull().default("pending"),
    rejectionReason: text("rejection_reason"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdByActorType: text("created_by_actor_type").notNull().default("agent"),
    createdByActorId: text("created_by_actor_id").notNull().default("unknown"),
    decidedByUserId: text("decided_by_user_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    bookStatusIdx: index("book_revision_proposals_book_status_idx").on(table.bookId, table.status),
    chapterIdx: index("book_revision_proposals_chapter_idx").on(table.bookId, table.chapterNumber),
  }),
);

export type BookRevisionProposal = typeof bookRevisionProposals.$inferSelect;
export type NewBookRevisionProposal = typeof bookRevisionProposals.$inferInsert;
