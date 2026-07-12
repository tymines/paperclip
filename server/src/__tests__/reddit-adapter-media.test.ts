/**
 * Reddit adapter — media publish via the asset-lease flow, with `fetch`
 * mocked at the global (same conventions as reddit-adapter.test.ts).
 *
 * Covers:
 *  - Stub-token guard: media publish throws BlockedNoCredentialError with
 *    zero network calls.
 *  - Image happy path: bytes fetched from the post's mediaUrl → POST
 *    /api/media/asset.json lease → multipart upload to the lease URL
 *    (pre-signed fields + file) → /api/submit with kind=image and the
 *    `${action}/${key}` asset URL.
 *  - Websocket-only submit responses (empty json.data) resolve honestly
 *    via the own-submissions listing instead of a fabricated id.
 *  - Galleries (2+ images) stay an honest 501 with no network calls.
 *  - Video without a poster image is an honest 400 (no /api/submit call).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialAccount } from "@paperclipai/shared";
import { redditAdapter, RedditApiError } from "../services/social-scheduler/reddit.js";
import { BlockedNoCredentialError } from "../services/social-scheduler/errors.js";
import type { PostDraftPayload } from "../services/social-scheduler/types.js";

const REAL_TOKEN = "real_reddit_bearer_xyz";
const IMAGE_URL = "https://cdn.example.com/social/pic.jpg";
const VIDEO_URL = "https://cdn.example.com/social/clip.mp4";
const LEASE_URL = "https://oauth.reddit.com/api/media/asset.json";
const SUBMIT_URL = "https://oauth.reddit.com/api/submit";
const S3_ACTION = "//reddit-uploaded-media.s3-accelerate.amazonaws.com/rte";
const S3_URL = `https:${S3_ACTION}`;

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

function imagePost(overrides: Partial<PostDraftPayload> = {}): PostDraftPayload {
  return {
    baseCaption: "",
    caption: null,
    postType: "image",
    mediaUrls: [IMAGE_URL],
    metadata: { title: "A picture", subreddit: "test" },
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

function bytesResponse(bytes: Uint8Array, contentType: string): Response {
  return new Response(bytes, { status: 200, headers: { "content-type": contentType } });
}

function leaseResponse(): Response {
  return jsonResponse({
    args: {
      action: S3_ACTION,
      fields: [
        { name: "acl", value: "public-read" },
        { name: "key", value: "uploads/abc/pic.jpg" },
        { name: "policy", value: "signed-policy" },
      ],
    },
    asset: { asset_id: "asset-1", websocket_url: "wss://ws.example" },
  });
}

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  form?: FormData;
}

function captureFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers as Record<string, string> | undefined;
    if (rawHeaders) for (const [k, v] of Object.entries(rawHeaders)) headers[k.toLowerCase()] = String(v);
    const bodyStr =
      init?.body instanceof URLSearchParams
        ? init.body.toString()
        : typeof init?.body === "string"
          ? init.body
          : undefined;
    const call: FetchCall = {
      url,
      method: (init?.method ?? "GET").toUpperCase(),
      headers,
      ...(bodyStr !== undefined ? { body: bodyStr } : {}),
      ...(init?.body instanceof FormData ? { form: init.body } : {}),
    };
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

describe("reddit adapter — media publish guards (data honesty)", () => {
  it("stub token → BlockedNoCredentialError with zero network calls", async () => {
    const account = fakeAccount({ accessToken: "stub_access_token" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(redditAdapter.publishPost(account, imagePost())).rejects.toBeInstanceOf(
      BlockedNoCredentialError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("galleries (2+ images) stay an honest 501 — no lease minted", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const err = await redditAdapter
      .publishPost(
        fakeAccount(),
        imagePost({ postType: "carousel", mediaUrls: [IMAGE_URL, "https://cdn.example.com/2.jpg"] }),
      )
      .catch((e) => e);

    expect(err).toBeInstanceOf(RedditApiError);
    expect((err as RedditApiError).statusCode).toBe(501);
    expect((err as Error).message).toMatch(/gallery/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("video without metadata.posterUrl is an honest 400 before any lease is spent", async () => {
    const { calls } = captureFetch((call) => {
      if (call.url === VIDEO_URL) return bytesResponse(new Uint8Array(16), "video/mp4");
      throw new Error(`unexpected fetch: ${call.url}`);
    });

    const err = await redditAdapter
      .publishPost(
        fakeAccount(),
        imagePost({ postType: "video", mediaUrls: [VIDEO_URL] }),
      )
      .catch((e) => e);

    expect(err).toBeInstanceOf(RedditApiError);
    expect((err as RedditApiError).statusCode).toBe(400);
    expect((err as Error).message).toMatch(/poster/i);
    // Only the media-bytes fetch — no lease, no S3 upload, no submit.
    expect(calls.map((c) => c.url)).toEqual([VIDEO_URL]);
  });
});

describe("reddit adapter — asset-lease image happy path", () => {
  it("mints a lease, uploads the file with the pre-signed fields, submits kind=image", async () => {
    const { calls } = captureFetch((call) => {
      if (call.url === IMAGE_URL) return bytesResponse(new Uint8Array([255, 216]), "image/jpeg");
      if (call.url === LEASE_URL) return leaseResponse();
      if (call.url === S3_URL) return new Response(null, { status: 201 });
      if (call.url === SUBMIT_URL) {
        return jsonResponse({
          json: {
            errors: [],
            data: {
              id: "img1",
              name: "t3_img1",
              url: "https://reddit.com/r/test/comments/img1/a_picture/",
            },
          },
        });
      }
      throw new Error(`unexpected fetch: ${call.url}`);
    });

    const ref = await redditAdapter.publishPost(fakeAccount(), imagePost());

    expect(calls.map((c) => c.url)).toEqual([IMAGE_URL, LEASE_URL, S3_URL, SUBMIT_URL]);

    // Lease mint carries auth + the file descriptor.
    const lease = calls[1]!;
    expect(lease.method).toBe("POST");
    expect(lease.headers["authorization"]).toBe(`bearer ${REAL_TOKEN}`);
    const leaseBody = new URLSearchParams(lease.body ?? "");
    expect(leaseBody.get("filepath")).toBe("paperclip-upload.jpg");
    expect(leaseBody.get("mimetype")).toBe("image/jpeg");

    // S3 upload: pre-signed fields first, then the file part.
    const s3 = calls[2]!;
    expect(s3.form).toBeInstanceOf(FormData);
    expect(s3.form!.get("acl")).toBe("public-read");
    expect(s3.form!.get("key")).toBe("uploads/abc/pic.jpg");
    expect(s3.form!.get("policy")).toBe("signed-policy");
    const filePart = s3.form!.get("file");
    expect(filePart).toBeInstanceOf(Blob);
    expect((filePart as Blob).type).toBe("image/jpeg");

    // Submit references the uploaded asset URL, kind=image.
    const submit = new URLSearchParams(calls[3]!.body ?? "");
    expect(submit.get("kind")).toBe("image");
    expect(submit.get("url")).toBe(`${S3_URL}/uploads/abc/pic.jpg`);
    expect(submit.get("sr")).toBe("test");
    expect(submit.get("title")).toBe("A picture");

    expect(ref.platformPostId).toBe("t3_img1");
    expect(ref.platformUrl).toBe("https://reddit.com/r/test/comments/img1/a_picture/");
    expect(ref.mediaUrl).toBe(IMAGE_URL);
  });

  it("resolves websocket-only submit responses via the own-submissions listing", async () => {
    const nowUtc = Math.floor(Date.now() / 1000);
    const { calls } = captureFetch((call) => {
      if (call.url === IMAGE_URL) return bytesResponse(new Uint8Array([1]), "image/png");
      if (call.url === LEASE_URL) return leaseResponse();
      if (call.url === S3_URL) return new Response(null, { status: 201 });
      if (call.url === SUBMIT_URL) {
        // Media submits can come back accepted but with websocket-only
        // confirmation (empty data).
        return jsonResponse({ json: { errors: [], data: null } });
      }
      if (call.url.startsWith("https://oauth.reddit.com/user/tylerswitzer19/submitted")) {
        return jsonResponse({
          data: {
            children: [
              {
                data: {
                  name: "t3_fresh",
                  permalink: "/r/test/comments/fresh/a_picture/",
                  created_utc: nowUtc,
                  title: "A picture",
                },
              },
            ],
            after: null,
          },
        });
      }
      throw new Error(`unexpected fetch: ${call.url}`);
    });

    const ref = await redditAdapter.publishPost(fakeAccount(), imagePost());

    expect(ref.platformPostId).toBe("t3_fresh");
    expect(ref.platformUrl).toBe("https://www.reddit.com/r/test/comments/fresh/a_picture/");
    expect(
      calls.some((c) => c.url.startsWith("https://oauth.reddit.com/user/tylerswitzer19/submitted")),
    ).toBe(true);
  });

  it("surfaces lease failures as RedditApiError without touching /api/submit", async () => {
    const { calls } = captureFetch((call) => {
      if (call.url === IMAGE_URL) return bytesResponse(new Uint8Array([1]), "image/png");
      if (call.url === LEASE_URL) return jsonResponse({ error: "denied" }, { status: 403 });
      throw new Error(`unexpected fetch: ${call.url}`);
    });

    const err = await redditAdapter.publishPost(fakeAccount(), imagePost()).catch((e) => e);

    expect(err).toBeInstanceOf(RedditApiError);
    expect((err as RedditApiError).statusCode).toBe(403);
    expect(calls.some((c) => c.url === SUBMIT_URL)).toBe(false);
  });
});
