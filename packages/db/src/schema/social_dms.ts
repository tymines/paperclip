import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { socialAccounts } from "./social_accounts.js";

/**
 * Inbound + outbound DMs polled from each connected social account.
 *
 * Today only the X DM poller (`server/src/workers/social-dm-poller.ts`)
 * writes here — Instagram / Threads / Facebook DM ingestion will land
 * once their respective adapters wire through. One row per platform DM
 * event, idempotent on `(platform, message_id)` so the poller's
 * since_id cursor + the unique index together guarantee no duplicates.
 *
 * Outbound rows are written for replies Paperclip sends so the thread
 * view can render both sides.
 */
export const socialDms = pgTable(
  "social_dms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    socialAccountId: uuid("social_account_id")
      .notNull()
      .references(() => socialAccounts.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    threadId: text("thread_id").notNull(),
    messageId: text("message_id").notNull(),
    direction: text("direction").notNull(),
    senderPlatformUserId: text("sender_platform_user_id"),
    senderHandle: text("sender_handle"),
    senderDisplayName: text("sender_display_name"),
    senderAvatarUrl: text("sender_avatar_url"),
    senderVerified: boolean("sender_verified").notNull().default(false),
    senderIsFirstContact: boolean("sender_is_first_contact").notNull().default(false),
    text: text("text"),
    mediaUrls: jsonb("media_urls").notNull().default([]),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    rawPayload: jsonb("raw_payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountSentIdx: index("social_dms_account_sent_idx").on(table.socialAccountId, table.sentAt),
    threadIdx: index("social_dms_thread_idx").on(table.socialAccountId, table.threadId, table.sentAt),
    unreadIdx: index("social_dms_unread_idx").on(table.socialAccountId, table.readAt),
    platformMessageUniq: uniqueIndex("social_dms_platform_message_uniq").on(table.platform, table.messageId),
  }),
);

/**
 * Lightweight alerts written by background workers (DM poller today,
 * other observers later) for the Jarvis briefing to surface.
 *
 * Existing Jarvis code reads `jarvis_learned_preferences` / conversation
 * tables but doesn't yet have a "what should I tell Tyler about" sink —
 * this is that sink. The briefing job filters on `dismissed_at IS NULL`
 * and orders by `created_at DESC`.
 */
export const jarvisAlerts = pgTable(
  "jarvis_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id"),
    source: text("source").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    refType: text("ref_type"),
    refId: text("ref_id"),
    metadata: jsonb("metadata"),
    severity: text("severity").notNull().default("info"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    seenAt: timestamp("seen_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  },
  (table) => ({
    companyCreatedIdx: index("jarvis_alerts_company_created_idx").on(table.companyId, table.createdAt),
    sourceIdx: index("jarvis_alerts_source_idx").on(table.source, table.createdAt),
    pendingIdx: index("jarvis_alerts_pending_idx").on(table.dismissedAt, table.createdAt),
  }),
);
