/**
 * Registry of social-platform adapters. Lookup by SocialPlatform name.
 *
 * Every platform Paperclip ships gets an entry. v1 only registers the
 * adapters Tyler asked for (Instagram, X, Facebook, Threads, Reddit);
 * LinkedIn / TikTok / etc. land later behind their own adapter files.
 */
import type { SocialPlatform } from "@paperclipai/shared";
import type { SocialPlatformAdapter } from "./types.js";
import { instagramAdapter } from "./instagram.js";
import { xAdapter } from "./x.js";
import { facebookAdapter } from "./facebook.js";
import { threadsAdapter } from "./threads.js";
import { redditAdapter } from "./reddit.js";

const REGISTRY: Partial<Record<SocialPlatform, SocialPlatformAdapter>> = {
  instagram: instagramAdapter,
  twitter: xAdapter,
  facebook: facebookAdapter,
  threads: threadsAdapter,
  reddit: redditAdapter,
};

export function getSocialAdapter(platform: SocialPlatform): SocialPlatformAdapter | null {
  return REGISTRY[platform] ?? null;
}

export function listSupportedSocialPlatforms(): SocialPlatform[] {
  return Object.keys(REGISTRY) as SocialPlatform[];
}

export type { SocialPlatformAdapter, PostDraftPayload, PostValidation, PublishedPostRef } from "./types.js";
export {
  SOCIAL_FEATURE_MATRIX,
  TYLER_HOMEWORK,
  BANNED_FEATURES,
  type FeatureStatus,
  type FeatureRow,
  type HomeworkItem,
} from "./feasibility.js";
export { socialCredentialsService, type SocialCredentialsService } from "./credentials.js";
export { testCredentialFormat } from "./credential-tester.js";
export {
  encryptOAuthSecret,
  decryptOAuthSecret,
  isEncryptedEnvelope,
  last4,
  type EncryptedEnvelope,
} from "./oauth-crypto.js";
export {
  exchangeCodeForTokens,
  refreshAccessToken,
  verifyAccessToken,
  isTokenStale,
  TokenExchangeError,
  __setOAuthFetchForTesting,
  PAPERCLIP_OAUTH_USER_AGENT,
  type TokenExchangeInput,
  type TokenExchangeResult,
  type VerifyResult,
  type RefreshInput,
} from "./token-exchange.js";
export { buildConnectedAccountFromTokens } from "./connect-helpers.js";
export { ensureFreshToken } from "./freshness.js";
