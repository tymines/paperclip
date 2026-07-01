/**
 * Real OAuth token-exchange + verify + refresh helpers, one config per
 * platform.
 *
 * Adapters delegate the actual HTTP work to this file so each per-platform
 * file stays small. The `social-callback` route calls `exchangeCodeForTokens`
 * on the wizard return-trip, persists the resulting fields on the
 * `social_accounts` row, and uses `verifyAccessToken` + `refreshAccessToken`
 * for the verify-endpoint and the every-publish freshness check
 * respectively.
 *
 * Each platform has its own quirks (Basic-auth vs body credentials, GET vs
 * POST, long-lived-exchange follow-up call) — the per-platform branches
 * below document each one inline.
 */
import type { SocialPlatform } from "@paperclipai/shared";

type FetchFn = typeof fetch;
let injectedFetch: FetchFn | null = null;
export function __setOAuthFetchForTesting(f: FetchFn | null) {
  injectedFetch = f;
}
function getFetch(): FetchFn {
  return injectedFetch ?? fetch;
}

export const PAPERCLIP_OAUTH_USER_AGENT = "paperclip-social/1.0 (+https://paperclip.augiport.com)";
const X_PKCE_VERIFIER = "paperclip-pkce";

export interface TokenExchangeInput {
  platform: SocialPlatform;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}

export interface TokenExchangeResult {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
  platformUserId: string | null;
  platformUserName: string | null;
  displayName: string | null;
  raw: Record<string, unknown>;
}

export interface VerifyResult {
  ok: boolean;
  identity: {
    platformUserId: string | null;
    platformUserName: string | null;
    displayName: string | null;
  } | null;
  error?: string;
  status?: number;
}

export class TokenExchangeError extends Error {
  readonly code: string;
  readonly status: number;
  readonly platform: SocialPlatform;
  readonly raw: unknown;
  constructor(opts: {
    platform: SocialPlatform;
    code: string;
    status: number;
    message: string;
    raw?: unknown;
  }) {
    super(opts.message);
    this.name = "TokenExchangeError";
    this.platform = opts.platform;
    this.code = opts.code;
    this.status = opts.status;
    this.raw = opts.raw ?? null;
  }
}

function toExpiresAt(expiresIn: unknown): Date | null {
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) return null;
  return new Date(Date.now() + expiresIn * 1000);
}

function pickString(record: Record<string, unknown>, key: string): string | null {
  const v = record[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

async function parseJsonResponse(
  res: Response,
  platform: SocialPlatform,
): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) {
    if (!res.ok) {
      throw new TokenExchangeError({
        platform,
        code: "empty_response",
        status: res.status,
        message: `${platform} returned an empty ${res.status} response`,
      });
    }
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TokenExchangeError({
      platform,
      code: "non_json_response",
      status: res.status,
      message: `${platform} returned a non-JSON response (status ${res.status})`,
      raw: text.slice(0, 400),
    });
  }
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  if (!res.ok || typeof obj.error === "string") {
    const code = typeof obj.error === "string" ? (obj.error as string) : `http_${res.status}`;
    const message =
      pickString(obj, "error_description") ??
      pickString(obj, "message") ??
      pickString(obj, "error") ??
      `${platform} token endpoint returned ${res.status}`;
    throw new TokenExchangeError({ platform, code, status: res.status, message, raw: obj });
  }
  return obj;
}

/* ── Reddit ─────────────────────────────────────────────────────────────── */
// Token: POST https://www.reddit.com/api/v1/access_token
// Auth: HTTP Basic = base64(clientId:clientSecret)
// User-Agent header REQUIRED.
// Body: grant_type=authorization_code & code & redirect_uri
// Refresh token only returned when authorize URL was duration=permanent.
// /me: GET https://oauth.reddit.com/api/v1/me

async function exchangeReddit(input: TokenExchangeInput): Promise<TokenExchangeResult> {
  const basic = Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
  });
  const res = await getFetch()("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": PAPERCLIP_OAUTH_USER_AGENT,
    },
    body,
  });
  const json = await parseJsonResponse(res, "reddit");
  const accessToken = pickString(json, "access_token");
  if (!accessToken) {
    throw new TokenExchangeError({
      platform: "reddit",
      code: "missing_access_token",
      status: res.status,
      message: "Reddit token response did not include an access_token",
      raw: json,
    });
  }
  const identity = await fetchRedditIdentity(accessToken);
  return {
    accessToken,
    refreshToken: pickString(json, "refresh_token"),
    expiresAt: toExpiresAt(json.expires_in),
    scope: pickString(json, "scope"),
    platformUserId: identity?.platformUserId ?? null,
    platformUserName: identity?.platformUserName ?? null,
    displayName: identity?.displayName ?? null,
    raw: json,
  };
}

