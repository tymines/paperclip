/**
 * X adapter — media publish, with `fetch` mocked at the global.
 *
 * Covers (mirrors reddit-adapter.test.ts conventions):
 *  - Stub-token path stays data-honest: publishPost with media throws
 *    BlockedNoCredentialError before any network call.
 *  - Image happy path: bytes are fetched from the post's mediaUrl, pushed
 *    to POST https://api.x.com/2/media/upload as multipart
 *    (media_category=tweet_image), and the returned media id lands on the
 *    tweet body's media.media_ids.
 *  - Video happy path: chunked INIT → APPEND → FINALIZE against the same
 *    endpoint, then command=STATUS polling until processing_info.state
 *    "succeeded", then the tweet.
 *  - Upload failure surfaces as XApiError and NO tweet is posted — media
 *    is never silently dropped.
 *  - Wrong served mime type → honest 415, no upload attempted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialAccount } from "@paperclipai/shared";
import { xAdapter, XApiError } from "../services/social-scheduler/x.js";
import { BlockedNoCredentialError } from "../services/social-scheduler/errors.js";
import { __setMediaPollSleepForTesting } from "../services/social-scheduler/media.js";
import type { PostDraftPayload } from "../services/social-scheduler/types.js";

const REAL_TOKEN = "real_x_bearer_xyz";
const MEDIA_UPLOAD_URL = "https://api.x.com/2/media/upload";
const TWEETS_URL = "https://api.twitter.com/2/tweets";
const IMAGE_URL = "https://cdn.example.com/social/pic.png";
const VIDEO_URL = "https://cdn.example.com/social/clip.mp4";

function fakeAccount(overrides: Partial<SocialAccount> = {}): SocialAccount {
  const now = new Date();
  return {
    id: "acct-x-1",
    companyId: "co-1",
    platform: "x",
    platformAccountId: "x-abc",
    displayName: "Tyler",
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
    baseCaption: "Look at this.",
    caption: null,
    postType: "image",
    mediaUrls: [IMAGE_URL],
    metadata: {},
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
  return new Response(bytes, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** JSON/string bodies verbatim; multipart bodies as the FormData itself. */
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
    const call: FetchCall = {
      url,
      method: (init?.method ?? "GET").toUpperCase(),
      headers,
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
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
  __setMediaPollSleepForTesting(async () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __setMediaPollSleepForTesting(null);
});

