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
import { socialAccounts } from "./social_accounts.js";

export const socialPosts = pgTable(
  "social_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    title: text("title"),
    content: text("content").notNull(),
    postType: text("post_type").notNull().default("text"),
    status: text("status").notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    mediaUrls: jsonb("media_urls").notNull().default([]),
    tags: jsonb("tags").notNull().default([]),
    metadata: jsonb("metadata"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("social_posts_company_status_idx").on(table.companyId, table.status),
    companyScheduledIdx: index("social_posts_company_scheduled_idx").on(table.companyId, table.scheduledAt),
    companyCreatedIdx: index("social_posts_company_created_idx").on(table.companyId, table.createdAt),
    dueIdx: index("social_posts_due_idx").on(table.status, table.scheduledAt),
  }),
);

export const socialPostTargets = pgTable(
  "social_post_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id").notNull().references(() => socialPosts.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull().references(() => socialAccounts.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    platformPostId: text("platform_post_id"),
    platformUrl: text("platform_url"),
    status: text("status").notNull().default("draft"),
    errorMessage: text("error_message"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    analytics: jsonb("analytics"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    postIdx: index("social_post_targets_post_idx").on(table.postId),
    accountIdx: index("social_post_targets_account_idx").on(table.accountId),
    statusIdx: index("social_post_targets_status_idx").on(table.status),
    idempotencyIdx: index("social_post_targets_idempotency_idx").on(table.idempotencyKey),
  }),
);
