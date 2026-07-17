/**
 * Shared error types for the social-scheduler adapters.
 *
 * `BlockedNoCredentialError` is the data-honesty backbone of the publish
 * pipeline: an adapter throws it (instead of returning a fake success) when
 * the account it was handed has no real platform credential — a legacy
 * stub row (`metadata.stub === true` / the `"stub_access_token"` sentinel)
 * or a missing access token. The scheduler worker catches it and marks the
 * target `blocked` (terminal, no retries) with an errorMessage prefixed
 * `blocked_no_credential: ` so the UI can point at the connect wizard
 * rather than burning retry attempts on a call that can never succeed.
 *
 * `NotSupportedError` is thrown by adapter methods whose real implementation
 * lives elsewhere (e.g. `startConnect`/`finishConnect` — the wizard flow in
 * `routes/social.ts` + `token-exchange.ts` is the only real connect path) or
 * doesn't exist yet. It replaces the legacy stub implementations that used
 * to fabricate `@stub_x_handle`-style accounts.
 */
import type { SocialAccount, SocialPlatform } from "@paperclipai/shared";

/** Sentinel token the legacy stub connect flow wrote to `social_accounts`. */
export const STUB_ACCESS_TOKEN = "stub_access_token";

export class BlockedNoCredentialError extends Error {
  readonly platform: SocialPlatform;
  readonly statusCode = 401;
  constructor(platform: SocialPlatform, detail: string) {
    super(`${platform}: ${detail}`);
    this.name = "BlockedNoCredentialError";
    this.platform = platform;
  }
}

export class NotSupportedError extends Error {
  readonly statusCode = 501;
  constructor(message: string) {
    super(message);
    this.name = "NotSupportedError";
  }
}

/**
 * True when the account row carries a real platform token — i.e. it was NOT
 * written by the legacy stub connect flow and has a non-empty access token.
 */
export function hasRealAccessToken(account: SocialAccount): boolean {
  if (!account.accessToken || account.accessToken === STUB_ACCESS_TOKEN) return false;
  const meta = (account.metadata ?? {}) as Record<string, unknown>;
  return meta.stub !== true;
}

/**
 * Returns the account's real access token or throws
 * `BlockedNoCredentialError`. Every real adapter API path calls this first.
 */
export function requireRealAccessToken(account: SocialAccount, action: string): string {
  if (!hasRealAccessToken(account)) {
    throw new BlockedNoCredentialError(
      account.platform,
      `cannot ${action} — account "${account.displayName}" has no real access token. ` +
        "Connect the account through the Social connect wizard.",
    );
  }
  return account.accessToken as string;
}
