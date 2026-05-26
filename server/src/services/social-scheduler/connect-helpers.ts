/**
 * Adapter-side glue that turns a real `TokenExchangeResult` from
 * `token-exchange.ts` into a `SocialAccount` row the
 * `socialService.createAccount` write path accepts.
 *
 * Kept separate from `stub-helpers.ts` on purpose — stub helpers are the
 * legacy fixture-only path; this file is the real one.
 */
import { randomUUID } from "node:crypto";
import type { SocialAccount, SocialPlatform } from "@paperclipai/shared";
import type { TokenExchangeResult } from "./token-exchange.js";

export interface BuildConnectedAccountOpts {
  platform: SocialPlatform;
  companyId: string;
  tokens: TokenExchangeResult;
  fallbackUsername?: string;
  fallbackDisplayName?: string;
  metadata?: Record<string, unknown>;
}

export function buildConnectedAccountFromTokens(opts: BuildConnectedAccountOpts): SocialAccount {
  const { platform, companyId, tokens, fallbackUsername, fallbackDisplayName, metadata } = opts;
  const now = new Date();
  const username = tokens.platformUserName ?? fallbackUsername ?? null;
  const displayName = tokens.displayName ?? fallbackDisplayName ?? username ?? `${platform} account`;
  const platformAccountId = tokens.platformUserId ?? username ?? `${platform}-${randomUUID().slice(0, 8)}`;
  return {
    id: randomUUID(),
    companyId,
    platform,
    platformAccountId,
    displayName,
    username,
    avatarUrl:
      username != null
        ? `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(username)}`
        : null,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenExpiresAt: tokens.expiresAt,
    status: "connected",
    metadata: {
      connectMethod: "wizard",
      scope: tokens.scope,
      ...(metadata ?? {}),
    },
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  };
}
