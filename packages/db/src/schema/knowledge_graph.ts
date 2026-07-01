import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

export const knowledgeEntities = pgTable(
  "knowledge_entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    // "tool" | "file" | "error" | "decision" | "concept"
    type: text("type").notNull(),
    label: text("label").notNull(),
    properties: jsonb("properties").$type<Record<string, unknown>>(),
    sourceRunId: uuid("source_run_id").references(() => heartbeatRuns.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("knowledge_entities_company_idx").on(table.companyId),
    companyTypeLabelIdx: index("knowledge_entities_company_type_label_idx").on(
      table.companyId,
      table.type,
      table.label,
    ),
  }),
);

export const knowledgeEdges = pgTable(
  "knowledge_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    sourceEntityId: uuid("source_entity_id")
      .notNull()
      .references(() => knowledgeEntities.id, { onDelete: "cascade" }),
    targetEntityId: uuid("target_entity_id")
      .notNull()
      .references(() => knowledgeEntities.id, { onDelete: "cascade" }),
    // "uses" | "modifies" | "caused" | "decided" | "references"
    relationType: text("relation_type").notNull(),
    sourceRunId: uuid("source_run_id").references(() => heartbeatRuns.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("knowledge_edges_company_idx").on(table.companyId),
    sourceIdx: index("knowledge_edges_source_idx").on(table.sourceEntityId),
    targetIdx: index("knowledge_edges_target_idx").on(table.targetEntityId),
  }),
);