describe("x adapter — media publish (data honesty)", () => {
  it("publishPost with media throws BlockedNoCredentialError before any network call", async () => {
    const account = fakeAccount({ accessToken: "stub_access_token" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(xAdapter.publishPost(account, imagePost())).rejects.toBeInstanceOf(
      BlockedNoCredentialError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does NOT post a text-only tweet when the media upload fails", async () => {
    const { calls } = captureFetch((call) => {
      if (call.url === IMAGE_URL) return bytesResponse(new Uint8Array([1, 2, 3]), "image/png");
      if (call.url === MEDIA_UPLOAD_URL) {
        return jsonResponse({ detail: "media type unrecognized" }, { status: 400 });
      }
      throw new Error(`unexpected fetch: ${call.url}`);
    });

    const err = await xAdapter.publishPost(fakeAccount(), imagePost()).catch((e) => e);
    expect(err).toBeInstanceOf(XApiError);
    expect((err as XApiError).statusCode).toBe(400);
    // media fetch + upload attempt only — never POST /2/tweets
    expect(calls.map((c) => c.url)).toEqual([IMAGE_URL, MEDIA_UPLOAD_URL]);
  });

  it("rejects media served with a non-image mime type with an honest 415", async () => {
    const { calls } = captureFetch((call) => {
      if (call.url === IMAGE_URL) return bytesResponse(new Uint8Array([1]), "text/html");
      throw new Error(`unexpected fetch: ${call.url}`);
    });

    const err = await xAdapter.publishPost(fakeAccount(), imagePost()).catch((e) => e);
    expect(err).toBeInstanceOf(XApiError);
    expect((err as XApiError).statusCode).toBe(415);
    expect(calls).toHaveLength(1); // only the media fetch — no upload, no tweet
  });
});

describe("x adapter — image upload happy path", () => {
  it("uploads bytes to /2/media/upload and attaches media_ids to the tweet", async () => {
    const { calls } = captureFetch((call) => {
      if (call.url === IMAGE_URL) {
        return bytesResponse(new Uint8Array([137, 80, 78, 71]), "image/png");
      }
      if (call.url === MEDIA_UPLOAD_URL) {
        return jsonResponse({ data: { id: "m-42", media_key: "3_m-42" } });
      }
      if (call.url === TWEETS_URL) {
        return jsonResponse({ data: { id: "tw-1", text: "Look at this." } });
      }
      throw new Error(`unexpected fetch: ${call.url}`);
    });

    const ref = await xAdapter.publishPost(fakeAccount(), imagePost());

    expect(calls.map((c) => c.url)).toEqual([IMAGE_URL, MEDIA_UPLOAD_URL, TWEETS_URL]);

    const upload = calls[1]!;
    expect(upload.method).toBe("POST");
    expect(upload.headers["authorization"]).toBe(`Bearer ${REAL_TOKEN}`);
    expect(upload.form).toBeInstanceOf(FormData);
    expect(upload.form!.get("media_category")).toBe("tweet_image");
    const filePart = upload.form!.get("media");
    expect(filePart).toBeInstanceOf(Blob);
    expect((filePart as Blob).type).toBe("image/png");

    const tweet = calls[2]!;
    expect(tweet.method).toBe("POST");
    expect(tweet.headers["authorization"]).toBe(`Bearer ${REAL_TOKEN}`);
    const tweetBody = JSON.parse(tweet.body ?? "{}") as {
      text?: string;
      media?: { media_ids?: string[] };
    };
    expect(tweetBody.text).toBe("Look at this.");
    expect(tweetBody.media?.media_ids).toEqual(["m-42"]);

    expect(ref.platformPostId).toBe("tw-1");
    expect(ref.platformUrl).toBe("https://x.com/tylerswitzer19/status/tw-1");
    expect(ref.mediaUrl).toBe(IMAGE_URL);
  });

  it("uploads each image once for multi-image tweets (order preserved)", async () => {
    const second = "https://cdn.example.com/social/pic2.jpg";
    let uploadCount = 0;
    const { calls } = captureFetch((call) => {
      if (call.url === IMAGE_URL) return bytesResponse(new Uint8Array([1]), "image/png");
      if (call.url === second) return bytesResponse(new Uint8Array([2]), "image/jpeg");
      if (call.url === MEDIA_UPLOAD_URL) {
        uploadCount += 1;
        return jsonResponse({ data: { id: `m-${uploadCount}` } });
      }
      if (call.url === TWEETS_URL) return jsonResponse({ data: { id: "tw-2" } });
      throw new Error(`unexpected fetch: ${call.url}`);
    });

    await xAdapter.publishPost(
      fakeAccount(),
      imagePost({ postType: "carousel", mediaUrls: [IMAGE_URL, second] }),
    );

    const tweetBody = JSON.parse(calls.at(-1)!.body ?? "{}") as {
      media?: { media_ids?: string[] };
    };
    expect(tweetBody.media?.media_ids).toEqual(["m-1", "m-2"]);
  });
});

describe("x adapter — video upload happy path (chunked + STATUS polling)", () => {
  it("runs INIT → APPEND → FINALIZE, polls STATUS to succeeded, then tweets", async () => {
    let statusPolls = 0;
    const { calls } = captureFetch((call) => {
      if (call.url === VIDEO_URL) {
        return bytesResponse(new Uint8Array(64).fill(7), "video/mp4");
      }
      if (call.url === MEDIA_UPLOAD_URL && call.form) {
        const command = call.form.get("command");
        if (command === "INIT") return jsonResponse({ data: { id: "vid-9" } });
        if (command === "APPEND") return new Response(null, { status: 204 });
        if (command === "FINALIZE") {
          return jsonResponse({
            data: { id: "vid-9", processing_info: { state: "pending", check_after_secs: 1 } },
          });
        }
        throw new Error(`unexpected media command: ${String(command)}`);
      }
      if (call.url.startsWith(`${MEDIA_UPLOAD_URL}?command=STATUS`)) {
        statusPolls += 1;
        return jsonResponse({
          data: {
            id: "vid-9",
            processing_info:
              statusPolls < 2
                ? { state: "in_progress", check_after_secs: 1 }
                : { state: "succeeded" },
          },
        });
      }
      if (call.url === TWEETS_URL) return jsonResponse({ data: { id: "tw-3" } });
      throw new Error(`unexpected fetch: ${call.url}`);
    });

    const ref = await xAdapter.publishPost(
      fakeAccount(),
      imagePost({ postType: "video", mediaUrls: [VIDEO_URL], baseCaption: "Ship it." }),
    );

    const initCall = calls.find((c) => c.form?.get("command") === "INIT")!;
    expect(initCall.form!.get("media_type")).toBe("video/mp4");
    expect(initCall.form!.get("total_bytes")).toBe("64");
    expect(initCall.form!.get("media_category")).toBe("tweet_video");

    const appendCall = calls.find((c) => c.form?.get("command") === "APPEND")!;
    expect(appendCall.form!.get("media_id")).toBe("vid-9");
    expect(appendCall.form!.get("segment_index")).toBe("0");

    expect(statusPolls).toBe(2);

    const tweetBody = JSON.parse(calls.at(-1)!.body ?? "{}") as {
      media?: { media_ids?: string[] };
    };
    expect(tweetBody.media?.media_ids).toEqual(["vid-9"]);
    expect(ref.platformPostId).toBe("tw-3");
  });

  it("fails loudly when X reports video processing failed", async () => {
    const { calls } = captureFetch((call) => {
      if (call.url === VIDEO_URL) return bytesResponse(new Uint8Array(8), "video/mp4");
      if (call.url === MEDIA_UPLOAD_URL && call.form) {
        const command = call.form.get("command");
        if (command === "INIT") return jsonResponse({ data: { id: "vid-x" } });
        if (command === "APPEND") return new Response(null, { status: 204 });
        if (command === "FINALIZE") {
          return jsonResponse({
            data: {
              id: "vid-x",
              processing_info: { state: "failed", error: { message: "InvalidMedia" } },
            },
          });
        }
      }
      throw new Error(`unexpected fetch: ${call.url}`);
    });

    const err = await xAdapter
      .publishPost(fakeAccount(), imagePost({ postType: "video", mediaUrls: [VIDEO_URL] }))
      .catch((e) => e);

    expect(err).toBeInstanceOf(XApiError);
    expect((err as Error).message).toMatch(/InvalidMedia/);
    expect(calls.some((c) => c.url === TWEETS_URL)).toBe(false);
  });
});
