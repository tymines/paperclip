import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { socialPosts } from "./social_posts.js";

export const bulkUploadDrafts = pgTable(
  "bulk_upload_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    name: text("name"),
    step: text("step").notNull().default("upload"),
    status: text("status").notNull().default("draft"),
    strategy: text("strategy"),
    strategyConfig: jsonb("strategy_config"),
    metadata: jsonb("metadata"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    committedAt: timestamp("committed_at", { withTimezone: true }),
  },
  (table) => ({
    companyStatusIdx: index("bulk_upload_drafts_company_status_idx").on(table.companyId, table.status),
    companyUpdatedIdx: index("bulk_upload_drafts_company_updated_idx").on(table.companyId, table.updatedAt),
  }),
);

export const bulkUploads = pgTable(
  "bulk_uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    draftId: uuid("draft_id").references(() => bulkUploadDrafts.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    thumbnailKey: text("thumbnail_key"),
    detectedType: text("detected_type").notNull(),
    orderIndex: integer("order_index").notNull().default(0),
    caption: text("caption"),
    hashtags: jsonb("hashtags").notNull().default([]),
    platforms: jsonb("platforms").notNull().default([]),
    aiSuggestedCaption: text("ai_suggested_caption"),
    scheduledPostId: uuid("scheduled_post_id").references(() => socialPosts.id, { onDelete: "set null" }),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bulk_uploads_company_idx").on(table.companyId),
    draftIdx: index("bulk_uploads_draft_idx").on(table.draftId),
    draftOrderIdx: index("bulk_uploads_draft_order_idx").on(table.draftId, table.orderIndex),
  }),
);
