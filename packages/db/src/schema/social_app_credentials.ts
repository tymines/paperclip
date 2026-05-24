import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Per-platform OAuth app credentials that Tyler registered in each
 * platform's developer console (Meta App, X Developer, Reddit app).
 *
 * One row per platform — these are instance-wide, not per-company,
 * because a single Paperclip instance uses one Meta App / one X app
 * across all companies it serves.
 *
 * The client secret is encrypted with the local AES-256-GCM master key
 * via `socialOAuthCrypto` in the server package; only the last-4 chars
 * are returned to the UI for confirmation.
 */
export const socialAppCredentials = pgTable(
  "social_app_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platform: text("platform").notNull(),
    clientId: text("client_id").notNull(),
    clientSecretEncrypted: jsonb("client_secret_encrypted").notNull(),
    clientSecretLast4: text("client_secret_last4"),
    redirectUri: text("redirect_uri"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    lastValidationStatus: text("last_validation_status"),
    lastValidationMessage: text("last_validation_message"),
  },
  (table) => ({
    platformUniq: index("social_app_credentials_platform_uniq").on(table.platform),
  }),
);
