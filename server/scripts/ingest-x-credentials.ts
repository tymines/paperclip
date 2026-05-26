/**
 * One-off ingestion of X (Twitter) developer app credentials into
 * `social_app_credentials`. Reads all secrets from environment variables —
 * NEVER bake secret values into source.
 *
 * Usage (from repo root):
 *
 *   DATABASE_URL="postgres://paperclip:paperclip@127.0.0.1:54329/paperclip" \
 *   PAPERCLIP_SECRETS_MASTER_KEY_FILE="$HOME/.paperclip/instances/default/secrets/master.key" \
 *   X_CONSUMER_KEY=… X_CONSUMER_SECRET=… X_BEARER_TOKEN=… \
 *   X_CLIENT_ID=… X_CLIENT_SECRET=… \
 *   X_REDIRECT_URI="https://paperclip.augiport.com/api/social/callback/x" \
 *   X_DEFAULT_SCOPES="tweet.read tweet.write users.read offline.access" \
 *   pnpm --filter @paperclipai/server exec tsx scripts/ingest-x-credentials.ts
 *
 * The script:
 *   1. UPSERTS the `twitter` row with all five secrets encrypted at rest.
 *   2. Decrypts back and verifies round-trip without printing values.
 *   3. Prints only redacted (last-4) markers + row id.
 */
import { createDb, socialAppCredentials } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { socialCredentialsService } from "../src/services/social-scheduler/credentials.js";
import {
  decryptOAuthSecret,
  isEncryptedEnvelope,
  last4,
} from "../src/services/social-scheduler/oauth-crypto.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return v.trim();
}

async function main() {
  const url = requireEnv("DATABASE_URL");
  const consumerKey = requireEnv("X_CONSUMER_KEY");
  const consumerSecret = requireEnv("X_CONSUMER_SECRET");
  const bearerToken = requireEnv("X_BEARER_TOKEN");
  const clientId = requireEnv("X_CLIENT_ID");
  const clientSecret = requireEnv("X_CLIENT_SECRET");
  const redirectUri = requireEnv("X_REDIRECT_URI");
  const scopesRaw = requireEnv("X_DEFAULT_SCOPES");
  const defaultScopes = scopesRaw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const db = createDb(url);
  const svc = socialCredentialsService(db);

  const saved = await svc.save({
    platform: "twitter",
    clientId,
    clientSecret,
    redirectUri,
    consumerKey,
    consumerSecret,
    bearerToken,
    defaultScopes,
    createdBy: "script:ingest-x-credentials",
  });

  // Round-trip verify: read the raw row, decrypt each envelope, compare
  // to original input. Print only last-4 markers.
  const [row] = await db
    .select()
    .from(socialAppCredentials)
    .where(eq(socialAppCredentials.platform, "twitter"));
  if (!row) throw new Error("row not found after save");

  const checks: Array<[string, string, unknown, string]> = [
    ["client_secret", clientSecret, row.clientSecretEncrypted, row.clientSecretLast4 ?? ""],
    [
      "consumer_secret",
      consumerSecret,
      row.consumerSecretEncrypted,
      row.consumerSecretLast4 ?? "",
    ],
    ["bearer_token", bearerToken, row.bearerTokenEncrypted, row.bearerTokenLast4 ?? ""],
  ];

  const results: Record<string, { roundTrip: boolean; last4: string }> = {};
  for (const [label, original, envelope, storedTail] of checks) {
    if (!isEncryptedEnvelope(envelope)) {
      throw new Error(`${label}: stored value is not a valid encrypted envelope`);
    }
    const decrypted = decryptOAuthSecret(envelope);
    const ok = decrypted === original && storedTail === last4(original);
    results[label] = { roundTrip: ok, last4: storedTail };
    if (!ok) throw new Error(`${label}: round-trip decryption mismatch`);
  }

  // Verify non-secret fields are stored verbatim.
  if (row.clientId !== clientId) throw new Error("client_id mismatch");
  if (row.consumerKey !== consumerKey) throw new Error("consumer_key mismatch");
  if (row.redirectUri !== redirectUri) throw new Error("redirect_uri mismatch");
  const storedScopes = Array.isArray(row.defaultScopes)
    ? (row.defaultScopes as string[])
    : [];
  if (storedScopes.join(" ") !== defaultScopes.join(" ")) {
    throw new Error("default_scopes mismatch");
  }

  // Configured-status summary: presence markers + last-4 only. Never echo
  // the full client_id, consumer_key, or any *_secret / *_token, since this
  // output may be relayed to chat / logs by the operator.
  const status = {
    rowId: row.id,
    platform: row.platform,
    configured: true,
    hasOAuth1:
      Boolean(row.consumerKey) &&
      Boolean(row.consumerSecretEncrypted) &&
      Boolean(row.bearerTokenEncrypted),
    hasOAuth2: Boolean(row.clientId) && Boolean(row.clientSecretEncrypted),
    clientIdLast4: last4(row.clientId),
    consumerKeyLast4: row.consumerKey ? last4(row.consumerKey) : null,
    clientSecretLast4: row.clientSecretLast4,
    consumerSecretLast4: row.consumerSecretLast4,
    bearerTokenLast4: row.bearerTokenLast4,
    defaultScopes: storedScopes,
    redirectUri: row.redirectUri,
    publicView: {
      clientIdLast4: saved.clientId ? last4(saved.clientId) : null,
      consumerKeyLast4: saved.consumerKey ? last4(saved.consumerKey) : null,
      clientSecretLast4: saved.clientSecretLast4,
      consumerSecretLast4: saved.consumerSecretLast4 ?? null,
      bearerTokenLast4: saved.bearerTokenLast4 ?? null,
      defaultScopes: saved.defaultScopes ?? null,
    },
    roundTrip: results,
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(status, null, 2));
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`[ingest-x-credentials] ${err.message ?? err}`);
  process.exit(1);
});
