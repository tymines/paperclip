import {
  type AnyPgColumn,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { rooms } from "./rooms.js";

export const roomMessages = pgTable(
  "room_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
    senderId: text("sender_id").notNull(),
    senderType: text("sender_type").notNull(),
    senderName: text("sender_name"),
    content: text("content").notNull(),
    messageType: text("message_type").notNull().default("chat"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    parentMessageId: uuid("parent_message_id").references((): AnyPgColumn => roomMessages.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    roomCreatedAtIdx: index("room_messages_room_created_at_idx").on(table.roomId, table.createdAt),
    roomSenderIdx: index("room_messages_room_sender_idx").on(table.roomId, table.senderId),
    parentMessageIdx: index("room_messages_parent_message_idx").on(table.parentMessageId),
  }),
);
