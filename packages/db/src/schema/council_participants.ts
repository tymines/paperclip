import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { councilSessions } from "./council_sessions.js";
import { agents } from "./agents.js";

export const councilParticipants = pgTable(
  "council_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull().references(() => councilSessions.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    position: text("position"),
    vote: text("vote"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
  },
  (table) => ({
    sessionIdx: index("council_participants_session_idx").on(table.sessionId),
    agentIdx: index("council_participants_agent_idx").on(table.agentId),
  }),
);
