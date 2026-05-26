/**
 * "Refresh-if-stale" helper that adapter publish/list paths call before
 * making a request against a platform with a stored token.
 *
 * Flow:
 *   1. `account.tokenExpiresAt` within `windowMs` → call platform's
 *      refresh-token endpoint via `refreshAccessToken()`.
 *   2. Persist the new accessToken / refreshToken / tokenExpiresAt to the
 *      `social_accounts` row.
 *   3. Return the updated SocialAccount the caller should use for the
 *      following platform call.
 *
 * If the account isn't stale, returns the input unchanged.
 *
 * If a refresh fails (TokenExchangeError), marks the row's status as
 * `"reauth_required"` and rethrows — the caller surfaces a "Reconnect"
 * action in the UI, scheduler workers mark the post target failed.
 */
import type { Db } from "@paperclipai/db";
import { socialAccounts } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import type { SocialAccount, SocialPlatform } from "@paperclipai/shared";
import { socialCredentialsService } from "./credentials.js";
import {
  TokenExchangeError,
  isTokenStale,
  refreshAccessToken,
} from "./token-exchange.js";

const DEFAULT_REFRESH_WINDOW_MS = 5 * 60_000;

export interface EnsureFreshTokenOpts {
  windowMs?: number;
  /** When true, always refresh regardless of expiry. */
  force?: boolean;
}

export async function ensureFreshToken(
  db: Db,
  account: SocialAccount,
  opts: EnsureFreshTokenOpts = {},
): Promise<SocialAccount> {
  const window = opts.windowMs ?? DEFAULT_REFRESH_WINDOW_MS;
  if (!opts.force && !isTokenStale(account.tokenExpiresAt, window)) return account;
  if (!account.accessToken) return account;

  const credentials = socialCredentialsService(db);
  const creds = await credentials.getDecrypted(account.platform as SocialPlatform);
  if (!creds) {
    // Without credentials we can't refresh — return the existing row.
    return account;
  }
  try {
    const refreshed = await refreshAccessToken({
      platform: account.platform as SocialPlatform,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      refreshToken: account.refreshToken,
      accessToken: account.accessToken,
    });
    const updated: Partial<typeof socialAccounts.$inferInsert> = {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? account.refreshToken,
      tokenExpiresAt: refreshed.expiresAt,
      updatedAt: new Date(),
    };
    await db.update(socialAccounts).set(updated).where(eq(socialAccounts.id, account.id));
    return {
      ...account,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? account.refreshToken,
      tokenExpiresAt: refreshed.expiresAt,
    };
  } catch (err) {
    if (err instanceof TokenExchangeError) {
      await db
        .update(socialAccounts)
        .set({ status: "reauth_required", updatedAt: new Date() })
        .where(eq(socialAccounts.id, account.id));
    }
    throw err;
  }
}
