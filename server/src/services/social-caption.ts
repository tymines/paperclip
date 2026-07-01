/**
 * social-caption — DeepSeek-backed auto-caption service.
 *
 * Tyler picked DeepSeek for this work (cheap, fast, no silent fallback to
 * OpenAI). The flow:
 *
 *   1. If media is supplied, get a short visual description.
 *      - DeepSeek's public chat API does NOT yet expose a vision endpoint
 *        on api.deepseek.com (only deepseek-chat / deepseek-reasoner).
 *        We use Moonshot's `moonshot-v1-8k-vision-preview` for the image
 *        description step (it's OpenAI-compatible and Tyler already has
 *        the key in ~/.paperclip/provider-api-keys.json).
 *      - For videos we extract the first-second thumbnail via ffmpeg
 *        (already installed locally per the project) and run that.
 *   2. DeepSeek-chat polishes the description (or just the user prompt
 *      when there's no media) into a tight, on-brand caption + 3-5
 *      hashtag suggestions + a 1-sentence post intent.
 *
 * Cache key is sha256(media bytes + voice + platform + prompt). Identical
 * inputs short-circuit to the previous result — saves DeepSeek $ on
 * retries (Tyler's instruction).
 *
 * Error contract: on DeepSeek 401/429/5xx we throw CaptionProviderError;
 * the route surfaces a clear "DeepSeek key needs attention" message with
 * a link to /instance/settings/provider-keys. We never silently fall back
 * to OpenAI — Tyler was explicit about that.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRawKey } from "./provider-api-keys/index.js";
import { logger } from "../middleware/logger.js";

const DEEPSEEK_CHAT_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";
const MOONSHOT_VISION_URL = "https://api.moonshot.ai/v1/chat/completions";
const MOONSHOT_VISION_MODEL = "moonshot-v1-8k-vision-preview";

/**
 * DeepSeek v3 list price (May 2026):
 *   input  : $0.27 / 1M tokens
 *   output : $1.10 / 1M tokens
 * Moonshot 8k vision preview is roughly the same order of magnitude;
 * we apply a flat surcharge when the vision step ran. Caption calls are
 * tiny (<2k in / <300 out tokens) so a single call lands under ~$0.001.
 */
const DEEPSEEK_INPUT_PER_TOKEN = 0.27 / 1_000_000;
const DEEPSEEK_OUTPUT_PER_TOKEN = 1.10 / 1_000_000;
const MOONSHOT_VISION_FLAT_USD = 0.0008;

const DEFAULT_BRAND_VOICE = [
  "Tight, work-first, no fluff.",
  "Short sentences. Direct. No corporate filler — never \"In today's fast-paced world\", never \"unlock\", never \"empower\".",
  "Speak in the first person when appropriate. Sound human, like a founder mid-build.",
  "Numbers > adjectives. If you can put a metric or a concrete artifact in the post, do.",
  "Hashtags should be sparse and load-bearing — three to five, not a wall.",
].join(" ");

const PLATFORM_GUIDANCE: Record<string, { lenHint: string; tone: string; hashtags: string }> = {
  instagram:  { lenHint: "1-3 short sentences, under ~250 chars",         tone: "visual hook first; one personal line",          hashtags: "4-5 hashtags, mix of niche + medium reach" },
  threads:    { lenHint: "1-2 sentences, under 500 chars",                tone: "conversational, slightly punchy",               hashtags: "1-2 hashtags max" },
  x:          { lenHint: "1 sentence, under 240 chars total incl tags",   tone: "tight, link-bait-y in the founder/build sense", hashtags: "0-2 hashtags" },
  facebook:   { lenHint: "2-3 sentences",                                  tone: "warmer, slightly longer than X",                hashtags: "0-3 hashtags" },
  reddit:     { lenHint: "punchy title + 1 line of context",              tone: "no hype, no sales — Reddit hates that",         hashtags: "no hashtags on Reddit" },
  linkedin:   { lenHint: "3-5 short paragraphs (one sentence each)",       tone: "professional but human; lead with a concrete result", hashtags: "3-5 hashtags" },
  tiktok:     { lenHint: "1-2 sentences, hook first",                     tone: "very casual, gen-Z native",                     hashtags: "5-8 trending hashtags" },
  youtube:    { lenHint: "headline + 1-2 sentence description",           tone: "SEO-aware, descriptive",                        hashtags: "3-5 hashtags" },
  pinterest:  { lenHint: "1 sentence, SEO-aware",                         tone: "descriptive of what the pin shows",             hashtags: "2-4 hashtags" },
  bluesky:    { lenHint: "1 sentence under 300 chars",                    tone: "chill, human, no marketing voice",              hashtags: "0-2 hashtags" },
  mastodon:   { lenHint: "1-2 sentences",                                  tone: "casual, slightly nerdy",                        hashtags: "2-3 hashtags" },
};

