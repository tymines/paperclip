/**
 * Reddit adapter — publish + verify, with `fetch` mocked at the global.
 *
 * Covers:
 *  - Stub-token path is data-honest: publishPost throws
 *    BlockedNoCredentialError (the scheduler marks the target `blocked`)
 *    and verify refuses to synthesize a profile — no fake successes.
 *  - Real-token self-post hits POST oauth.reddit.com/api/submit with the
 *    correct headers + body and unwraps Reddit's JSON-of-JSON envelope.
 *  - Real-token link post sets kind=link + url.
 *  - Image posts are explicitly not yet implemented and throw 501.
 *  - 429 surfaces as RedditRateLimitError with the Retry-After seconds so
 *    the scheduler can back off.
 *  - Reddit's `json.errors` rejection paths surface as RedditApiError.
 *  - verifyRedditAccount() calls /api/v1/me with bearer auth + the
 *    Paperclip User-Agent and returns {name, link_karma, comment_karma}.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialAccount } from "@paperclipai/shared";
import {
  redditAdapter,
  RedditApiError,
  RedditRateLimitError,
  verifyRedditAccount,
} from "../services/social-scheduler/reddit.js";
import { BlockedNoCredentialError } from "../services/social-scheduler/errors.js";
import type { PostDraftPayload } from "../services/social-scheduler/types.js";

const REAL_TOKEN = "real_reddit_bearer_xyz";

function fakeAccount(overrides: Partial<SocialAccount> = {}): SocialAccount {
  const now = new Date();
  return {
    id: "acct-1",
    companyId: "co-1",
    platform: "reddit",
    platformAccountId: "reddit-abc",
    displayName: "u/tylerswitzer19",
    username: "tylerswitzer19",
    avatarUrl: null,
    accessToken: REAL_TOKEN,
    refreshToken: "refresh-xyz",
    tokenExpiresAt: new Date(now.getTime() + 3600_000),
    status: "connected",
    metadata: null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function selfPost(overrides: Partial<PostDraftPayload> = {}): PostDraftPayload {
  return {
    baseCaption: "Hello reddit, this is the body of the post.",
    caption: null,
    postType: "text",
    mediaUrls: [],
    metadata: { title: "Saying hi from Paperclip", subreddit: "test" },
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function rateLimitedResponse(retryAfter = 17): Response {
  return new Response("Too Many Requests", {
    status: 429,
    headers: { "retry-after": String(retryAfter) },
  });
}

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function captureFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers as Record<string, string> | undefined;
    if (rawHeaders) for (const [k, v] of Object.entries(rawHeaders)) headers[k.toLowerCase()] = String(v);
    const bodyStr = init?.body instanceof URLSearchParams ? init.body.toString() : (init?.body as string | undefined);
    const call: FetchCall = { url, method: (init?.method ?? "GET").toUpperCase(), headers, body: bodyStr };
    calls.push(call);
    return handler(call);
  });
  vi.stubGlobal("fetch", mock);
  return { calls, mock };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("reddit adapter — stub-token guard (data honesty)", () => {
  it("publishPost throws BlockedNoCredentialError instead of faking a submit", async () => {
    const account = fakeAccount({ accessToken: "stub_access_token" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(redditAdapter.publishPost(account, selfPost())).rejects.toBeInstanceOf(
      BlockedNoCredentialError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("publishPost also blocks legacy stub rows flagged via metadata.stub", async () => {
    const account = fakeAccount({ metadata: { stub: true } });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(redditAdapter.publishPost(account, selfPost())).rejects.toBeInstanceOf(
      BlockedNoCredentialError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("verifyRedditAccount rejects stub tokens instead of synthesizing a profile", async () => {
    const account = fakeAccount({ accessToken: "stub_access_token", username: "stub_reddit_user" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(verifyRedditAccount(account)).rejects.toMatchObject({
      name: "RedditApiError",
      statusCode: 401,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("listRecentPosts returns an honest empty page for stub tokens", async () => {
    const account = fakeAccount({ accessToken: "stub_access_token" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const page = await redditAdapter.listRecentPosts(account, { limit: 10 });
    expect(page).toEqual({ posts: [], nextCursor: null });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("reddit adapter — real-token publish", () => {
  it("posts a text submission to /api/submit with the right headers + body", async () => {
    const { calls } = captureFetch(() =>
      jsonResponse({
        json: {
          errors: [],
          data: { id: "abc123", name: "t3_abc123", url: "https://reddit.com/r/test/comments/abc123/saying_hi/" },
        },
      }),
    );

    const ref = await redditAdapter.publishPost(fakeAccount(), selfPost());

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe("https://oauth.reddit.com/api/submit");
    expect(call!.method).toBe("POST");
    expect(call!.headers["authorization"]).toBe(`bearer ${REAL_TOKEN}`);
    expect(call!.headers["user-agent"]).toBe("Paperclip:v1.0 (by /u/tylerswitzer19)");
    expect(call!.headers["content-type"]).toBe("application/x-www-form-urlencoded");

    const body = new URLSearchParams(call!.body ?? "");
    expect(body.get("kind")).toBe("self");
    expect(body.get("sr")).toBe("test");
    expect(body.get("title")).toBe("Saying hi from Paperclip");
    expect(body.get("text")).toBe("Hello reddit, this is the body of the post.");
    expect(body.get("api_type")).toBe("json");

    expect(ref.platformPostId).toBe("t3_abc123");
    expect(ref.platformUrl).toBe("https://reddit.com/r/test/comments/abc123/saying_hi/");
  });

  it("strips r/ and /r/ prefixes from the subreddit, defaults to u_<username>", async () => {
    const { calls } = captureFetch(() =>
      jsonResponse({ json: { errors: [], data: { name: "t3_x", url: "https://reddit.com/x" } } }),
    );

    // Case 1: "r/" prefix is stripped
    await redditAdapter.publishPost(fakeAccount(), selfPost({ metadata: { title: "T", subreddit: "r/SaaS" } }));
    expect(new URLSearchParams(calls[0]!.body ?? "").get("sr")).toBe("SaaS");

    // Case 2: leading "/" plus "r/" is stripped
    await redditAdapter.publishPost(fakeAccount(), selfPost({ metadata: { title: "T", subreddit: "/r/test" } }));
    expect(new URLSearchParams(calls[1]!.body ?? "").get("sr")).toBe("test");

    // Case 3: no subreddit → fall back to the user's own profile sub.
    await redditAdapter.publishPost(fakeAccount(), selfPost({ metadata: { title: "T" } }));
    expect(new URLSearchParams(calls[2]!.body ?? "").get("sr")).toBe("u_tylerswitzer19");
  });

  it("posts a link submission when metadata.url is set", async () => {
    const { calls } = captureFetch(() =>
      jsonResponse({ json: { errors: [], data: { name: "t3_link", url: "https://reddit.com/r/test/link" } } }),
    );

    await redditAdapter.publishPost(
      fakeAccount(),
      selfPost({
        metadata: { title: "Cool article", subreddit: "test", url: "https://example.com/article" },
      }),
    );

    const body = new URLSearchParams(calls[0]!.body ?? "");
    expect(body.get("kind")).toBe("link");
    expect(body.get("url")).toBe("https://example.com/article");
    expect(body.get("text")).toBeNull();
  });

  it("rejects image posts with a 501 documenting the next iteration", async () => {
    captureFetch(() => jsonResponse({}));

    await expect(
      redditAdapter.publishPost(
        fakeAccount(),
        selfPost({
          mediaUrls: ["https://cdn.paperclip/local/file.png"],
          metadata: { title: "Pic", subreddit: "test" },
        }),
      ),
    ).rejects.toMatchObject({
      name: "RedditApiError",
      statusCode: 501,
    });
  });

  it("surfaces 429 with Retry-After as RedditRateLimitError", async () => {
    captureFetch(() => rateLimitedResponse(42));

    const err = await redditAdapter
      .publishPost(fakeAccount(), selfPost())
      .catch((e) => e);

    expect(err).toBeInstanceOf(RedditRateLimitError);
    expect((err as RedditRateLimitError).retryAfterSeconds).toBe(42);
    expect((err as RedditRateLimitError).statusCode).toBe(429);
  });

  it("surfaces json.errors as RedditApiError so the scheduler marks the target failed", async () => {
    captureFetch(() =>
      jsonResponse({
        json: {
          errors: [["SUBREDDIT_NOEXIST", "that subreddit doesn't exist", "sr"]],
          data: null,
        },
      }),
    );

    const err = await redditAdapter
      .publishPost(fakeAccount(), selfPost({ metadata: { title: "T", subreddit: "doesnotexist" } }))
      .catch((e) => e);

    expect(err).toBeInstanceOf(RedditApiError);
    expect((err as RedditApiError).statusCode).toBe(422);
    expect((err as Error).message).toMatch(/SUBREDDIT_NOEXIST/);
  });
});

describe("reddit adapter — verifyAccount", () => {
  it("hits /api/v1/me with bearer + UA and returns name + karma", async () => {
    const { calls } = captureFetch(() =>
      jsonResponse({ name: "tylerswitzer19", link_karma: 1234, comment_karma: 56 }),
    );

    const profile = await verifyRedditAccount(fakeAccount());

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://oauth.reddit.com/api/v1/me");
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.headers["authorization"]).toBe(`bearer ${REAL_TOKEN}`);
    expect(calls[0]!.headers["user-agent"]).toBe("Paperclip:v1.0 (by /u/tylerswitzer19)");
    expect(profile).toEqual({ name: "tylerswitzer19", link_karma: 1234, comment_karma: 56 });
  });

  it("adapter.verifyAccount wraps the profile in an AccountVerification", async () => {
    captureFetch(() => jsonResponse({ name: "ts", link_karma: 7, comment_karma: 3 }));

    const result = await redditAdapter.verifyAccount!(fakeAccount());
    expect(result).toEqual({
      ok: true,
      handle: "ts",
      details: { link_karma: 7, comment_karma: 3 },
    });
  });

  it("surfaces 429 on /api/v1/me as a rate-limit error too", async () => {
    captureFetch(() => rateLimitedResponse(9));

    const err = await verifyRedditAccount(fakeAccount()).catch((e) => e);
    expect(err).toBeInstanceOf(RedditRateLimitError);
    expect((err as RedditRateLimitError).retryAfterSeconds).toBe(9);
  });
});
