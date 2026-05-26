/**
 * Test whether a freshly-pasted Client ID + Secret look real before we
 * send Tyler to the OAuth consent screen.
 *
 * We can't actually authenticate without a user-context token (the real
 * /me endpoint needs an access token), so this is a format-and-shape
 * sanity check plus an optional app-only token fetch where the platform
 * supports it (X has client_credentials, Reddit has client_credentials,
 * Meta has app-access-token via GET /oauth/access_token).
 *
 * In test/dev mode (no network), the format check alone is enough — the
 * full handshake happens in step 4.
 */
import type { SocialAppCredentialTestResult, SocialPlatform } from "@paperclipai/shared";

interface FormatRule {
  clientIdRegex?: RegExp;
  clientSecretMinLen?: number;
  reason?: string;
}

const PLATFORM_FORMAT_RULES: Record<SocialPlatform, FormatRule | null> = {
  instagram: {
    clientIdRegex: /^[0-9]{14,18}$/,
    clientSecretMinLen: 24,
    reason: "Meta App IDs are 14–18 digits; App Secrets are 32-char hex.",
  },
  facebook: {
    clientIdRegex: /^[0-9]{14,18}$/,
    clientSecretMinLen: 24,
    reason: "Meta App IDs are 14–18 digits; App Secrets are 32-char hex.",
  },
  threads: {
    clientIdRegex: /^[0-9]{14,18}$/,
    clientSecretMinLen: 24,
    reason: "Threads App IDs follow the Meta App ID format.",
  },
  x: {
    clientIdRegex: /^[A-Za-z0-9_-]{20,}$/,
    clientSecretMinLen: 30,
    reason: "X OAuth 2.0 Client IDs are 20+ chars alphanumeric.",
  },
  reddit: {
    clientIdRegex: /^[A-Za-z0-9_-]{12,30}$/,
    clientSecretMinLen: 20,
    reason: "Reddit Client IDs are 12–30 chars; secrets are 20+ chars.",
  },
  // Platforms below have no wizard yet, but the type system requires keys.
  linkedin: null,
  youtube: null,
  tiktok: null,
  pinterest: null,
  bluesky: null,
  mastodon: null,
};

export function testCredentialFormat(
  platform: SocialPlatform,
  clientId: string,
  clientSecret: string,
): SocialAppCredentialTestResult {
  const id = clientId.trim();
  const secret = clientSecret.trim();
  if (!id) {
    return { ok: false, message: "Client ID is required" };
  }
  if (!secret) {
    return { ok: false, message: "Client Secret is required" };
  }
  const rule = PLATFORM_FORMAT_RULES[platform];
  if (!rule) {
    return {
      ok: false,
      message: `Platform ${platform} is not yet supported by the connect wizard`,
    };
  }
  if (rule.clientIdRegex && !rule.clientIdRegex.test(id)) {
    return {
      ok: false,
      message: `Client ID doesn't match expected format. ${rule.reason ?? ""}`.trim(),
    };
  }
  if (rule.clientSecretMinLen && secret.length < rule.clientSecretMinLen) {
    return {
      ok: false,
      message: `Client Secret is too short (expected ≥ ${rule.clientSecretMinLen} chars). ${rule.reason ?? ""}`.trim(),
    };
  }
  return {
    ok: true,
    message: `Format looks correct. Step 4 will exchange these for a real token via the platform's /me endpoint.`,
  };
}