export interface CaptionInput {
  /** Target platform — drives length, hashtag count, tone. */
  platform: string;
  /** Brand voice override. Falls back to Tyler's default voice. */
  voice?: string | null;
  /** Free-form user instruction (Compose tab "Generate caption" prompt). */
  prompt?: string | null;
  /** Raw bytes for the image (Bulk Upload step 2). */
  mediaBytes?: Buffer | null;
  /** Mime type of mediaBytes. */
  mediaMime?: string | null;
  /** Optional filename for context. */
  mediaFilename?: string | null;
  /** When set and mediaBytes is missing, the server fetches the URL. */
  mediaUrl?: string | null;
}

export interface CaptionResult {
  caption: string;
  hashtags: string[];
  intent: string;
  cached: boolean;
  cacheKey: string;
  latencyMs: number;
  provider: "deepseek";
  /** Best-effort USD cost for this call (deepseek + optional moonshot vision). */
  estimatedCostUsd: number;
  /** True when a moonshot vision step ran ahead of DeepSeek. */
  usedVision: boolean;
}

export class CaptionProviderError extends Error {
  constructor(
    public readonly provider: "deepseek" | "moonshot",
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(`${provider} ${status}: ${detail}`);
    this.name = "CaptionProviderError";
  }
}

export class CaptionConfigError extends Error {
  constructor(public readonly provider: "deepseek" | "moonshot", detail: string) {
    super(detail);
    this.name = "CaptionConfigError";
  }
}

interface CacheEntry {
  result: CaptionResult;
  insertedAt: number;
}
const CACHE_TTL_MS = 24 * 60 * 60_000;
const CACHE_MAX = 200;
const captionCache = new Map<string, CacheEntry>();

function rememberCache(key: string, result: CaptionResult) {
  if (captionCache.size >= CACHE_MAX) {
    const oldest = captionCache.keys().next().value;
    if (oldest !== undefined) captionCache.delete(oldest);
  }
  captionCache.set(key, { result, insertedAt: Date.now() });
}

function readCache(key: string): CaptionResult | null {
  const entry = captionCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.insertedAt > CACHE_TTL_MS) {
    captionCache.delete(key);
    return null;
  }
  return entry.result;
}

/** Exposed for tests / manual cache busting. */
export function __clearCaptionCache() {
  captionCache.clear();
}

function buildCacheKey(input: CaptionInput, mediaDigest: string | null): string {
  const h = createHash("sha256");
  h.update(input.platform);
  h.update("|voice=");
  h.update(input.voice ?? "default");
  h.update("|prompt=");
  h.update(input.prompt ?? "");
  h.update("|media=");
  h.update(mediaDigest ?? input.mediaUrl ?? "none");
  return h.digest("hex");
}

