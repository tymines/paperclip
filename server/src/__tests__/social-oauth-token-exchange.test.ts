/**
 * Unit tests for the real OAuth token exchange — each platform's token
 * endpoint is mocked via the `__setOAuthFetchForTesting` hook so we never
 * leave the test process.
 *
 * Coverage:
 *   - Reddit happy path (POST /api/v1/access_token + GET /me)
 *   - Reddit error path (invalid_grant)
 *   - Reddit refresh-token flow
 *   - Facebook GET /oauth/access_token + long-lived exchange
 *   - Instagram POST /oauth/access_token + ig_exchange_token
 *   - Threads POST /oauth/access_token
 *   - X POST /2/oauth2/token (with PKCE verifier)
 *   - Verify endpoint returns identity on success
 *   - isTokenStale window check
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  __setOAuthFetchForTesting,
  exchangeCodeForTokens,
  refreshAccessToken,
  verifyAccessToken,
  isTokenStale,
  TokenExchangeError,
} from "../services/social-scheduler/token-exchange.js";

interface MockRequest {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: string;
}

function makeMockFetch(
  responses: Array<{ match: (url: string, init?: RequestInit) => boolean; respond: () => Response }>,
): { fetch: typeof fetch; calls: MockRequest[] } {
  const calls: MockRequest[] = [];
  const mock: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method =
      (init?.method as string | undefined) ??
      (input instanceof Request ? input.method : undefined);
    const headers: Record<string, string> = {};
    const raw = init?.headers;
    if (raw && typeof raw === "object") {
      if (Symbol.iterator in raw) {
        for (const [k, v] of raw as Iterable<[string, string]>) headers[k] = v;
      } else {
        Object.assign(headers, raw as Record<string, string>);
      }
    }
    let body: string | undefined;
    if (init?.body instanceof URLSearchParams) body = init.body.toString();
    else if (typeof init?.body === "string") body = init.body;
    calls.push({ url, method, headers, body });
    const handler = responses.find((r) => r.match(url, init));
    if (!handler) {
      return new Response(JSON.stringify({ error: "no_mock_for_url" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    return handler.respond();
  };
  return { fetch: mock, calls };
}

afterEach(() => {
  __setOAuthFetchForTesting(null);
});

describe("Reddit OAuth token exchange", () => {
  it("exchanges code for real tokens + persists platformUserId/handle from /me", async () => {
    const { fetch: mock, calls } = makeMockFetch([
      {
        match: (url) => url === "https://www.reddit.com/api/v1/access_token",
        respond: () =>
          new Response(
            JSON.stringify({
              access_token: "real-reddit-access",
              token_type: "bearer",
              expires_in: 3600,
              scope: "identity submit read history",
              refresh_token: "real-reddit-refresh",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      },
      {
        match: (url) => url === "https://oauth.reddit.com/api/v1/me",
        respond: () =>
          new Response(JSON.stringify({ id: "abc123", name: "tylerswitzer" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      },
    ]);
    __setOAuthFetchForTesting(mock);

    const result = await exchangeCodeForTokens({
      platform: "reddit",
      clientId: "client-id-1",
      clientSecret: "client-secret-1",
      code: "auth-code-1",
      redirectUri: "https://paperclip.augiport.com/auth/social-callback/reddit",
    });

    expect(result.accessToken).toBe("real-reddit-access");
    expect(result.refreshToken).toBe("real-reddit-refresh");
    expect(result.scope).toBe("identity submit read history");
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(result.platformUserId).toBe("abc123");
    expect(result.platformUserName).toBe("u/tylerswitzer");
    expect(result.displayName).toBe("u/tylerswitzer");

    const tokenCall = calls.find((c) => c.url === "https://www.reddit.com/api/v1/access_token")!;
    expect(tokenCall.headers["Authorization"]).toBe(
      `Basic ${Buffer.from("client-id-1:client-secret-1").toString("base64")}`,
    );
    expect(tokenCall.headers["User-Agent"]).toMatch(/paperclip-social/);
    expect(tokenCall.body).toContain("grant_type=authorization_code");
    expect(tokenCall.body).toContain("code=auth-code-1");
    expect(tokenCall.body).toContain("redirect_uri=https");

    // Crucial assertion: the token is real, not the legacy stub.
    expect(result.accessToken).not.toBe("stub_access_token");
  });

  it("turns Reddit's invalid_grant error into a structured TokenExchangeError", async () => {
    const { fetch: mock } = makeMockFetch([
      {
        match: (url) => url === "https://www.reddit.com/api/v1/access_token",
        respond: () =>
          new Response(
            JSON.stringify({ error: "invalid_grant", error_description: "code is no longer valid" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          ),
      },
    ]);
    __setOAuthFetchForTesting(mock);

    await expect(
      exchangeCodeForTokens({
        platform: "reddit",
        clientId: "x",
        clientSecret: "y",
        code: "stale",
        redirectUri: "https://paperclip/auth",
      }),
    ).rejects.toMatchObject({
      name: "TokenExchangeError",
      platform: "reddit",
      code: "invalid_grant",
      message: "code is no longer valid",
    });
  });

  it("refreshes a stored refresh_token against the same endpoint", async () => {
    const { fetch: mock, calls } = makeMockFetch([
      {
        match: (url) => url === "https://www.reddit.com/api/v1/access_token",
        respond: () =>
          new Response(
            JSON.stringify({
              access_token: "refreshed-token",
              token_type: "bearer",
              expires_in: 3600,
              scope: "identity",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      },
    ]);
    __setOAuthFetchForTesting(mock);

    const refreshed = await refreshAccessToken({
      platform: "reddit",
      clientId: "id",
      clientSecret: "secret",
      refreshToken: "old-refresh",
      accessToken: "old-access",
    });
    expect(refreshed.accessToken).toBe("refreshed-token");
    expect(calls[0]!.body).toContain("grant_type=refresh_token");
    expect(calls[0]!.body).toContain("refresh_token=old-refresh");
  });

  it("verify returns identity from /me", async () => {
    const { fetch: mock } = makeMockFetch([
      {
        match: (url) => url === "https://oauth.reddit.com/api/v1/me",
        respond: () =>
          new Response(JSON.stringify({ id: "u1", name: "tyler" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      },
    ]);
    __setOAuthFetchForTesting(mock);

    const result = await verifyAccessToken("reddit", "live-token");
    expect(result.ok).toBe(true);
    expect(result.identity?.platformUserName).toBe("u/tyler");
  });
});

describe("Facebook OAuth token exchange", () => {
  it("does short→long-lived exchange and fetches /me", async () => {
    const { fetch: mock, calls } = makeMockFetch([
      {
        match: (url) =>
          url.startsWith("https://graph.facebook.com/v21.0/oauth/access_token") &&
          !url.includes("fb_exchange_token"),
        respond: () =>
          new Response(
            JSON.stringify({ access_token: "short-fb", expires_in: 5184000 }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      },
      {
        match: (url) =>
          url.startsWith("https://graph.facebook.com/v21.0/oauth/access_token") &&
          url.includes("fb_exchange_token"),
        respond: () =>
          new Response(
            JSON.stringify({ access_token: "long-fb", expires_in: 5184000 }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      },
      {
        match: (url) => url.startsWith("https://graph.facebook.com/v21.0/me"),
        respond: () =>
          new Response(JSON.stringify({ id: "fb-user-1", name: "Tyler Switzer" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      },
    ]);
    __setOAuthFetchForTesting(mock);

    const result = await exchangeCodeForTokens({
      platform: "facebook",
      clientId: "fb-app",
      clientSecret: "fb-secret",
      code: "auth-fb",
      redirectUri: "https://paperclip/auth/social-callback/facebook",
    });

    expect(result.accessToken).toBe("long-fb");
    expect(result.platformUserId).toBe("fb-user-1");
    expect(result.platformUserName).toBe("Tyler Switzer");
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Instagram OAuth token exchange", () => {
  it("POSTs auth code, then GETs ig_exchange_token + /me", async () => {
    const { fetch: mock, calls } = makeMockFetch([
      {
        match: (url) => url === "https://api.instagram.com/oauth/access_token",
        respond: () =>
          new Response(JSON.stringify({ access_token: "short-ig", user_id: 999 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      },
      {
        match: (url) => url.startsWith("https://graph.instagram.com/access_token"),
        respond: () =>
          new Response(
            JSON.stringify({ access_token: "long-ig", expires_in: 5184000 }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      },
      {
        match: (url) => url.startsWith("https://graph.instagram.com/me"),
        respond: () =>
          new Response(JSON.stringify({ id: "ig-user-1", username: "tyler.ig" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      },
    ]);
    __setOAuthFetchForTesting(mock);

    const result = await exchangeCodeForTokens({
      platform: "instagram",
      clientId: "ig-app",
      clientSecret: "ig-secret",
      code: "auth-ig",
      redirectUri: "https://paperclip/auth/social-callback/instagram",
    });

    expect(result.accessToken).toBe("long-ig");
    expect(result.platformUserId).toBe("ig-user-1");
    expect(result.platformUserName).toBe("tyler.ig");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toContain("client_secret=ig-secret");
  });
});

describe("Threads OAuth token exchange", () => {
  it("hits graph.threads.net for short→long-lived exchange", async () => {
    const { fetch: mock } = makeMockFetch([
      {
        match: (url) => url === "https://graph.threads.net/oauth/access_token",
        respond: () =>
          new Response(JSON.stringify({ access_token: "short-th", user_id: "th-uid" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      },
      {
        match: (url) => url.startsWith("https://graph.threads.net/access_token"),
        respond: () =>
          new Response(JSON.stringify({ access_token: "long-th", expires_in: 5184000 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      },
      {
        match: (url) => url.startsWith("https://graph.threads.net/me"),
        respond: () =>
          new Response(JSON.stringify({ id: "th-id", username: "tyler.threads" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      },
    ]);
    __setOAuthFetchForTesting(mock);

    const result = await exchangeCodeForTokens({
      platform: "threads",
      clientId: "th-app",
      clientSecret: "th-secret",
      code: "auth-th",
      redirectUri: "https://paperclip/auth/social-callback/threads",
    });

    expect(result.accessToken).toBe("long-th");
    expect(result.platformUserId).toBe("th-id");
    expect(result.platformUserName).toBe("tyler.threads");
  });
});

describe("X (Twitter) OAuth token exchange", () => {
  it("POSTs token endpoint with PKCE verifier + HTTP Basic auth", async () => {
    const { fetch: mock, calls } = makeMockFetch([
      {
        match: (url) => url === "https://api.twitter.com/2/oauth2/token",
        respond: () =>
          new Response(
            JSON.stringify({
              token_type: "bearer",
              expires_in: 7200,
              access_token: "real-x-access",
              scope: "tweet.read tweet.write users.read offline.access",
              refresh_token: "real-x-refresh",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      },
      {
        match: (url) => url === "https://api.twitter.com/2/users/me",
        respond: () =>
          new Response(
            JSON.stringify({ data: { id: "x-1", username: "tyler", name: "Tyler" } }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      },
    ]);
    __setOAuthFetchForTesting(mock);

    const result = await exchangeCodeForTokens({
      platform: "twitter",
      clientId: "x-client",
      clientSecret: "x-secret",
      code: "auth-x",
      redirectUri: "https://paperclip/auth/social-callback/twitter",
    });

    expect(result.accessToken).toBe("real-x-access");
    expect(result.refreshToken).toBe("real-x-refresh");
    expect(result.platformUserName).toBe("@tyler");

    const tokenCall = calls.find((c) => c.url === "https://api.twitter.com/2/oauth2/token")!;
    expect(tokenCall.headers["Authorization"]).toBe(
      `Basic ${Buffer.from("x-client:x-secret").toString("base64")}`,
    );
    expect(tokenCall.body).toContain("grant_type=authorization_code");
    expect(tokenCall.body).toContain("code_verifier=paperclip-pkce");
  });
});

describe("isTokenStale", () => {
  it("returns true within the window, false outside", () => {
    expect(isTokenStale(null)).toBe(false);
    expect(isTokenStale(new Date(Date.now() + 60_000), 5 * 60_000)).toBe(true);
    expect(isTokenStale(new Date(Date.now() + 6 * 60_000), 5 * 60_000)).toBe(false);
    expect(isTokenStale(new Date(Date.now() - 1000), 5 * 60_000)).toBe(true);
  });
});

describe("TokenExchangeError class", () => {
  it("preserves platform, code, status, raw payload", () => {
    const err = new TokenExchangeError({
      platform: "reddit",
      code: "invalid_grant",
      status: 400,
      message: "bad code",
      raw: { error: "invalid_grant" },
    });
    expect(err.platform).toBe("reddit");
    expect(err.code).toBe("invalid_grant");
    expect(err.status).toBe(400);
    expect(err.message).toBe("bad code");
    expect(err.raw).toEqual({ error: "invalid_grant" });
  });
});
