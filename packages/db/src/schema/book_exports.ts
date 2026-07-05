import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { books } from "./books.js";
import { companies } from "./companies.js";

export const bookExports = pgTable(
  "book_exports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    type: text("type").notNull().default("export"), // "export" | "narration"
    format: text("format").notNull(), // "pdf" | "epub" | "mp3"
    status: text("status").notNull().default("pending"), // "pending" | "completed" | "failed"
    outputPath: text("output_path"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    bookIdIdx: index("book_exports_book_id_idx").on(table.bookId),
  }),
);

export type BookExport = typeof bookExports.$inferSelect;
export type NewBookExport = typeof bookExports.$inferInsert;