async function fetchRedditIdentity(
  accessToken: string,
): Promise<{ platformUserId: string; platformUserName: string; displayName: string } | null> {
  const res = await getFetch()("https://oauth.reddit.com/api/v1/me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": PAPERCLIP_OAUTH_USER_AGENT,
    },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as Record<string, unknown>;
  const name = pickString(json, "name");
  if (!name) return null;
  return {
    platformUserId: pickString(json, "id") ?? name,
    platformUserName: `u/${name}`,
    displayName: pickString(json, "subreddit_display_name") ?? `u/${name}`,
  };
}

async function refreshReddit(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<TokenExchangeResult> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await getFetch()("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": PAPERCLIP_OAUTH_USER_AGENT,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  const json = await parseJsonResponse(res, "reddit");
  const accessToken = pickString(json, "access_token");
  if (!accessToken) {
    throw new TokenExchangeError({
      platform: "reddit",
      code: "missing_access_token",
      status: res.status,
      message: "Reddit refresh response did not include an access_token",
      raw: json,
    });
  }
  return {
    accessToken,
    refreshToken: pickString(json, "refresh_token") ?? refreshToken,
    expiresAt: toExpiresAt(json.expires_in),
    scope: pickString(json, "scope"),
    platformUserId: null,
    platformUserName: null,
    displayName: null,
    raw: json,
  };
}

async function verifyReddit(accessToken: string): Promise<VerifyResult> {
  const identity = await fetchRedditIdentity(accessToken);
  if (!identity) {
    return { ok: false, identity: null, error: "Reddit /me returned a non-OK status" };
  }
  return { ok: true, identity };
}

/* ── Facebook (Graph) ───────────────────────────────────────────────────── */

const FB_GRAPH = "https://graph.facebook.com/v21.0";

async function exchangeFacebook(input: TokenExchangeInput): Promise<TokenExchangeResult> {
  const tokenUrl = new URL(`${FB_GRAPH}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", input.clientId);
  tokenUrl.searchParams.set("redirect_uri", input.redirectUri);
  tokenUrl.searchParams.set("client_secret", input.clientSecret);
  tokenUrl.searchParams.set("code", input.code);
  const shortRes = await getFetch()(tokenUrl, { method: "GET" });
  const shortJson = await parseJsonResponse(shortRes, "facebook");
  const shortToken = pickString(shortJson, "access_token");
  if (!shortToken) {
    throw new TokenExchangeError({
      platform: "facebook",
      code: "missing_access_token",
      status: shortRes.status,
      message: "Facebook token response did not include an access_token",
      raw: shortJson,
    });
  }
  const longUrl = new URL(`${FB_GRAPH}/oauth/access_token`);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", input.clientId);
  longUrl.searchParams.set("client_secret", input.clientSecret);
  longUrl.searchParams.set("fb_exchange_token", shortToken);
  let token = shortToken;
  let expiresInRaw: unknown = shortJson.expires_in;
  let raw: Record<string, unknown> = shortJson;
  try {
    const longRes = await getFetch()(longUrl, { method: "GET" });
    if (longRes.ok) {
      const longJson = (await longRes.json()) as Record<string, unknown>;
      const longToken = pickString(longJson, "access_token");
      if (longToken) {
        token = longToken;
        expiresInRaw = longJson.expires_in ?? expiresInRaw;
        raw = { short: shortJson, long: longJson };
      }
    }
  } catch {
    /* keep short-lived */
  }
  const identity = await fetchFacebookIdentity(token);
  return {
    accessToken: token,
    refreshToken: null,
    expiresAt: toExpiresAt(expiresInRaw),
    scope: pickString(shortJson, "scope"),
    platformUserId: identity?.platformUserId ?? null,
    platformUserName: identity?.platformUserName ?? null,
    displayName: identity?.displayName ?? null,
    raw,
  };
}

async function fetchFacebookIdentity(
  accessToken: string,
): Promise<{ platformUserId: string; platformUserName: string; displayName: string } | null> {
  const url = new URL(`${FB_GRAPH}/me`);
  url.searchParams.set("fields", "id,name");
  url.searchParams.set("access_token", accessToken);
  const res = await getFetch()(url, { method: "GET" });
  if (!res.ok) return null;
  const json = (await res.json()) as Record<string, unknown>;
  const id = pickString(json, "id");
  const name = pickString(json, "name") ?? id ?? "";
  if (!id) return null;
  return { platformUserId: id, platformUserName: name, displayName: name };
}

async function verifyFacebook(accessToken: string): Promise<VerifyResult> {
  const identity = await fetchFacebookIdentity(accessToken);
  if (!identity) return { ok: false, identity: null, error: "Facebook /me returned a non-OK status" };
  return { ok: true, identity };
}

/* ── Instagram (IG with FB Login) ───────────────────────────────────────── */

async function exchangeInstagram(input: TokenExchangeInput): Promise<TokenExchangeResult> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri,
    code: input.code,
  });
  const shortRes = await getFetch()("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const shortJson = await parseJsonResponse(shortRes, "instagram");
  const shortToken = pickString(shortJson, "access_token");
  if (!shortToken) {
    throw new TokenExchangeError({
      platform: "instagram",
      code: "missing_access_token",
      status: shortRes.status,
      message: "Instagram token response did not include an access_token",
      raw: shortJson,
    });
  }
  const longUrl = new URL("https://graph.instagram.com/access_token");
  longUrl.searchParams.set("grant_type", "ig_exchange_token");
  longUrl.searchParams.set("client_secret", input.clientSecret);
  longUrl.searchParams.set("access_token", shortToken);
  let token = shortToken;
  let expiresInRaw: unknown = shortJson.expires_in ?? 3600;
  let raw: Record<string, unknown> = shortJson;
  try {
    const longRes = await getFetch()(longUrl, { method: "GET" });
    if (longRes.ok) {
      const longJson = (await longRes.json()) as Record<string, unknown>;
      const longToken = pickString(longJson, "access_token");
      if (longToken) {
        token = longToken;
        expiresInRaw = longJson.expires_in ?? expiresInRaw;
        raw = { short: shortJson, long: longJson };
      }
    }
  } catch {
    /* keep short-lived */
  }
  const identity = await fetchInstagramIdentity(token);
  return {
    accessToken: token,
    refreshToken: null,
    expiresAt: toExpiresAt(expiresInRaw),
    scope: pickString(shortJson, "scope"),
    platformUserId:
      identity?.platformUserId ??
      (typeof shortJson.user_id === "number" || typeof shortJson.user_id === "string"
        ? String(shortJson.user_id)
        : null),
    platformUserName: identity?.platformUserName ?? null,
    displayName: identity?.displayName ?? null,
    raw,
  };
}

async function fetchInstagramIdentity(
  accessToken: string,
): Promise<{ platformUserId: string; platformUserName: string; displayName: string } | null> {
  const url = new URL("https://graph.instagram.com/me");
  url.searchParams.set("fields", "id,username");
  url.searchParams.set("access_token", accessToken);
  const res = await getFetch()(url, { method: "GET" });
  if (!res.ok) return null;
  const json = (await res.json()) as Record<string, unknown>;
  const id = pickString(json, "id");
  const username = pickString(json, "username") ?? id ?? "";
  if (!id) return null;
  return { platformUserId: id, platformUserName: username, displayName: username };
}

async function verifyInstagram(accessToken: string): Promise<VerifyResult> {
  const identity = await fetchInstagramIdentity(accessToken);
  if (!identity) return { ok: false, identity: null, error: "Instagram /me returned a non-OK status" };
  return { ok: true, identity };
}

async function refreshInstagram(accessToken: string): Promise<TokenExchangeResult> {
  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", accessToken);
  const res = await getFetch()(url, { method: "GET" });
  const json = await parseJsonResponse(res, "instagram");
  const token = pickString(json, "access_token");
  if (!token) {
    throw new TokenExchangeError({
      platform: "instagram",
      code: "missing_access_token",
      status: res.status,
      message: "Instagram refresh response did not include an access_token",
      raw: json,
    });
  }
  return {
    accessToken: token,
    refreshToken: null,
    expiresAt: toExpiresAt(json.expires_in ?? 5_184_000),
    scope: null,
    platformUserId: null,
    platformUserName: null,
    displayName: null,
    raw: json,
  };
}

/* ── Threads (graph.threads.net) ────────────────────────────────────────── */

async function exchangeThreads(input: TokenExchangeInput): Promise<TokenExchangeResult> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri,
    code: input.code,
  });
  const shortRes = await getFetch()("https://graph.threads.net/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const shortJson = await parseJsonResponse(shortRes, "threads");
  const shortToken = pickString(shortJson, "access_token");
  if (!shortToken) {
    throw new TokenExchangeError({
      platform: "threads",
      code: "missing_access_token",
      status: shortRes.status,
      message: "Threads token response did not include an access_token",
      raw: shortJson,
    });
  }
  const longUrl = new URL("https://graph.threads.net/access_token");
  longUrl.searchParams.set("grant_type", "th_exchange_token");
  longUrl.searchParams.set("client_secret", input.clientSecret);
  longUrl.searchParams.set("access_token", shortToken);
  let token = shortToken;
  let expiresInRaw: unknown = shortJson.expires_in ?? 3600;
  let raw: Record<string, unknown> = shortJson;
  try {
    const longRes = await getFetch()(longUrl, { method: "GET" });
    if (longRes.ok) {
      const longJson = (await longRes.json()) as Record<string, unknown>;
      const longToken = pickString(longJson, "access_token");
      if (longToken) {
        token = longToken;
        expiresInRaw = longJson.expires_in ?? expiresInRaw;
        raw = { short: shortJson, long: longJson };
      }
    }
  } catch {
    /* keep short-lived */
  }
  const identity = await fetchThreadsIdentity(token);
  return {
    accessToken: token,
    refreshToken: null,
    expiresAt: toExpiresAt(expiresInRaw),
    scope: pickString(shortJson, "scope"),
    platformUserId:
      identity?.platformUserId ??
      (typeof shortJson.user_id === "number" || typeof shortJson.user_id === "string"
        ? String(shortJson.user_id)
        : null),
    platformUserName: identity?.platformUserName ?? null,
    displayName: identity?.displayName ?? null,
    raw,
  };
}

async function fetchThreadsIdentity(
  accessToken: string,
): Promise<{ platformUserId: string; platformUserName: string; displayName: string } | null> {
  const url = new URL("https://graph.threads.net/me");
  url.searchParams.set("fields", "id,username");
  url.searchParams.set("access_token", accessToken);
  const res = await getFetch()(url, { method: "GET" });
  if (!res.ok) return null;
  const json = (await res.json()) as Record<string, unknown>;
  const id = pickString(json, "id");
  const username = pickString(json, "username") ?? id ?? "";
  if (!id) return null;
  return { platformUserId: id, platformUserName: username, displayName: username };
}

async function verifyThreads(accessToken: string): Promise<VerifyResult> {
  const identity = await fetchThreadsIdentity(accessToken);
  if (!identity) return { ok: false, identity: null, error: "Threads /me returned a non-OK status" };
  return { ok: true, identity };
}

async function refreshThreads(accessToken: string): Promise<TokenExchangeResult> {
  const url = new URL("https://graph.threads.net/refresh_access_token");
  url.searchParams.set("grant_type", "th_refresh_token");
  url.searchParams.set("access_token", accessToken);
  const res = await getFetch()(url, { method: "GET" });
  const json = await parseJsonResponse(res, "threads");
  const token = pickString(json, "access_token");
  if (!token) {
    throw new TokenExchangeError({
      platform: "threads",
      code: "missing_access_token",
      status: res.status,
      message: "Threads refresh response did not include an access_token",
      raw: json,
    });
  }
  return {
    accessToken: token,
    refreshToken: null,
    expiresAt: toExpiresAt(json.expires_in ?? 5_184_000),
    scope: null,
    platformUserId: null,
    platformUserName: null,
    displayName: null,
    raw: json,
  };
}

/* ── X (v2 OAuth2 / PKCE) ───────────────────────────────────────────────── */

async function exchangeX(input: TokenExchangeInput): Promise<TokenExchangeResult> {
  const basic = Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: X_PKCE_VERIFIER,
    client_id: input.clientId,
  });
  const res = await getFetch()("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = await parseJsonResponse(res, "x");
  const accessToken = pickString(json, "access_token");
  if (!accessToken) {
    throw new TokenExchangeError({
      platform: "x",
      code: "missing_access_token",
      status: res.status,
      message: "X token response did not include an access_token",
      raw: json,
    });
  }
  const identity = await fetchXIdentity(accessToken);
  return {
    accessToken,
    refreshToken: pickString(json, "refresh_token"),
    expiresAt: toExpiresAt(json.expires_in),
    scope: pickString(json, "scope"),
    platformUserId: identity?.platformUserId ?? null,
    platformUserName: identity?.platformUserName ?? null,
    displayName: identity?.displayName ?? null,
    raw: json,
  };
}

async function fetchXIdentity(
  accessToken: string,
): Promise<{ platformUserId: string; platformUserName: string; displayName: string } | null> {
  const res = await getFetch()("https://api.twitter.com/2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const wrapper = (await res.json()) as { data?: Record<string, unknown> };
  const data = wrapper.data ?? null;
  if (!data) return null;
  const id = pickString(data, "id");
  if (!id) return null;
  const username = pickString(data, "username") ?? id;
  const displayName = pickString(data, "name") ?? username;
  return {
    platformUserId: id,
    platformUserName: username.startsWith("@") ? username : `@${username}`,
    displayName,
  };
}

async function refreshX(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<TokenExchangeResult> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await getFetch()("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }),
  });
  const json = await parseJsonResponse(res, "x");
  const accessToken = pickString(json, "access_token");
  if (!accessToken) {
    throw new TokenExchangeError({
      platform: "x",
      code: "missing_access_token",
      status: res.status,
      message: "X refresh response did not include an access_token",
      raw: json,
    });
  }
  return {
    accessToken,
    refreshToken: pickString(json, "refresh_token") ?? refreshToken,
    expiresAt: toExpiresAt(json.expires_in),
    scope: pickString(json, "scope"),
    platformUserId: null,
    platformUserName: null,
    displayName: null,
    raw: json,
  };
}

async function verifyX(accessToken: string): Promise<VerifyResult> {
  const identity = await fetchXIdentity(accessToken);
  if (!identity) return { ok: false, identity: null, error: "X /users/me returned a non-OK status" };
  return { ok: true, identity };
}

/* ── Dispatchers ────────────────────────────────────────────────────────── */

export async function exchangeCodeForTokens(input: TokenExchangeInput): Promise<TokenExchangeResult> {
  switch (input.platform) {
    case "reddit": return exchangeReddit(input);
    case "facebook": return exchangeFacebook(input);
    case "instagram": return exchangeInstagram(input);
    case "threads": return exchangeThreads(input);
    case "x": return exchangeX(input);
    default:
      throw new TokenExchangeError({
        platform: input.platform,
        code: "unsupported_platform",
        status: 0,
        message: `Token exchange not yet implemented for ${input.platform}`,
      });
  }
}

export async function verifyAccessToken(
  platform: SocialPlatform,
  accessToken: string,
): Promise<VerifyResult> {
  switch (platform) {
    case "reddit": return verifyReddit(accessToken);
    case "facebook": return verifyFacebook(accessToken);
    case "instagram": return verifyInstagram(accessToken);
    case "threads": return verifyThreads(accessToken);
    case "x": return verifyX(accessToken);
    default:
      return { ok: false, identity: null, error: `verify not implemented for ${platform}` };
  }
}

export interface RefreshInput {
  platform: SocialPlatform;
  clientId: string;
  clientSecret: string;
  refreshToken: string | null;
  accessToken: string;
}

export async function refreshAccessToken(input: RefreshInput): Promise<TokenExchangeResult> {
  switch (input.platform) {
    case "reddit":
      if (!input.refreshToken) {
        throw new TokenExchangeError({
          platform: "reddit",
          code: "no_refresh_token",
          status: 0,
          message: "Reddit refresh requires duration=permanent at authorize-time (no refresh_token stored).",
        });
      }
      return refreshReddit(input.clientId, input.clientSecret, input.refreshToken);
    case "x":
      if (!input.refreshToken) {
        throw new TokenExchangeError({
          platform: "x",
          code: "no_refresh_token",
          status: 0,
          message: "X requires offline.access scope to receive a refresh_token (none stored).",
        });
      }
      return refreshX(input.clientId, input.clientSecret, input.refreshToken);
    case "instagram":
      return refreshInstagram(input.accessToken);
    case "threads":
      return refreshThreads(input.accessToken);
    case "facebook":
      // Facebook long-lived user tokens last ~60d and cannot be refreshed in
      // the OAuth2 sense — Tyler must reconnect when they expire. Page
      // tokens derived from a long-lived user token never expire as long as
      // the user token is still valid.
      throw new TokenExchangeError({
        platform: "facebook",
        code: "not_refreshable",
        status: 0,
        message: "Facebook long-lived tokens are not refreshable — reconnect the Page when expired.",
      });
    default:
      throw new TokenExchangeError({
        platform: input.platform,
        code: "unsupported_platform",
        status: 0,
        message: `Refresh not yet implemented for ${input.platform}`,
      });
  }
}

/** Returns true when an access token will expire within `windowMs` (default 5 min). */
export function isTokenStale(expiresAt: Date | null | undefined, windowMs = 5 * 60_000): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() - Date.now() <= windowMs;
}