async function fetchUrlAsBuffer(url: string): Promise<{ buffer: Buffer; mime: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
    const arr = new Uint8Array(await res.arrayBuffer());
    return {
      buffer: Buffer.from(arr),
      mime: res.headers.get("content-type") ?? "application/octet-stream",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract a single-frame JPEG thumbnail from a video buffer using ffmpeg.
 * Used to give the vision model something to look at for video uploads.
 */
async function extractVideoThumbnail(videoBytes: Buffer): Promise<Buffer | null> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-thumb-"));
  const inPath = path.join(tmpDir, "in.mp4");
  const outPath = path.join(tmpDir, "out.jpg");
  try {
    await fs.writeFile(inPath, videoBytes);
    await new Promise<void>((resolve, reject) => {
      const ff = spawn(
        "ffmpeg",
        ["-y", "-ss", "00:00:01", "-i", inPath, "-frames:v", "1", "-q:v", "5", outPath],
        { stdio: "ignore" },
      );
      ff.on("error", reject);
      ff.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)),
      );
    });
    return await fs.readFile(outPath);
  } catch (err) {
    logger.warn({ err }, "social-caption: thumbnail extract failed");
    return null;
  } finally {
    void fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Moonshot vision step. Returns a short, neutral description of what is
 * visible in the image — fed to DeepSeek for the on-brand caption polish.
 * If Moonshot is unavailable we skip the visual context (DeepSeek still
 * runs with whatever text we do have).
 */
async function describeImageWithMoonshot(
  imageBytes: Buffer,
  imageMime: string,
): Promise<{ description: string; promptTokens: number; completionTokens: number } | null> {
  const key = await getRawKey("moonshot").catch(() => null);
  if (!key) return null;

  const dataUrl = `data:${imageMime || "image/jpeg"};base64,${imageBytes.toString("base64")}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const resp = await fetch(MOONSHOT_VISION_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MOONSHOT_VISION_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are a strict visual descriptor. Describe ONLY what is in the image in 1-2 short sentences. No opinions, no flowery language, no calls to action — facts only. If text is visible, quote it.",
          },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: dataUrl } },
              { type: "text", text: "Describe this image in 1-2 short sentences." },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 160,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      // Vision is an enhancement — log + swallow so DeepSeek still gets to
      // run with whatever prompt the user supplied.
      logger.warn({ status: resp.status, body: text.slice(0, 240) }, "social-caption: moonshot vision failed");
      return null;
    }
    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) return null;
    return {
      description: text,
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
    };
  } catch (err) {
    logger.warn({ err }, "social-caption: moonshot vision error");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface DeepseekCaption {
  caption: string;
  hashtags: string[];
  intent: string;
  promptTokens: number;
  completionTokens: number;
}

async function callDeepSeekForCaption(args: {
  voice: string;
  platform: string;
  prompt: string | null;
  description: string | null;
  filename: string | null;
}): Promise<DeepseekCaption> {
  const key = await getRawKey("deepseek").catch(() => null);
  if (!key) {
    throw new CaptionConfigError(
      "deepseek",
      "DeepSeek API key is not configured. Add it under Instance Settings → Provider API Keys.",
    );
  }

  const guidance = PLATFORM_GUIDANCE[args.platform] ?? {
    lenHint: "1-3 sentences",
    tone: "tight and direct",
    hashtags: "3-5 hashtags",
  };

  const system = [
    "You write social-media captions that sound like Tyler — the founder of a small AI-ops company. You are NOT writing for a brand consultancy or a generic copy farm.",
    "",
    "BRAND VOICE:",
    args.voice,
    "",
    `TARGET PLATFORM: ${args.platform}`,
    `Length: ${guidance.lenHint}`,
    `Tone: ${guidance.tone}`,
    `Hashtags: ${guidance.hashtags}`,
    "",
    "Return STRICT JSON with this exact shape, nothing else, no markdown fences:",
    `{"caption": string, "hashtags": [string], "intent": string}`,
    "- caption: the post copy. Do not include the hashtags inside the caption — they go in the hashtags array.",
    "- hashtags: 3-5 short hashtags WITHOUT the leading # (or fewer if platform guidance says so).",
    "- intent: ONE sentence (under 120 chars) describing the goal of the post (e.g. \"Tease v2 social-scheduler ship to existing audience\").",
  ].join("\n");

  const userParts: string[] = [];
  if (args.prompt && args.prompt.trim().length > 0) {
    userParts.push(`USER PROMPT:\n${args.prompt.trim()}`);
  }
  if (args.description) {
    userParts.push(`VISUAL CONTEXT (from a vision model — describes the attached media):\n${args.description}`);
  }
  if (args.filename) {
    userParts.push(`FILENAME (for context only): ${args.filename}`);
  }
  if (userParts.length === 0) {
    userParts.push(
      "No media context and no prompt was supplied. Write a generic but on-brand placeholder that the user can edit — make it obvious it's a placeholder by referencing \"your update\" rather than a specific topic.",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18_000);
  try {
    const resp = await fetch(DEEPSEEK_CHAT_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userParts.join("\n\n") },
        ],
        temperature: 0.7,
        max_tokens: 400,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new CaptionProviderError("deepseek", resp.status, text.slice(0, 400));
    }
    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const raw = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!raw) throw new CaptionProviderError("deepseek", 502, "empty completion");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Belt-and-braces: pull the first JSON object out if the model wrapped it.
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new CaptionProviderError("deepseek", 502, `non-JSON response: ${raw.slice(0, 200)}`);
      parsed = JSON.parse(match[0]);
    }
    const p = parsed as { caption?: unknown; hashtags?: unknown; intent?: unknown };
    const caption = typeof p.caption === "string" ? p.caption.trim() : "";
    const hashtags = Array.isArray(p.hashtags)
      ? p.hashtags
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim().replace(/^#+/, ""))
          .filter((t) => t.length > 0)
          .slice(0, 10)
      : [];
    const intent = typeof p.intent === "string" ? p.intent.trim() : "";
    if (caption.length === 0) {
      throw new CaptionProviderError("deepseek", 502, "missing caption field");
    }
    return {
      caption,
      hashtags,
      intent,
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Suggest a caption for the given media + platform. Hot-path used by the
 * Bulk Upload step 2 and Compose tab "Generate caption" button.
 */
export async function suggestCaption(input: CaptionInput): Promise<CaptionResult> {
  const startedAt = Date.now();

  // Resolve media bytes if a URL was passed instead.
  let mediaBytes = input.mediaBytes ?? null;
  let mediaMime = input.mediaMime ?? null;
  if (!mediaBytes && input.mediaUrl) {
    try {
      const fetched = await fetchUrlAsBuffer(input.mediaUrl);
      mediaBytes = fetched.buffer;
      mediaMime = fetched.mime;
    } catch (err) {
      logger.warn({ err }, "social-caption: media URL fetch failed");
    }
  }

  const mediaDigest = mediaBytes
    ? createHash("sha256").update(mediaBytes).digest("hex")
    : null;
  const cacheKey = buildCacheKey(input, mediaDigest);

  const cached = readCache(cacheKey);
  if (cached) {
    return { ...cached, cached: true, latencyMs: Date.now() - startedAt };
  }

  // Vision step (optional). Only image-shaped media — videos get a
  // ffmpeg-extracted thumbnail first.
  let description: string | null = null;
  let usedVision = false;
  let extraVisionCost = 0;
  if (mediaBytes) {
    let frameBytes: Buffer | null = mediaBytes;
    let frameMime: string = mediaMime ?? "application/octet-stream";
    if (frameMime.startsWith("video/")) {
      const thumb = await extractVideoThumbnail(mediaBytes);
      if (thumb) {
        frameBytes = thumb;
        frameMime = "image/jpeg";
      } else {
        frameBytes = null;
      }
    } else if (!frameMime.startsWith("image/")) {
      frameBytes = null;
    }

    if (frameBytes) {
      const visionRes = await describeImageWithMoonshot(frameBytes, frameMime);
      if (visionRes) {
        description = visionRes.description;
        usedVision = true;
        extraVisionCost = MOONSHOT_VISION_FLAT_USD;
      }
    }
  }

  const voice = (input.voice && input.voice.trim().length > 0)
    ? input.voice.trim()
    : DEFAULT_BRAND_VOICE;

  const ds = await callDeepSeekForCaption({
    voice,
    platform: (input.platform ?? "instagram").toLowerCase(),
    prompt: input.prompt ?? null,
    description,
    filename: input.mediaFilename ?? null,
  });

  const cost =
    ds.promptTokens * DEEPSEEK_INPUT_PER_TOKEN +
    ds.completionTokens * DEEPSEEK_OUTPUT_PER_TOKEN +
    extraVisionCost;

  const result: CaptionResult = {
    caption: ds.caption,
    hashtags: ds.hashtags,
    intent: ds.intent || "Generic post for audience engagement.",
    cached: false,
    cacheKey,
    latencyMs: Date.now() - startedAt,
    provider: "deepseek",
    estimatedCostUsd: Number(cost.toFixed(6)),
    usedVision,
  };
  rememberCache(cacheKey, result);
  return result;
}
