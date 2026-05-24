/**
 * Service layer for `social_app_credentials` rows.
 *
 * The SocialConnectWizard writes one row per platform (Tyler's Meta App,
 * Reddit app, etc.) and the OAuth callback handler reads from it to
 * exchange the auth code for tokens.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { socialAppCredentials } from "@paperclipai/db";
import type {
  SocialAppCredentialPublic,
  SocialAppCredentialTestResult,
  SocialPlatform,
} from "@paperclipai/shared";
import {
  encryptOAuthSecret,
  decryptOAuthSecret,
  isEncryptedEnvelope,
  last4,
  type EncryptedEnvelope,
} from "./oauth-crypto.js";

type CredentialRow = typeof socialAppCredentials.$inferSelect;

function toPublic(row: CredentialRow): SocialAppCredentialPublic {
  const validationStatus = row.lastValidationStatus;
  return {
    platform: row.platform as SocialPlatform,
    clientId: row.clientId,
    clientSecretLast4: row.clientSecretLast4,
    redirectUri: row.redirectUri,
    lastValidatedAt: row.lastValidatedAt,
    lastValidationStatus:
      validationStatus === "ok" || validationStatus === "error" ? validationStatus : null,
    lastValidationMessage: row.lastValidationMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface SaveCredentialInput {
  platform: SocialPlatform;
  clientId: string;
  clientSecret: string;
  redirectUri?: string | null;
  createdBy?: string | null;
}

export function socialCredentialsService(db: Db) {
  return {
    list: async (): Promise<SocialAppCredentialPublic[]> => {
      const rows = await db.select().from(socialAppCredentials);
      return rows.map(toPublic);
    },

    get: async (platform: SocialPlatform): Promise<SocialAppCredentialPublic | null> => {
      const [row] = await db
        .select()
        .from(socialAppCredentials)
        .where(eq(socialAppCredentials.platform, platform));
      return row ? toPublic(row) : null;
    },

    /** Returns the decrypted client secret — server-only helper. */
    getDecrypted: async (
      platform: SocialPlatform,
    ): Promise<{ clientId: string; clientSecret: string; redirectUri: string | null } | null> => {
      const [row] = await db
        .select()
        .from(socialAppCredentials)
        .where(eq(socialAppCredentials.platform, platform));
      if (!row) return null;
      const envelope = row.clientSecretEncrypted as unknown;
      if (!isEncryptedEnvelope(envelope)) {
        throw new Error(`Stored client secret for ${platform} is not a valid envelope`);
      }
      return {
        clientId: row.clientId,
        clientSecret: decryptOAuthSecret(envelope),
        redirectUri: row.redirectUri,
      };
    },

    save: async (input: SaveCredentialInput): Promise<SocialAppCredentialPublic> => {
      const envelope: EncryptedEnvelope = encryptOAuthSecret(input.clientSecret);
      const tail = last4(input.clientSecret);
      const [existing] = await db
        .select()
        .from(socialAppCredentials)
        .where(eq(socialAppCredentials.platform, input.platform));
      if (existing) {
        const [updated] = await db
          .update(socialAppCredentials)
          .set({
            clientId: input.clientId,
            clientSecretEncrypted: envelope,
            clientSecretLast4: tail,
            redirectUri: input.redirectUri ?? existing.redirectUri,
            updatedAt: new Date(),
          })
          .where(eq(socialAppCredentials.platform, input.platform))
          .returning();
        return toPublic(updated);
      }
      const [created] = await db
        .insert(socialAppCredentials)
        .values({
          platform: input.platform,
          clientId: input.clientId,
          clientSecretEncrypted: envelope,
          clientSecretLast4: tail,
          redirectUri: input.redirectUri ?? null,
          createdBy: input.createdBy ?? null,
        })
        .returning();
      return toPublic(created);
    },

    delete: async (platform: SocialPlatform): Promise<boolean> => {
      const rows = await db
        .delete(socialAppCredentials)
        .where(eq(socialAppCredentials.platform, platform))
        .returning();
      return rows.length > 0;
    },

    markValidation: async (
      platform: SocialPlatform,
      result: SocialAppCredentialTestResult,
    ): Promise<void> => {
      await db
        .update(socialAppCredentials)
        .set({
          lastValidatedAt: new Date(),
          lastValidationStatus: result.ok ? "ok" : "error",
          lastValidationMessage: result.message,
          updatedAt: new Date(),
        })
        .where(eq(socialAppCredentials.platform, platform));
    },
  };
}

export type SocialCredentialsService = ReturnType<typeof socialCredentialsService>;
